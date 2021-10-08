import fetchFeeHistory from './fetchFeeHistory';
import { Eip1559GasFee, GasFeeEstimates } from './GasFeeController';

type EthQuery = any;
type PriorityLevel = typeof PRIORITY_LEVELS[number];
type Percentile = typeof PERCENTILES[number];

const NUMBER_OF_RECENT_BLOCKS = 5;
const PRIORITY_LEVELS = ['low', 'medium', 'high'] as const;
const PERCENTILES = [10, 20, 30] as const;
const SETTINGS_BY_PRIORITY_LEVEL = {
  low: {
    percentile: 10 as Percentile,
    priorityFeeReduction: 0.06,
    minSuggestedMaxPriorityFeePerGas: 1_000_000_000,
    baseFeeMultiplier: 1.2,
    estimatedWaitTimes: {
      minWaitTimeEstimate: 15_000,
      maxWaitTimeEstimate: 30_000,
    },
  },
  medium: {
    percentile: 20 as Percentile,
    priorityFeeReduction: 0.03,
    minSuggestedMaxPriorityFeePerGas: 1_500_000_000,
    baseFeeMultiplier: 1.3,
    estimatedWaitTimes: {
      minWaitTimeEstimate: 15_000,
      maxWaitTimeEstimate: 45_000,
    },
  },
  high: {
    percentile: 30 as Percentile,
    priorityFeeReduction: 0.02,
    minSuggestedMaxPriorityFeePerGas: 2_000_000_000,
    baseFeeMultiplier: 1.4,
    estimatedWaitTimes: {
      minWaitTimeEstimate: 15_000,
      maxWaitTimeEstimate: 60_000,
    },
  },
};

/**
 * Finds the "median" among a list of numbers.
 *
 * @param numbers - A list of numbers. Will be sorted automatically if unsorted.
 * @returns The number at the exact midpoint of the list, provided the list is odd-numbered; or, the
 * halfway point between the two numbers on either side of the midpoint, if the list is
 * even-numbered.
 */
function medianOf(numbers: number[]): number {
  const sortedNumbers = numbers.slice().sort((a, b) => a - b);
  const len = sortedNumbers.length;
  if (len % 2 === 0) {
    return (sortedNumbers[len / 2] + sortedNumbers[len / 2 - 1]) / 2;
  }
  return sortedNumbers[(sortedNumbers.length - 1) / 2];
}

/**
 * Converts the given number from WEI to GWEI.
 *
 * @param wei - The amount in WEI.
 * @returns The amount in GWEI.
 */
function weiToGwei(wei: number): number {
  return wei / 1_000_000_000;
}

/**
 * Calculates a set of estimates assigned to a particular priority level based on the data returned
 * by `eth_feeHistory`.
 *
 * @param priorityLevel - The level of fees that dictates how soon a transaction may go through
 * ("low", "medium", or "high").
 * @param latestBaseFeePerGas - The base fee per gas recorded for the latest block.
 * @param blocks - More information about blocks we can use to calculate estimates.
 * @returns The estimates.
 */
function calculateGasEstimatesForPriorityLevel(
  priorityLevel: PriorityLevel,
  latestBaseFeePerGas: number,
  blocks: { priorityFeesByPercentile: Record<Percentile, number> }[],
): Eip1559GasFee {
  const settings = SETTINGS_BY_PRIORITY_LEVEL[priorityLevel];

  const adjustedBaseFee = latestBaseFeePerGas * settings.baseFeeMultiplier;
  const priorityFees = blocks.map((block) => {
    return block.priorityFeesByPercentile[settings.percentile];
  });
  const medianPriorityFee = medianOf(priorityFees);
  const adjustedPriorityFee =
    medianPriorityFee * (1 - settings.priorityFeeReduction);
  const suggestedMaxPriorityFeePerGas = Math.max(
    adjustedPriorityFee,
    settings.minSuggestedMaxPriorityFeePerGas,
  );
  const suggestedMaxFeePerGas = adjustedBaseFee + suggestedMaxPriorityFeePerGas;

  return {
    ...settings.estimatedWaitTimes,
    suggestedMaxPriorityFeePerGas: weiToGwei(
      suggestedMaxPriorityFeePerGas,
    ).toString(),
    suggestedMaxFeePerGas: weiToGwei(suggestedMaxFeePerGas).toString(),
  };
}

/**
 * Calculates a set of estimates suitable for different priority levels based on the data returned
 * by `eth_feeHistory`.
 *
 * @param latestBaseFeePerGas - The base fee per gas recorded for the latest block.
 * @param blocks - More information about blocks we can use to calculate estimates.
 * @returns The estimates.
 */
function calculateGasEstimatesForAllPriorityLevels(
  latestBaseFeePerGas: number,
  blocks: { priorityFeesByPercentile: Record<Percentile, number> }[],
) {
  return PRIORITY_LEVELS.reduce((obj, priorityLevel) => {
    const gasEstimatesForPriorityLevel = calculateGasEstimatesForPriorityLevel(
      priorityLevel,
      latestBaseFeePerGas,
      blocks,
    );
    return { ...obj, [priorityLevel]: gasEstimatesForPriorityLevel };
  }, {} as Pick<GasFeeEstimates, PriorityLevel>);
}

/**
 * Generates gas fee estimates based on gas fees that have been used in the recent past so that
 * those estimates can be displayed to users.
 *
 * To produce the estimates, the last 5 blocks are read from the network, and for each block, the
 * priority fees for transactions at the 10th, 20th, and 30th percentiles are also read (here
 * "percentile" signifies the level at which those transactions contribute to the overall gas used
 * for the block, where higher percentiles correspond to higher fees). This information is used to
 * calculate reasonable max priority and max fees for three different priority levels (higher
 * priority = higher fee).
 *
 * @param ethQuery - An EthQuery instance.
 * @returns Base and priority fee estimates, categorized by priority level, as well as an estimate
 * for the next block's base fee.
 */
export default async function fetchGasEstimatesViaEthFeeHistory(
  ethQuery: EthQuery,
): Promise<GasFeeEstimates> {
  const feeHistory = await fetchFeeHistory<Percentile>({
    ethQuery,
    numberOfBlocks: NUMBER_OF_RECENT_BLOCKS,
    percentiles: PERCENTILES,
  });
  const latestBlock = feeHistory.blocks[feeHistory.blocks.length - 1];
  const latestBaseFeePerGas = latestBlock.baseFeePerGas;
  const levelSpecificGasEstimates = calculateGasEstimatesForAllPriorityLevels(
    latestBaseFeePerGas,
    feeHistory.blocks,
  );
  const estimatedBaseFee = weiToGwei(latestBlock.baseFeePerGas).toString();

  return {
    ...levelSpecificGasEstimates,
    estimatedBaseFee,
  };
}
