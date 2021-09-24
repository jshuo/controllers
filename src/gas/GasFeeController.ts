import type { Patch } from 'immer';

import EthQuery from 'eth-query';
import { isHexString } from 'ethereumjs-util';
import { BaseController } from '../BaseControllerV2';
import { safelyExecute, isNumber } from '../util';
import type { RestrictedControllerMessenger } from '../ControllerMessenger';
import type {
  NetworkController,
  NetworkState,
} from '../network/NetworkController';
import {
  fetchGasEstimates as defaultFetchGasEstimates,
  fetchEthGasPriceEstimate as defaultFetchEthGasPriceEstimate,
  fetchLegacyGasPriceEstimates as defaultFetchLegacyGasPriceEstimates,
  calculateTimeEstimate,
} from './gas-util';
import { fetchFeeHistory as defaultFetchFeeHistory } from './fetchFeeHistory';

const GAS_FEE_API = 'https://mock-gas-server.herokuapp.com/';
export const LEGACY_GAS_PRICES_API_URL = `https://api.metaswap.codefi.network/gasPrices`;

export type unknownString = 'unknown';

// Fee Market describes the way gas is set after the london hardfork, and was
// defined by EIP-1559.
export type FeeMarketEstimateType = 'fee-market';
// Legacy describes gasPrice estimates from before london hardfork, when the
// user is connected to mainnet and are presented with fast/average/slow
// estimate levels to choose from.
export type LegacyEstimateType = 'legacy';
// EthGasPrice describes a gasPrice estimate received from eth_gasPrice. Post
// london this value should only be used for legacy type transactions when on
// networks that support EIP-1559. This type of estimate is the most accurate
// to display on custom networks that don't support EIP-1559.
export type EthGasPriceEstimateType = 'eth_gasPrice';
// NoEstimate describes the state of the controller before receiving its first
// estimate.
export type NoEstimateType = 'none';

/**
 * Indicates which type of gasEstimate the controller is currently returning.
 * This is useful as a way of asserting that the shape of gasEstimates matches
 * expectations. NONE is a special case indicating that no previous gasEstimate
 * has been fetched.
 */
export const GAS_ESTIMATE_TYPES = {
  FEE_MARKET: 'fee-market' as FeeMarketEstimateType,
  LEGACY: 'legacy' as LegacyEstimateType,
  ETH_GASPRICE: 'eth_gasPrice' as EthGasPriceEstimateType,
  NONE: 'none' as NoEstimateType,
};

export type GasEstimateType =
  | FeeMarketEstimateType
  | EthGasPriceEstimateType
  | LegacyEstimateType
  | NoEstimateType;

export type EstimatedGasFeeTimeBounds = {
  lowerTimeBound: number | null;
  upperTimeBound: number | unknownString;
};

/**
 * @type EthGasPriceEstimate
 *
 * A single gas price estimate for networks and accounts that don't support EIP-1559
 * This estimate comes from eth_gasPrice but is converted to dec gwei to match other
 * return values
 * @property gasPrice - A GWEI dec string
 */

export type EthGasPriceEstimate = {
  gasPrice: string;
};

/**
 * @type LegacyGasPriceEstimate
 *
 * A set of gas price estimates for networks and accounts that don't support EIP-1559
 * These estimates include low, medium and high all as strings representing gwei in
 * decimal format.
 * @property high - gasPrice, in decimal gwei string format, suggested for fast inclusion
 * @property medium - gasPrice, in decimal gwei string format, suggested for avg inclusion
 * @property low - gasPrice, in decimal gwei string format, suggested for slow inclusion
 */
export type LegacyGasPriceEstimate = {
  high: string;
  medium: string;
  low: string;
};

/**
 * @type Eip1559GasFee
 *
 * Data necessary to provide an estimate of a gas fee with a specific tip
 * @property minWaitTimeEstimate - The fastest the transaction will take, in milliseconds
 * @property maxWaitTimeEstimate - The slowest the transaction will take, in milliseconds
 * @property suggestedMaxPriorityFeePerGas - A suggested "tip", a GWEI hex number
 * @property suggestedMaxFeePerGas - A suggested max fee, the most a user will pay. a GWEI hex number
 */

export type Eip1559GasFee = {
  minWaitTimeEstimate: number; // a time duration in milliseconds
  maxWaitTimeEstimate: number; // a time duration in milliseconds
  suggestedMaxPriorityFeePerGas: string; // a GWEI decimal number
  suggestedMaxFeePerGas: string; // a GWEI decimal number
};

