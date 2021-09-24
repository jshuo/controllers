import { BN } from 'ethereumjs-util';
import { stripHexPrefix } from 'ethjs-util';
import { query, zipEqualSizedTuples } from '../util';

type HexString = `0x${string}`;

/**
 * @type FeeHistory
 *
 * Historical data for gas and priority fees for a range of blocks within a particular network. This
 * can be used to gauge how congested the network is.
 * @property startBlockId - The id of the oldest block in the block range requested (as hex).
 * @property blocks - Data for the blocks in the block range requested.
 */
export type FeeHistory = {
  startBlockId: HexString;
  blocks: BlockFeeHistory[];
};

/**
 * @type BlockFeeHistory
 *
 * Historical data for gas and priority fees for a block.
 * @property baseFeePerGas - The base fee per gas for the block.
 * @property gasUsedRatio - A number between 0 and 1 that represents the ratio between the effective
 * gas used and the gas limit for the block.
 * @property priorityFeesByPercentile - The priority fees paid for the transactions in the block
 * that occurred at particular percentiles (using the gas used vs. gas limit ratio to determine
 * those percentiles), then indexed by those percentiles.
 */
type BlockFeeHistory = {
  baseFeePerGas: number;
  gasUsedRatio: number;
  priorityFeesByPercentile: Map<number, number>;
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
 * Uses eth_feeHistory (an EIP-1559 feature) to obtain information about gas and priority fees from
 * a range of blocks that appeared on a network, starting from a particular block and working
 * backward in time. This can be used to gauge how congested the network is.
 *
 * To learn more, see these resources:
 *
 * - <https://infura.io/docs/ethereum#operation/eth_feeHistory>
 * - <https://github.com/zsfelfoldi/feehistory/blob/main/docs/feeHistory.md>
 * - <https://github.com/ethereum/go-ethereum/blob/57a3fab8a75eeb9c2f4fab770b73b51b9fe672c5/eth/gasprice/feehistory.go#L191-L192>
 * - <https://github.com/ethereum/EIPs/blob/master/EIPS/eip-1559.md>
 * - <https://gas-api.metaswap.codefi.network/testFeeHistory>
 *
 * @param args - The arguments.
 * @param args.ethQuery - An EthQuery instance that wraps a provider for the network in question.
 * @param args.endBlock - Which block to start with when forming the block range. Can be a block tag
 * ("latest" for the latest successful block or "pending" for the latest pending block) or a block
 * id.
 * @param args.numberOfBlocks - How many blocks to jump back from the endBlock when forming the
 * block range. Each array in the return value will be of this length.
 * @param args.percentiles - A tuple of numbers between 1 and 100 which will advise how
 * priorityFeesByPercentile in the return value will be formed. When Ethereum runs the
 * eth_feeHistory method, for each block it is considering, it will calculate the ratio of gas used
 * for each transaction compared to the total gas used for the block, then sort all transactions in
 * the block by this ratio. For each percentile given here, it will then find the transaction whose
 * gas used ratio matches the percentile and capture that transaction's priority fee. Hence,
 * priorityFeesByPercentile represents the priority fees of transactions at key gas used ratios.
 * @returns The fee history data.
 */
export async function fetchFeeHistory({
  ethQuery,
  endBlock = 'latest',
  numberOfBlocks,
  percentiles,
}: {
  ethQuery: any;
  endBlock?: 'latest' | 'pending' | HexString;
  numberOfBlocks: number;
  percentiles: number[];
}): Promise<FeeHistory> {
  const response: EthFeeHistoryResponse = await query(
    ethQuery,
    'eth_feeHistory',
    [decToHex(numberOfBlocks), endBlock, percentiles],
  );

  const startBlockId = response.oldestBlock;
  let blocks: BlockFeeHistory[] = [];

  if (
    response.baseFeePerGas.length > 0 &&
    response.gasUsedRatio.length > 0 &&
    response.reward.length > 0
  ) {
    blocks = zipEqualSizedTuples({
      tuples: [
        // Per
        // <https://github.com/ethereum/go-ethereum/blob/57a3fab8a75eeb9c2f4fab770b73b51b9fe672c5/eth/gasprice/feehistory.go#L191-L192>,
        // baseFeePerGas will always include an extra item which is the calculated base fee for the
        // next (future) block. We don't care about this, so chop it off.
        response.baseFeePerGas.slice(0, numberOfBlocks),
        response.gasUsedRatio,
        response.reward,
      ],
      numberOfColumnsPerTuple: numberOfBlocks,
    }).map(([baseFeePerGasAsHex, gasUsedRatio, priorityFeesAsHex]) => {
      const baseFeePerGas = hexToDec(baseFeePerGasAsHex);

      const priorityFeesByPercentile: Map<number, number> = zipEqualSizedTuples(
        {
          tuples: [percentiles, priorityFeesAsHex],
          numberOfColumnsPerTuple: percentiles.length,
        },
      ).reduce((map, [percentile, priorityFeeAsHex]) => {
        map.set(percentile, hexToDec(priorityFeeAsHex));
        return map;
      }, new Map());

      return {
        baseFeePerGas,
        gasUsedRatio,
        priorityFeesByPercentile,
      };
    });
  }

  return { startBlockId, blocks };
}
