import { mocked } from 'ts-jest/utils';
import fetchFeeHistory from './fetchFeeHistory';
import fetchGasEstimatesViaEthFeeHistory from './fetchGasEstimatesViaEthFeeHistory';

jest.mock('./fetchFeeHistory');

const mockedFetchFeeHistory = mocked(fetchFeeHistory, true);

describe('fetchGasEstimatesViaEthFeeHistory', () => {
  it('returns estimates', async () => {
    mockedFetchFeeHistory.mockResolvedValue({
      startBlockId: '0x0',
      blocks: [
        {
          baseFeePerGas: 98_436_555_707,
          gasUsedRatio: 1,
          priorityFeesByPercentile: {
            10: 1_250_000_000,
            20: 1_500_000_000,
            30: 1_500_000_000,
          },
        },
        {
          baseFeePerGas: 89_345_951_272,
          gasUsedRatio: 1,
          priorityFeesByPercentile: {
            10: 0,
            20: 0,
            30: 0,
          },
        },
        {
          baseFeePerGas: 100_452_536_050,
          gasUsedRatio: 1,
          priorityFeesByPercentile: {
            10: 1_250_000_000,
            20: 1_400_000_000,
            30: 1_500_000_000,
          },
        },
      ],
    });

    const gasFeeEstimates = await fetchGasEstimatesViaEthFeeHistory({});

    expect(gasFeeEstimates).toStrictEqual({
      low: {
        minWaitTimeEstimate: 15_000,
        maxWaitTimeEstimate: 30_000,
        suggestedMaxPriorityFeePerGas: '1.175',
        suggestedMaxFeePerGas: '121.71804326',
      },
      medium: {
        minWaitTimeEstimate: 15_000,
        maxWaitTimeEstimate: 45_000,
        suggestedMaxPriorityFeePerGas: '1.5',
        suggestedMaxFeePerGas: '132.088296865',
      },
      high: {
        minWaitTimeEstimate: 15_000,
        maxWaitTimeEstimate: 60_000,
        suggestedMaxPriorityFeePerGas: '2',
        suggestedMaxFeePerGas: '142.63355047',
      },
      estimatedBaseFee: '100.45253605',
    });
  });
});