/**
 * @type GasFeeEstimates
 *
 * Data necessary to provide multiple GasFee estimates, and supporting information, to the user
 * @property low - A GasFee for a minimum necessary combination of tip and maxFee
 * @property medium - A GasFee for a recommended combination of tip and maxFee
 * @property high - A GasFee for a high combination of tip and maxFee
 * @property estimatedBaseFee - An estimate of what the base fee will be for the pending/next block. A GWEI dec number
 */

export type GasFeeEstimates = {
  low: Eip1559GasFee;
  medium: Eip1559GasFee;
  high: Eip1559GasFee;
  estimatedBaseFee: string;
};

const metadata = {
  gasFeeEstimates: { persist: true, anonymous: false },
  estimatedGasFeeTimeBounds: { persist: true, anonymous: false },
  gasEstimateType: { persist: true, anonymous: false },
  isNetworkCongested: { persist: true, anonymous: false },
};

export type GasFeeStateEthGasPrice = {
  gasFeeEstimates: EthGasPriceEstimate;
  estimatedGasFeeTimeBounds: Record<string, never>;
  gasEstimateType: EthGasPriceEstimateType;
};

export type GasFeeStateFeeMarket = {
  gasFeeEstimates: GasFeeEstimates;
  estimatedGasFeeTimeBounds: EstimatedGasFeeTimeBounds | Record<string, never>;
  gasEstimateType: FeeMarketEstimateType;
};

export type GasFeeStateLegacy = {
  gasFeeEstimates: LegacyGasPriceEstimate;
  estimatedGasFeeTimeBounds: Record<string, never>;
  gasEstimateType: LegacyEstimateType;
};

export type GasFeeStateNoEstimates = {
  gasFeeEstimates: Record<string, never>;
  estimatedGasFeeTimeBounds: Record<string, never>;
  gasEstimateType: NoEstimateType;
};

export type FetchGasFeeEstimateOptions = {
  shouldUpdateState?: boolean;
};

/**
 * @type GasFeeState
 *
 * Gas Fee controller state
 * @property gasFeeEstimates - Gas fee estimate data based on new EIP-1559 properties
 * @property estimatedGasFeeTimeBounds - Estimates representing the minimum and maximum
 * @property gasEstimateType - Source of estimate data, if any
 * @property isNetworkCongested - Whether or not there are a lot of transactions
 * taking place within the network
 */
export type GasFeeState = GasFeeStateEstimates & GasFeeStateNetworkCongestion;

type GasFeeStateEstimates =
  | GasFeeStateEthGasPrice
  | GasFeeStateFeeMarket
  | GasFeeStateLegacy
  | GasFeeStateNoEstimates;

type GasFeeStateNetworkCongestion = { isNetworkCongested: boolean };

const name = 'GasFeeController';

export type GasFeeStateChange = {
  type: `${typeof name}:stateChange`;
  payload: [GasFeeState, Patch[]];
};

export type GetGasFeeState = {
  type: `${typeof name}:getState`;
  handler: () => GasFeeState;
};

type GasFeeMessenger = RestrictedControllerMessenger<
  typeof name,
  GetGasFeeState,
  GasFeeStateChange,
  never,
  never
>;

const defaultState: GasFeeState = {
  gasFeeEstimates: {},
  estimatedGasFeeTimeBounds: {},
  gasEstimateType: GAS_ESTIMATE_TYPES.NONE,
  isNetworkCongested: false,
};

type PollableItems = {
  gasFeeEstimates: () => Promise<any>;
  isNetworkCongested: () => Promise<any>;
};

type ChainId = `0x${string}` | `${number}` | number;

/**
 * Wraps the given function that is used to get the current chain id such that we guarantee that the
 * chain id is a decimal number.
 *
 * @param getChainId - A function that returns the chain id of the currently selected network as
 * a number expressed as a hex string, a decimal string, or a numeric value.
 * @returns A function that returns the chain id as a numeric value.
 */
function withNormalizedChainId(getChainId: () => ChainId): () => number {
  return () => {
    const chainId = getChainId();
    if (typeof chainId === 'string') {
      if (isHexString(chainId)) {
        return parseInt(chainId, 16);
      }
      return parseInt(chainId, 10);
    } else if (typeof chainId === 'number') {
      return chainId;
    }
    throw new Error(`Could not normalize chain id ${chainId}`);
  };
}

/**
 * Controller that retrieves gas fee estimate and fee history data and polls for
 * updated data on a set interval
 */
export class GasFeeController extends BaseController<
  typeof name,
  GasFeeState,
  GasFeeMessenger
