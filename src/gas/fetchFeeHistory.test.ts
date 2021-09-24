import { fetchFeeHistory, EthFeeHistoryResponse } from './fetchFeeHistory';

describe('fetchRecentFeeHistory', () => {
  /**
   * Builds an EthQuery double that returns a mock response for `eth_feeHistory`.
   *
   * @param ethFeeHistoryResponse - The response for `eth_feeHistory`
   * @returns The EthQuery double.
   */
  function buildEthQuery(ethFeeHistoryResponse: EthFeeHistoryResponse) {
    return {
      eth_feeHistory: (...args: any[]) => {
        const cb = args.pop();
        cb(null, ethFeeHistoryResponse);
      },
    };
  }

  it('should return a representation of fee history from the Ethereum network, organized by block rather than type of data', async () => {
    // To reproduce:
    //
    // curl -X POST --data '{
    //   "id": 1,
    //   "jsonrpc": "2.0",
    //   "method": "eth_feeHistory",
    //   "params": ["0x5", "latest", [10, 20, 30]]
    // }' https://mainnet.infura.io/v3/<PROJECT_ID>
    const ethQuery = buildEthQuery({
      oldestBlock: '0xcb1939',
      // Note that this array contains 6 items when we requested 5. Per
      // <https://github.com/ethereum/go-ethereum/blob/57a3fab8a75eeb9c2f4fab770b73b51b9fe672c5/eth/gasprice/feehistory.go#L191-L192>,
      // baseFeePerGas will always include an extra item which is the calculated base fee for the
      // next (future) block.
      baseFeePerGas: [
        '0x16eb46a3bb',
        '0x14cd6f0628',
        '0x1763700ef2',
        '0x1477020d14',
        '0x129c9eb46b',
        '0x134002f480',
      ],
      gasUsedRatio: [
        0.13060046666666666,
        0.9972395333333334,
        0,
        0.13780313333333333,
        0.6371707333333333,
      ],
      reward: [
        ['0x59682f00', '0x59682f00', '0x59682f00'],
        ['0x540ae480', '0x59682f00', '0x59682f00'],
        ['0x0', '0x0', '0x0'],
        ['0x3b9aca00', '0x3b9aca00', '0x3b9aca00'],
        ['0x59682f00', '0x59682f00', '0x59682f00'],
      ],
    });

    const feeHistory = await fetchFeeHistory({
      ethQuery,
      numberOfBlocks: 5,
      percentiles: [10, 20, 30],
    });

    expect(feeHistory).toStrictEqual({
      startBlockId: '0xcb1939',
      blocks: [
        {
          baseFeePerGas: 98436555707,
          gasUsedRatio: 0.13060046666666666,
          priorityFeesByPercentile: new Map([
            [10, 1500000000],
            [20, 1500000000],
            [30, 1500000000],
          ]),
        },
        {
          baseFeePerGas: 89345951272,
          gasUsedRatio: 0.9972395333333334,
          priorityFeesByPercentile: new Map([
            [10, 1410000000],
            [20, 1500000000],
            [30, 1500000000],
          ]),
        },
        {
          baseFeePerGas: 100452536050,
          gasUsedRatio: 0,
          priorityFeesByPercentile: new Map([
            [10, 0],
            [20, 0],
            [30, 0],
          ]),
        },
        {
          baseFeePerGas: 87895969044,
          gasUsedRatio: 0.13780313333333333,
          priorityFeesByPercentile: new Map([
            [10, 1000000000],
            [20, 1000000000],
            [30, 1000000000],
          ]),
        },
        {
          baseFeePerGas: 79937057899,
          gasUsedRatio: 0.6371707333333333,
          priorityFeesByPercentile: new Map([
            [10, 1500000000],
            [20, 1500000000],
            [30, 1500000000],
          ]),
        },
      ],
    });
  });

  it('should handle an "empty" response from eth_feeHistory', async () => {
    const ethQuery = buildEthQuery({
      oldestBlock: '0x0',
      baseFeePerGas: [],
      gasUsedRatio: [],
      reward: [],
    });

    const feeHistory = await fetchFeeHistory({
      ethQuery,
      numberOfBlocks: 5,
      percentiles: [10, 20, 30],
    });

    expect(feeHistory).toStrictEqual({
      startBlockId: '0x0',
      blocks: [],
    });
  });
});
