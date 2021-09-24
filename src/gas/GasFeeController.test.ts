import * as FakeTimers from '@sinonjs/fake-timers';
import { ControllerMessenger } from '../ControllerMessenger';
import {
  GasFeeController,
  GetGasFeeState,
  GasFeeStateChange,
  GasFeeEstimates,
  LegacyGasPriceEstimate,
} from './GasFeeController';
import { FeeHistory } from './fetchFeeHistory';
import { calculateTimeEstimate } from './gas-util';

jest.mock('./gas-util', () => {
  const originalModule = jest.requireActual('./gas-util');

  return {
    __esModule: true,
    ...originalModule,
    calculateTimeEstimate: jest.fn(),
  };
});

const EMPTY_FUNCTION = () => {
  // intentionally empty
};

const name = 'GasFeeController';

/**
 * Constructs a restricted controller messenger.
 *
 * @returns A restricted controller messenger.
 */
function getRestrictedMessenger() {
  const controllerMessenger = new ControllerMessenger<
    GetGasFeeState,
    GasFeeStateChange
  >();
  const messenger = controllerMessenger.getRestricted<
    typeof name,
    never,
    never
  >({
    name,
  });
  return messenger;
}

/**
 * Builds mock data for the `fetchGasEstimates` function you can pass to GasFeeController. All of
 * the values here are filled in in order to satisfy the gas fee estimation code in GasFeeController
 * and do not necessarily represent real-world scenarios.
 *
 * @param args - The arguments.
 * @param args.modifier - A number you can use to build a unique response in the event that you need
 * to mock multiple invocations of `fetchGasEstimates`.  All data points will be multiplied by this
 * number.
 * @returns The mock data.
 */
function buildMockDataForFetchGasEstimates({
  modifier = 1,
} = {}): GasFeeEstimates {
  return {
    low: {
      minWaitTimeEstimate: 10000 * modifier,
      maxWaitTimeEstimate: 20000 * modifier,
      suggestedMaxPriorityFeePerGas: modifier.toString(),
      suggestedMaxFeePerGas: (10 * modifier).toString(),
    },
    medium: {
      minWaitTimeEstimate: 30000 * modifier,
      maxWaitTimeEstimate: 40000 * modifier,
      suggestedMaxPriorityFeePerGas: (1.5 * modifier).toString(),
      suggestedMaxFeePerGas: (20 * modifier).toString(),
    },
    high: {
      minWaitTimeEstimate: 50000 * modifier,
      maxWaitTimeEstimate: 60000 * modifier,
      suggestedMaxPriorityFeePerGas: (2 * modifier).toString(),
      suggestedMaxFeePerGas: (30 * modifier).toString(),
    },
    estimatedBaseFee: (100 * modifier).toString(),
  };
}

/**
 * Builds mock data for the `legacyFetchGasPriceEstimates` function you can pass to
 * GasFeeController. All of the values here are filled in in order to satisfy the gas fee estimation
 * code in GasFeeController and do not necessarily represent real-world scenarios.
 *
 * @param args - The arguments.
 * @param args.modifier - A number you can use to build a unique response in the event that you need
 * to mock multiple invocations of `legacyFetchGasPriceEstimates`.  All data points will be
 * multiplied by this number.
 * @returns The mock data.
 */
function buildMockDataForLegacyFetchGasPriceEstimates({
  modifier = 1,
} = {}): LegacyGasPriceEstimate {
  return {
    low: (10 * modifier).toString(),
    medium: (20 * modifier).toString(),
    high: (30 * modifier).toString(),
  };
}

/**
 * Builds mock data for the `fetchFeeHistory` function you can pass to GasFeeController. All of the
 * values here are filled in in order to satisfy the network congestion gauge code in
 * GasFeeController and do not necessarily represent real-world scenarios.
 *
 * @param args - The arguments.
 * @param args.isNetworkCongested - Specifies whether the mock data should represent whether the
 * network is congested or not.
 * @returns The mock data.
 */