> {
  private intervalId?: NodeJS.Timeout;

  private intervalDelay;

  private pollQueue: Set<keyof PollableItems>;

  private pollableItems: PollableItems;

  private legacyAPIEndpoint: string;

  private EIP1559APIEndpoint: string;

  private fetchGasEstimates;

  private fetchEthGasPriceEstimate;

  private fetchLegacyGasPriceEstimates;

  private fetchFeeHistory;

  private getCurrentNetworkEIP1559Compatibility;

  private getCurrentNetworkLegacyGasAPICompatibility;

  private getCurrentAccountEIP1559Compatibility;

  private getChainId;

  private ethQuery: any;

  private clientId?: string;

  /**
   * Creates a GasFeeController instance.
   *
   * @param options - The controller options.
   * @param options.interval - The time in milliseconds to wait between polls.
   * @param options.messenger - The controller messenger.
   * @param options.state - The initial state.
   * @param options.fetchGasEstimates - The function to use to fetch gas estimates. This option is
   * primarily for testing purposes.
   * @param options.fetchEthGasPriceEstimate - The function to use to fetch gas price estimates.
   * This option is primarily for testing purposes.
   * @param options.fetchLegacyGasPriceEstimates - The function to use to fetch legacy gas price
   * estimates. This option is primarily for testing purposes.
   * @param options.fetchFeeHistory - The function to use to fetch fee history (so that we can know
   * whether the network is congested). This option is primarily for testing purposes.
   * @param options.getCurrentNetworkEIP1559Compatibility - Determines whether or not the current
   * network is EIP-1559 compatible.
   * @param options.getCurrentNetworkLegacyGasAPICompatibility - Determines whether or not the
   * current network is compatible with the legacy gas price API.
   * @param options.getCurrentAccountEIP1559Compatibility - Determines whether or not the current
   * account is EIP-1559 compatible.
   * @param options.getChainId - Returns the current chain ID.
   * @param options.getProvider - Returns a network provider for the current network.
   * @param options.onNetworkStateChange - A function for registering an event handler for the
   * network state change event.
   * @param options.legacyAPIEndpoint - The legacy gas price API URL. This option is primarily for
   * testing purposes.
   * @param options.EIP1559APIEndpoint - The EIP-1559 gas price API URL. This option is primarily
   * for testing purposes.
   * @param options.clientId - The client ID used to identify to the gas estimation API who is
   * asking for estimates.
   */
  constructor({
    interval = 15000,
    messenger,
    state,
    fetchGasEstimates = defaultFetchGasEstimates,
    fetchEthGasPriceEstimate = defaultFetchEthGasPriceEstimate,
    fetchLegacyGasPriceEstimates = defaultFetchLegacyGasPriceEstimates,
    fetchFeeHistory = defaultFetchFeeHistory,
    getCurrentNetworkEIP1559Compatibility,
    getCurrentAccountEIP1559Compatibility,
    getChainId,
    getCurrentNetworkLegacyGasAPICompatibility,
    getProvider,
    onNetworkStateChange,
    legacyAPIEndpoint = LEGACY_GAS_PRICES_API_URL,
    EIP1559APIEndpoint = GAS_FEE_API,
    clientId,
  }: {
    interval?: number;
    messenger: GasFeeMessenger;
    state?: GasFeeState;
    fetchGasEstimates?: typeof defaultFetchGasEstimates;
    fetchEthGasPriceEstimate?: typeof defaultFetchEthGasPriceEstimate;
    fetchLegacyGasPriceEstimates?: typeof defaultFetchLegacyGasPriceEstimates;
    fetchFeeHistory?: typeof defaultFetchFeeHistory;
    getCurrentNetworkEIP1559Compatibility: () => Promise<boolean>;
    getCurrentNetworkLegacyGasAPICompatibility: () => boolean;
    getCurrentAccountEIP1559Compatibility?: () => boolean;
    getChainId: () => ChainId;
    getProvider: () => NetworkController['provider'];
    onNetworkStateChange: (listener: (state: NetworkState) => void) => void;
    legacyAPIEndpoint?: string;
    EIP1559APIEndpoint?: string;
    clientId?: string;
  }) {
    super({
      name,
      metadata,
      messenger,
      state: { ...defaultState, ...state },
    });
    this.intervalDelay = interval;
    this.fetchGasEstimates = fetchGasEstimates;
    this.fetchEthGasPriceEstimate = fetchEthGasPriceEstimate;
    this.fetchLegacyGasPriceEstimates = fetchLegacyGasPriceEstimates;
    this.fetchFeeHistory = fetchFeeHistory;
    this.pollQueue = new Set();
    this.pollableItems = {
      gasFeeEstimates: this._fetchGasFeeEstimateData.bind(this),
      isNetworkCongested: this.determineWhetherNetworkCongested.bind(this),
    };
    this.getCurrentNetworkEIP1559Compatibility = getCurrentNetworkEIP1559Compatibility;
    this.getCurrentNetworkLegacyGasAPICompatibility = getCurrentNetworkLegacyGasAPICompatibility;
    this.getCurrentAccountEIP1559Compatibility = getCurrentAccountEIP1559Compatibility;
    this.EIP1559APIEndpoint = EIP1559APIEndpoint;
    this.legacyAPIEndpoint = legacyAPIEndpoint;
    this.getChainId = withNormalizedChainId(getChainId);
    const provider = getProvider();
    this.ethQuery = new EthQuery(provider);
    this.clientId = clientId;
    onNetworkStateChange(async () => {
      const newProvider = getProvider();
      this.ethQuery = new EthQuery(newProvider);
    });
  }

  async fetchGasFeeEstimates(options?: FetchGasFeeEstimateOptions) {
    return await this._fetchGasFeeEstimateData(options);
  }

  /**
   * Makes a request for gas fee estimates and adds that request to the
   * polling queue. The polling queue is then started if it is not already
   * started.
   *
   * @param _pollingToken - A polling token (unused).
   * @returns The string "gasFeeEstimates".
   * @deprecated
   * @see updateWithAndStartPollingFor
   */
  async getGasFeeEstimatesAndStartPolling(
    _pollingToken: string | undefined,
  ): Promise<keyof PollableItems> {
    await this.updateWithAndStartPollingFor('gasFeeEstimates');
    return 'gasFeeEstimates';
  }

  /**
   * Makes a request for the given item, updating the state internally with the resulting data, then
   * adds the request to the polling queue. The polling timer is then started if it is not already
   * started.
   *
   * @param item - The known name of a piece of data for which we are interested in polling.
   */
  async updateWithAndStartPollingFor(item: keyof PollableItems): Promise<void> {
    if (!this.pollQueue.has(item)) {
      await this.pollableItems[item]();
      this.pollQueue.add(item);
      this.startPolling();
    }
  }

  /**
   * Gets and sets gasFeeEstimates in state.
   *
   * @param options - The gas fee estimate options.
   * @param options.shouldUpdateState - Determines whether the state should be updated with the
   * updated gas estimates.
   * @returns The gas fee estimates.
   */
  async _fetchGasFeeEstimateData(
    options: FetchGasFeeEstimateOptions = {},
  ): Promise<GasFeeStateEstimates> {
    const { shouldUpdateState = true } = options;
    let isEIP1559Compatible;
    const isLegacyGasAPICompatible = this.getCurrentNetworkLegacyGasAPICompatibility();

    let chainId = this.getChainId();
    if (typeof chainId === 'string' && isHexString(chainId)) {
      chainId = parseInt(chainId, 16);
    }

    try {
      isEIP1559Compatible = await this.getEIP1559Compatibility();
    } catch (e) {
      console.error(e);
      isEIP1559Compatible = false;
    }

    let newState: GasFeeStateEstimates;
    try {
      if (isEIP1559Compatible) {
        const estimates = await this.fetchGasEstimates(
          `${this.EIP1559APIEndpoint.replace('<chain_id>', `${chainId}`)}`,
          this.clientId,
        );
        const {
          suggestedMaxPriorityFeePerGas,
          suggestedMaxFeePerGas,
        } = estimates.medium;
        const estimatedGasFeeTimeBounds = this.getTimeEstimate(
          suggestedMaxPriorityFeePerGas,
          suggestedMaxFeePerGas,
        );
        newState = {
          gasFeeEstimates: estimates,
          estimatedGasFeeTimeBounds,
          gasEstimateType: GAS_ESTIMATE_TYPES.FEE_MARKET,
        };
      } else if (isLegacyGasAPICompatible) {
        const estimates = await this.fetchLegacyGasPriceEstimates(
          this.legacyAPIEndpoint.replace('<chain_id>', `${chainId}`),
          this.clientId,
        );
        newState = {
          gasFeeEstimates: estimates,
          estimatedGasFeeTimeBounds: {},
          gasEstimateType: GAS_ESTIMATE_TYPES.LEGACY,
        };
      } else {
        throw new Error('Main gas fee/price estimation failed. Use fallback');
      }
    } catch {
      try {
        const estimates = await this.fetchEthGasPriceEstimate(this.ethQuery);
        newState = {
          gasFeeEstimates: estimates,
          estimatedGasFeeTimeBounds: {},
          gasEstimateType: GAS_ESTIMATE_TYPES.ETH_GASPRICE,
        };
      } catch (error) {
        throw new Error(
          `Gas fee/price estimation failed. Message: ${error.message}`,
        );
      }
    }

    if (shouldUpdateState) {
      this.update((state) => {
        state.gasFeeEstimates = newState.gasFeeEstimates;
        state.estimatedGasFeeTimeBounds = newState.estimatedGasFeeTimeBounds;
        state.gasEstimateType = newState.gasEstimateType;
      });
    }

    return newState;
  }

  /**
   * Removes the given item from the polling queue such that on the next iteration of the poll the
   * corresponding request for the item will no longer be made.
   *
   * @param item - The known name of a piece of data for which we are polling.
   * @deprecated
   * @see stopPollingFor
   */
  disconnectPoller(item: keyof PollableItems) {
    this.stopPollingFor(item);
  }

  /**
   * Cancels the timer responsible for running the polling queue on a cadence
   * and removes all items from the polling queue entirely.
   */
  stopPolling() {
    this.pausePolling();
    this.pollQueue.clear();
    // XXX: Previously this called resetState(), do we still want that?
  }

  /**
   * Prepare to discard this controller.
   *
   * This stops any active polling.
   */
  destroy() {
    super.destroy();
    this.stopPolling();
  }

  private poll() {
    const promises = [];
    for (const item of this.pollQueue) {
      promises.push(safelyExecute(this.pollableItems[item]));
    }
    return Promise.all(promises);
  }

  private async getEIP1559Compatibility(): Promise<boolean> {
    try {
      const currentNetworkIsEIP1559Compatible = await this.getCurrentNetworkEIP1559Compatibility();
      const currentAccountIsEIP1559Compatible =
        this.getCurrentAccountEIP1559Compatibility?.() ?? true;

      return (
        currentNetworkIsEIP1559Compatible && currentAccountIsEIP1559Compatible
      );
    } catch (e) {
      return false;
    }
  }

  getTimeEstimate(
    maxPriorityFeePerGas: string,
    maxFeePerGas: string,
  ): EstimatedGasFeeTimeBounds | Record<string, never> {
    if (
      !this.state.gasFeeEstimates ||
      this.state.gasEstimateType !== GAS_ESTIMATE_TYPES.FEE_MARKET
    ) {
      return {};
    }
    return calculateTimeEstimate(
      maxPriorityFeePerGas,
      maxFeePerGas,
      this.state.gasFeeEstimates,
    );
  }

  private async startPolling() {
    if (this.intervalId === undefined) {
      this.scheduleNextPoll();
    }
  }

  private scheduleNextPoll() {
    this.intervalId = setTimeout(async () => {
      await this.poll();
      this.scheduleNextPoll();
    }, this.intervalDelay);
  }

  /**
   * Removes the given item from the polling queue such that on the next
   * iteration of the poll the corresponding request for the item will no longer
   * be made.
   *
   * @param item - The known name of a piece of data for which we are polling.
   */
  stopPollingFor(item: keyof PollableItems) {
    this.pollQueue.delete(item);
  }

  private pausePolling() {
    if (this.intervalId !== undefined) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  private async determineWhetherNetworkCongested(): Promise<boolean> {
    const isEIP1559Compatible = await this.getEIP1559Compatibility();
    let isNetworkCongested = false;

    if (isEIP1559Compatible) {
      const feeHistory = await this.fetchFeeHistory({
        ethQuery: this.ethQuery,
        numberOfBlocks: 100,
        percentiles: [50],
      });
      const sortedPriorityFees = feeHistory.blocks
        .map((block) => block.priorityFeesByPercentile.get(50))
        .filter(isNumber)
        .sort((a, b) => a - b);

      if (sortedPriorityFees.length > 0) {
        const minPriorityFee = sortedPriorityFees[0];
        const maxPriorityFee =
          sortedPriorityFees[sortedPriorityFees.length - 1];
        isNetworkCongested = maxPriorityFee >= minPriorityFee * 1.1;
      } else {
        isNetworkCongested = false;
      }

      this.update((state) => {
        state.isNetworkCongested = isNetworkCongested;
      });
    }

    return isNetworkCongested;
  }
}

export default GasFeeController;
