import { BN } from 'ethereumjs-util';
import { stripHexPrefix } from 'ethjs-util';
import { query } from '../util';

type HexString = `0x${string}`;

/**
 * @type FeeHistory
 *
 * Historical data for gas fees for a range of blocks within a particular network.
 * @property startBlockId - The id of the oldest block in the block range requested.
 * @property blocks - Data for the blocks in the block range requested, sorted from earliest to
 * latest.
 */
export type FeeHistory<Percentile extends number> = {
  startBlockId: HexString;
  blocks: BlockFeeHistory<Percentile>[];
};

/**
 * @type BlockFeeHistory
 *
 * Historical data for gas fees for a particular block.
 * @property baseFeePerGas - The base fee per gas for the block.
 * @property gasUsedRatio - A number between 0 and 1 that represents the gas paid for the block vs.
 * its set gas limit.
 * @property priorityFeesByPercentile - The priority fees paid for the transactions in the block
 * that occurred at particular levels at which those transactions contributed to the overall gas
 * used for the block, indexed by those percentiles. (See docs for `fetchFeeHistory` for more on how
 * this works.)
 */
type BlockFeeHistory<Percentile extends number> = {
  baseFeePerGas: number;
  gasUsedRatio: number;
  priorityFeesByPercentile: Record<Percentile, number>;
};

/**
 * @type EthFeeHistoryResponse
 *
 * Response data for `eth_feeHistory`.
 * @property oldestBlock - The id of the oldest block (in hex format) in the range of blocks
 * requested.
 * @property baseFeePerGas - Base fee per gas for each block in the range of blocks requested.
 * @property gasUsedRatio - A number between 0 and 1 that represents the gas used vs. gas limit for
 * each block in the range of blocks requested.
 * @property reward - The priority fee at the percentiles requested for each block in the range of
 * blocks requested.
 */

export type EthFeeHistoryResponse = {
  oldestBlock: HexString;
  baseFeePerGas: HexString[];
  gasUsedRatio: number[];
  reward: HexString[][];
};

/**
 * Converts a hexadecimal string to a decimal number.
 *
 * @param hex - A string encoding a hexadecimal number (with a "0x" prefix).
 * @returns The number in decimal.
 */
function hexToDec(hex: string): number {
  return parseInt(new BN(stripHexPrefix(hex), 16).toString(10), 10);
}

/**
 * Converts a decimal number to a hexadecimal string.
 *
 * @param dec - A number in decimal.
 * @returns A string encoding that number in hexadecimal (with a "0x" prefix).
 */
function decToHex(dec: number): string {
  const hexString = new BN(dec.toString(), 10).toString(16);
  return `0x${hexString}`;
}

/**
 * Uses `eth_feeHistory` (an EIP-1559 feature) to obtain information about gas fees from a range of
 * blocks that have occurred recently on a network.
 *
 * To learn more, see these resources:
 *
 * - <https://infura.io/docs/ethereum#operation/eth_feeHistory>
 * - <https://github.com/zsfelfoldi/feehistory/blob/main/docs/feeHistory.md>
 * - <https://github.com/ethereum/go-ethereum/blob/57a3fab8a75eeb9c2f4fab770b73b51b9fe672c5/eth/gasprice/feehistory.go#L180>
 * - <https://github.com/ethereum/EIPs/blob/master/EIPS/eip-1559.md>
 * - <https://gas-api.metaswap.codefi.network/testFeeHistory>
 *
 * @param args - The arguments.
 * @param args.ethQuery - An EthQuery instance that wraps a provider for the network in question.
 * @param args.endBlock - The desired end of the block range. Can be a block tag ("latest" for the
 * latest successful block or "pending" for the latest pending block) or a block id.
 * @param args.numberOfBlocks - How many blocks to include in the block range (starting from
 * `endBlock` and working backward). Each type of data in the return value will have this many items
 * in it.
 * @param args.percentiles - A set of numbers between 1 and 100 which will advise how
 * priorityFeesByPercentile in the return value will be formed. When Ethereum runs the
 * `eth_feeHistory` method, for each block it is considering, it will first sort all transactions by
 * the priority fee. It will then go through each transaction and add the total amount of gas paid
 * for that transaction to a bucket which maxes out at the total gas used for the whole block. As
 * the bucket fills, it will cross percentages which correspond to the percentiles specified here,
 * and the priority fees of the transactions which cause it to reach those percentages will be
 * recorded. Hence, priorityFeesByPercentile represents the priority fees of transactions at key gas
 * used contribution levels, where earlier contributions have smaller fees and later contributions
 * have higher fees.
 * @returns The fee history data.
 */
export default async function fetchFeeHistory<Percentile extends number>({
  ethQuery,
  endBlock = 'latest',
  numberOfBlocks,
  percentiles: givenPercentiles,
}: {
  ethQuery: any;
  endBlock?: 'latest' | 'pending' | HexString;
  numberOfBlocks: number;
  percentiles: readonly Percentile[];
}): Promise<FeeHistory<Percentile>> {
  const percentiles = Array.from(new Set(givenPercentiles)).sort(
    (a, b) => a - b,
  );
  const response: EthFeeHistoryResponse = await query(
    ethQuery,
    'eth_feeHistory',
    [decToHex(numberOfBlocks), endBlock, percentiles],
  );

  const startBlockId = response.oldestBlock;

  if (
    response.baseFeePerGas.length > 0 &&
    response.gasUsedRatio.length > 0 &&
    response.reward.length > 0
  ) {
    // Per
    // <https://github.com/ethereum/go-ethereum/blob/57a3fab8a75eeb9c2f4fab770b73b51b9fe672c5/eth/gasprice/feehistory.go#L191-L192>,
    // baseFeePerGas will always include an extra item which is the calculated base fee for the
    // next (future) block. We don't care about this, so chop it off.
    const baseFeesPerGasAsHex = response.baseFeePerGas.slice(0, numberOfBlocks);
    const gasUsedRatios = response.gasUsedRatio;
    const priorityFeePercentileGroups = response.reward;

    const blocks = baseFeesPerGasAsHex.map((baseFeePerGasAsHex, blockIndex) => {
      const baseFeePerGas = hexToDec(baseFeePerGasAsHex);
      const gasUsedRatio = gasUsedRatios[blockIndex];
      const priorityFeesPerPercentile = priorityFeePercentileGroups[blockIndex];

      const priorityFeesByPercentile: Record<Percentile, number> = {} as Record<
        Percentile,
        number
      >;
      percentiles.forEach((percentile, percentileIndex) => {
        const priorityFee = priorityFeesPerPercentile[percentileIndex];
        priorityFeesByPercentile[percentile] = hexToDec(priorityFee);
      });

      return {
        baseFeePerGas,
        gasUsedRatio,
        priorityFeesByPercentile,
      };
    });

    return { startBlockId, blocks };
  }

  return { startBlockId, blocks: [] };
}