function buildMockDataForFetchFeeHistory({
  isNetworkCongested = false,
} = {}): FeeHistory {
  if (isNetworkCongested) {
    return {
      startBlockId: '0x1',
      blocks: [
        {
          baseFeePerGas: 1,
          gasUsedRatio: 1,
          priorityFeesByPercentile: new Map([[50, 100]]),
        },
        {
          baseFeePerGas: 1,
          gasUsedRatio: 1,
          priorityFeesByPercentile: new Map([[50, 200]]),
        },
      ],
    };
  }
  return {
    startBlockId: '0x1',
    blocks: [
      {
        baseFeePerGas: 1,
        gasUsedRatio: 1,
        priorityFeesByPercentile: new Map([[50, 100]]),
      },
      {
        baseFeePerGas: 1,
        gasUsedRatio: 1,
        priorityFeesByPercentile: new Map([[50, 100]]),
      },
    ],
  };
}

describe('GasFeeController', () => {
  let clock: FakeTimers.InstalledClock;
  let gasFeeController: GasFeeController;
  let fetchGasEstimates: jest.Mock<any>;
  let fetchLegacyGasPriceEstimates: jest.Mock<any>;
  let fetchFeeHistory: jest.Mock<any>;

  /**
   * Builds an instance of GasFeeController for use in testing.
   *
   * @param options - The options.
   * @param options.getChainId - Sets getChainId on the GasFeeController.
   * @param options.getIsEIP1559Compatible - Sets getCurrentNetworkEIP1559Compatibility on the
   * GasFeeController.
   * @param options.getCurrentNetworkLegacyGasAPICompatibility - Sets
   * getCurrentNetworkLegacyGasAPICompatibility on the GasFeeController.
   * @param options.mockReturnValuesForFetchGasEstimates - Specifies mock data for one or more
   * invocations of `fetchGasEstimates`.
   * @param options.mockReturnValuesForFetchLegacyGasPriceEstimates - Specifies mock data for one or more
   * invocations of `fetchLegacyGasPriceEstimates`.
   * @param options.mockReturnValuesForFetchFeeHistory - Specifies mock data for one or more
   * invocations of `fetchFeeHistory.`
   * @param options.legacyAPIEndpoint - Sets legacyAPIEndpoint on the GasFeeController.
   * @param options.EIP1559APIEndpoint - Sets EIP1559APIEndpoint on the GasFeeController.
   * @param options.clientId - Sets clientId on the GasFeeController.
   * @returns The gas fee controller.
   */
  function buildGasFeeController({
    getChainId = jest.fn(() => '0x1'),
    getIsEIP1559Compatible = jest.fn(() => Promise.resolve(true)),
    getCurrentNetworkLegacyGasAPICompatibility = jest.fn(() => false),
    mockReturnValuesForFetchGasEstimates = [
      buildMockDataForFetchGasEstimates(),
    ],
    mockReturnValuesForFetchLegacyGasPriceEstimates = [
      buildMockDataForLegacyFetchGasPriceEstimates(),
    ],
    mockReturnValuesForFetchFeeHistory = [buildMockDataForFetchFeeHistory()],
    legacyAPIEndpoint = 'http://legacy.endpoint/<chain_id>',
    EIP1559APIEndpoint = 'http://eip-1559.endpoint/<chain_id>',
    clientId,
  }: {
    getChainId?: jest.Mock<`0x${string}` | `${number}` | number>;
    getIsEIP1559Compatible?: jest.Mock<Promise<boolean>>;
    getCurrentNetworkLegacyGasAPICompatibility?: jest.Mock<boolean>;
    mockReturnValuesForFetchGasEstimates?: any[];
    mockReturnValuesForFetchLegacyGasPriceEstimates?: any[];
    mockReturnValuesForFetchFeeHistory?: any[];
    legacyAPIEndpoint?: string;
    EIP1559APIEndpoint?: string;
    clientId?: string;
  } = {}) {
    const fetchGasEstimatesMock = jest.fn();
    mockReturnValuesForFetchGasEstimates.forEach((response: any) => {
      fetchGasEstimatesMock.mockImplementationOnce(() =>
        Promise.resolve(response),
      );
    });

    const fetchLegacyGasPriceEstimatesMock = jest.fn();
    mockReturnValuesForFetchLegacyGasPriceEstimates.forEach((response: any) => {
      fetchLegacyGasPriceEstimatesMock.mockImplementationOnce(() =>
        Promise.resolve(response),
      );
    });

    const fetchFeeHistoryMock = jest.fn();
    mockReturnValuesForFetchFeeHistory.forEach((response: any) => {
      fetchFeeHistoryMock.mockImplementationOnce(() =>
        Promise.resolve(response),
      );
    });

    const controller = new GasFeeController({
      messenger: getRestrictedMessenger(),
      getProvider: EMPTY_FUNCTION,
      getChainId,
      fetchGasEstimates: fetchGasEstimatesMock,
      fetchLegacyGasPriceEstimates: fetchLegacyGasPriceEstimatesMock,
      fetchEthGasPriceEstimate: () => Promise.resolve({ gasPrice: '1' }),
      fetchFeeHistory: fetchFeeHistoryMock,
      onNetworkStateChange: EMPTY_FUNCTION,
      getCurrentNetworkLegacyGasAPICompatibility,
      getCurrentNetworkEIP1559Compatibility: getIsEIP1559Compatible, // change this for networkController.state.properties.isEIP1559Compatible ???
      legacyAPIEndpoint,
      EIP1559APIEndpoint,
      clientId,
    });

    return {
      gasFeeController: controller,
      fetchGasEstimates: fetchGasEstimatesMock,
      fetchLegacyGasPriceEstimates: fetchLegacyGasPriceEstimatesMock,
      fetchFeeHistory: fetchFeeHistoryMock,
    };
  }

  beforeEach(() => {
    clock = FakeTimers.install();
  });

  afterEach(() => {
    clock.uninstall();
    gasFeeController.destroy();
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    beforeEach(() => {
      ({ gasFeeController } = buildGasFeeController());
    });

    it('should set the name', () => {
      expect(gasFeeController.name).toBe(name);
    });
  });

  describe('getGasFeeEstimatesAndStartPolling', () => {
    it('should fetch estimates and start polling', async () => {
      ({ gasFeeController } = buildGasFeeController());

      expect(gasFeeController.state.gasFeeEstimates).toStrictEqual({});
      const result = await gasFeeController.getGasFeeEstimatesAndStartPolling(
        undefined,
      );
      expect(result).toStrictEqual('gasFeeEstimates');
      expect(gasFeeController.state.gasFeeEstimates).toHaveProperty('low');
      expect(gasFeeController.state.gasFeeEstimates).toHaveProperty('medium');
      expect(gasFeeController.state.gasFeeEstimates).toHaveProperty('high');
      expect(gasFeeController.state.gasFeeEstimates).toHaveProperty(
        'estimatedBaseFee',
      );
    });

    it('should not fetch estimates if the controller is already polling, and should still return the passed token', async () => {
      ({ gasFeeController, fetchGasEstimates } = buildGasFeeController({
        mockReturnValuesForFetchGasEstimates: [
          buildMockDataForFetchGasEstimates(),
          buildMockDataForFetchGasEstimates(),
        ],
      }));
      const result1 = await gasFeeController.getGasFeeEstimatesAndStartPolling(
        undefined,
      );
      const result2 = await gasFeeController.getGasFeeEstimatesAndStartPolling(
        'something',
      );

      expect(fetchGasEstimates).toHaveBeenCalledTimes(1);
      expect(result1).toStrictEqual('gasFeeEstimates');
      expect(result2).toStrictEqual('gasFeeEstimates');
    });

    it('should cause the fetching new estimates if called after the poll tokens are cleared, and then should not cause additional new fetches when subsequently called', async () => {
      ({ gasFeeController, fetchGasEstimates } = buildGasFeeController({
        mockReturnValuesForFetchGasEstimates: [
          buildMockDataForFetchGasEstimates(),
          buildMockDataForFetchGasEstimates(),
        ],
      }));
      const pollToken = 'token';

      await gasFeeController.getGasFeeEstimatesAndStartPolling(undefined);
      await gasFeeController.getGasFeeEstimatesAndStartPolling(pollToken);

      expect(fetchGasEstimates).toHaveBeenCalledTimes(1);

      gasFeeController.stopPolling();

      const result3 = await gasFeeController.getGasFeeEstimatesAndStartPolling(
        undefined,
      );
      expect(result3).toStrictEqual('gasFeeEstimates');
      expect(fetchGasEstimates).toHaveBeenCalledTimes(2);

      const result4 = await gasFeeController.getGasFeeEstimatesAndStartPolling(
        undefined,
      );
      expect(result4).toStrictEqual('gasFeeEstimates');
      expect(fetchGasEstimates).toHaveBeenCalledTimes(2);
    });
  });

  describe('updateWithAndStartPollingFor', () => {
    describe('gasFeeEstimates', () => {
      it('should update the state with a fetched set of estimates', async () => {
        const mockReturnValuesForFetchGasEstimates = [
          buildMockDataForFetchGasEstimates(),
        ];
        ({ gasFeeController } = buildGasFeeController({
          mockReturnValuesForFetchGasEstimates,
        }));

        await gasFeeController.updateWithAndStartPollingFor('gasFeeEstimates');

        expect(gasFeeController.state.gasFeeEstimates).toStrictEqual(
          mockReturnValuesForFetchGasEstimates[0],
        );

        expect(gasFeeController.state.estimatedGasFeeTimeBounds).toStrictEqual(
          {},
        );

        expect(gasFeeController.state.gasEstimateType).toStrictEqual(
          'fee-market',
        );
      });

      it('should continue updating the state with all estimate data (including new time estimates because of a subsequent request) on a set interval', async () => {
        const mockReturnValuesForFetchGasEstimates = [
          buildMockDataForFetchGasEstimates({ modifier: 1 }),
          buildMockDataForFetchGasEstimates({ modifier: 1.5 }),
        ];
        ({ gasFeeController } = buildGasFeeController({
          mockReturnValuesForFetchGasEstimates,
        }));

        (calculateTimeEstimate as jest.Mock<any>).mockImplementation(
          () => ({}),
        );

        await gasFeeController.updateWithAndStartPollingFor('gasFeeEstimates');
        await clock.nextAsync();

        expect(gasFeeController.state.gasFeeEstimates).toStrictEqual(
          mockReturnValuesForFetchGasEstimates[1],
        );

        expect(gasFeeController.state.estimatedGasFeeTimeBounds).toStrictEqual(
          {},
        );

        expect(gasFeeController.state.gasEstimateType).toStrictEqual(
          'fee-market',
        );
      });

      it('should not make the request to fetch estimates a second time if called twice', async () => {
        ({ gasFeeController, fetchGasEstimates } = buildGasFeeController({
          mockReturnValuesForFetchGasEstimates: [
            buildMockDataForFetchGasEstimates(),
            buildMockDataForFetchGasEstimates(),
          ],
        }));

        await gasFeeController.updateWithAndStartPollingFor('gasFeeEstimates');
        await gasFeeController.updateWithAndStartPollingFor('gasFeeEstimates');

        expect(fetchGasEstimates.mock.calls).toHaveLength(1);
      });

      it('should not add the request to fetch estimates to the polling queue a second time if called twice', async () => {
        ({ gasFeeController, fetchGasEstimates } = buildGasFeeController({
          mockReturnValuesForFetchGasEstimates: [
            buildMockDataForFetchGasEstimates(),
            buildMockDataForFetchGasEstimates(),
          ],
        }));

        await gasFeeController.updateWithAndStartPollingFor('gasFeeEstimates');
        await gasFeeController.updateWithAndStartPollingFor('gasFeeEstimates');
        await clock.nextAsync();

        expect(fetchGasEstimates.mock.calls).toHaveLength(2);
      });
    });

    describe('isNetworkCongested', () => {
      it('should update the state with whether the network is congested', async () => {
        const mockReturnValuesForFetchFeeHistory = [
          buildMockDataForFetchFeeHistory({ isNetworkCongested: true }),
        ];
        ({ gasFeeController } = buildGasFeeController({
          mockReturnValuesForFetchFeeHistory,
        }));

        await gasFeeController.updateWithAndStartPollingFor(
          'isNetworkCongested',
        );

        expect(gasFeeController.state.isNetworkCongested).toStrictEqual(true);
      });

      it('should continue updating the state on a set interval', async () => {
        const mockReturnValuesForFetchFeeHistory = [
          buildMockDataForFetchFeeHistory({ isNetworkCongested: true }),
          buildMockDataForFetchFeeHistory({ isNetworkCongested: false }),
        ];
        ({ gasFeeController } = buildGasFeeController({
          mockReturnValuesForFetchFeeHistory,
        }));

        await gasFeeController.updateWithAndStartPollingFor(
          'isNetworkCongested',
        );
        await clock.nextAsync();

        expect(gasFeeController.state.isNetworkCongested).toStrictEqual(false);
      });

      it('should not make the request to fetch fee history a second time if called twice', async () => {
        ({ gasFeeController, fetchFeeHistory } = buildGasFeeController({
          mockReturnValuesForFetchFeeHistory: [
            buildMockDataForFetchFeeHistory(),
            buildMockDataForFetchFeeHistory(),
          ],
        }));

        await gasFeeController.updateWithAndStartPollingFor(
          'isNetworkCongested',
        );

        await gasFeeController.updateWithAndStartPollingFor(
          'isNetworkCongested',
        );

        expect(fetchFeeHistory.mock.calls).toHaveLength(1);
      });

      it('should not add the request to fetch fee history to the polling queue a second time if called twice', async () => {
        ({ gasFeeController, fetchFeeHistory } = buildGasFeeController({
          mockReturnValuesForFetchFeeHistory: [
            buildMockDataForFetchFeeHistory(),
            buildMockDataForFetchFeeHistory(),
          ],
        }));

        await gasFeeController.updateWithAndStartPollingFor(
          'isNetworkCongested',
        );

        await gasFeeController.updateWithAndStartPollingFor(
          'isNetworkCongested',
        );
        await clock.nextAsync();

        expect(fetchFeeHistory.mock.calls).toHaveLength(2);
      });
    });
  });

  describe('stopPollingFor', () => {
    it('should remove the given item from the polling queue such that a second call to updateWithAndStartPollingFor with the same item has the same effect as the very first invocation', async () => {
      ({ gasFeeController, fetchGasEstimates } = buildGasFeeController({
        mockReturnValuesForFetchGasEstimates: [
          buildMockDataForFetchGasEstimates(),
          buildMockDataForFetchGasEstimates(),
          buildMockDataForFetchGasEstimates(),
          buildMockDataForFetchGasEstimates(),
        ],
      }));
      await gasFeeController.updateWithAndStartPollingFor('gasFeeEstimates');
      await clock.nextAsync();
      expect(fetchGasEstimates.mock.calls).toHaveLength(2);

      gasFeeController.stopPollingFor('gasFeeEstimates');

      await gasFeeController.updateWithAndStartPollingFor('gasFeeEstimates');
      await clock.nextAsync();
      expect(fetchGasEstimates.mock.calls).toHaveLength(4);
    });

    it('should not affect different items than those passed to stopPollingFor', async () => {
      ({ gasFeeController, fetchGasEstimates } = buildGasFeeController({
        mockReturnValuesForFetchGasEstimates: [
          buildMockDataForFetchGasEstimates(),
          buildMockDataForFetchGasEstimates(),
          buildMockDataForFetchGasEstimates(),
          buildMockDataForFetchGasEstimates(),
        ],
      }));
      await gasFeeController.updateWithAndStartPollingFor('gasFeeEstimates');
      await clock.nextAsync();
      expect(fetchGasEstimates.mock.calls).toHaveLength(2);

      gasFeeController.stopPollingFor('isNetworkCongested');

      await gasFeeController.updateWithAndStartPollingFor('gasFeeEstimates');
      await clock.nextAsync();
      expect(fetchGasEstimates.mock.calls).toHaveLength(3);
    });

    it('should not throw an error if the polling queue has not started yet', () => {
      ({ gasFeeController } = buildGasFeeController());
      expect(() =>
        gasFeeController.stopPollingFor('gasFeeEstimates'),
      ).not.toThrow();
    });
  });

  describe('stopPolling', () => {
    it('should clear the polling queue such that a second call to updateWithAndStartPollingFor has the same behavior as the very first invocation', async () => {
      ({ gasFeeController, fetchGasEstimates } = buildGasFeeController({
        mockReturnValuesForFetchGasEstimates: [
          buildMockDataForFetchGasEstimates(),
          buildMockDataForFetchGasEstimates(),
          buildMockDataForFetchGasEstimates(),
          buildMockDataForFetchGasEstimates(),
        ],
      }));
      await gasFeeController.updateWithAndStartPollingFor('gasFeeEstimates');
      await clock.nextAsync();
      expect(fetchGasEstimates.mock.calls).toHaveLength(2);

      gasFeeController.stopPolling();

      await gasFeeController.updateWithAndStartPollingFor('gasFeeEstimates');
      await clock.nextAsync();
      expect(fetchGasEstimates.mock.calls).toHaveLength(4);
    });

    it('should not throw an error if the polling queue has not started yet', () => {
      ({ gasFeeController } = buildGasFeeController());
      expect(() => gasFeeController.stopPolling()).not.toThrow();
    });
  });

  describe('_fetchGasFeeEstimateData', () => {
    describe('when on any network supporting legacy gas estimation api', () => {
      const mockReturnValuesForFetchLegacyGasPriceEstimates = [
        buildMockDataForLegacyFetchGasPriceEstimates(),
      ];
      const defaultConstructorOptions = {
        getIsEIP1559Compatible: jest.fn(() => Promise.resolve(false)),
        getCurrentNetworkLegacyGasAPICompatibility: jest.fn(() => true),
        mockReturnValuesForFetchLegacyGasPriceEstimates,
      };

      it('should return estimates', async () => {
        ({ gasFeeController } = buildGasFeeController(
          defaultConstructorOptions,
        ));

        const estimateData = await gasFeeController._fetchGasFeeEstimateData();

        expect(estimateData.gasFeeEstimates).toStrictEqual(
          mockReturnValuesForFetchLegacyGasPriceEstimates[0],
        );
        expect(estimateData.estimatedGasFeeTimeBounds).toStrictEqual({});
        expect(estimateData.gasEstimateType).toStrictEqual('legacy');
      });

      it('calls fetchLegacyGasPriceEstimates correctly when getChainId returns a number input', async () => {
        ({
          gasFeeController,
          fetchLegacyGasPriceEstimates,
        } = buildGasFeeController({
          ...defaultConstructorOptions,
          legacyAPIEndpoint: 'http://legacy.endpoint/<chain_id>',
          getChainId: jest.fn(() => 1),
          clientId: '123',
        }));

        await gasFeeController._fetchGasFeeEstimateData();

        expect(fetchLegacyGasPriceEstimates).toHaveBeenCalledWith(
          'http://legacy.endpoint/1',
          '123',
        );
      });

      it('calls fetchLegacyGasPriceEstimates correctly when getChainId returns a hexstring input', async () => {
        ({
          gasFeeController,
          fetchLegacyGasPriceEstimates,
        } = buildGasFeeController({
          ...defaultConstructorOptions,
          legacyAPIEndpoint: 'http://legacy.endpoint/<chain_id>',
          getChainId: jest.fn(() => '0x1'),
          clientId: '123',
        }));

        await gasFeeController._fetchGasFeeEstimateData();

        expect(fetchLegacyGasPriceEstimates).toHaveBeenCalledWith(
          'http://legacy.endpoint/1',
          '123',
        );
      });

      it('calls fetchLegacyGasPriceEstimates correctly when getChainId returns a numeric string input', async () => {
        ({
          gasFeeController,
          fetchLegacyGasPriceEstimates,
        } = buildGasFeeController({
          ...defaultConstructorOptions,
          legacyAPIEndpoint: 'http://legacy.endpoint/<chain_id>',
          getChainId: jest.fn(() => '1'),
          clientId: '123',
        }));

        await gasFeeController._fetchGasFeeEstimateData();

        expect(fetchLegacyGasPriceEstimates).toHaveBeenCalledWith(
          'http://legacy.endpoint/1',
          '123',
        );
      });
    });

    describe('when on any network supporting EIP-1559', () => {
      it('should return estimates', async () => {
        const mockReturnValuesForFetchGasEstimates = [
          buildMockDataForFetchGasEstimates(),
        ];
        ({ gasFeeController } = buildGasFeeController({
          getIsEIP1559Compatible: jest.fn(() => Promise.resolve(true)),
          mockReturnValuesForFetchGasEstimates,
        }));

        const estimateData = await gasFeeController._fetchGasFeeEstimateData();

        expect(estimateData.gasFeeEstimates).toStrictEqual(
          mockReturnValuesForFetchGasEstimates[0],
        );
        expect(estimateData.estimatedGasFeeTimeBounds).toStrictEqual({});
        expect(estimateData.gasEstimateType).toStrictEqual('fee-market');
      });
    });
  });
});
