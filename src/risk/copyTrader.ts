import { logger } from "../logger.js";

export interface WhaleTrackItem {
  wallet: string;
  mint: string;
  symbol: string;
  totalTokensAccumulated: number;
  initialBuyTimestamp: number;
  buyCount: number;
  weBought: boolean;
}

export interface WhaleTradeEvent {
  type: "BUY" | "SELL" | "IGNORE";
  wallet: string;
  mint: string;
  symbol: string;
  tokenDelta: number;
  isFirstBuy: boolean;
  pctSold?: number;
  whaleTotalHolding: number;
}

export class CopyTradeTracker {
  // Key format: `${wallet}_${mint}`
  private trackedWhalePositions = new Map<string, WhaleTrackItem>();

  /**
   * Catat & Evaluasi Transaksi Whale (Buy Akumulasi atau Sell Proporsional)
   */
  processWhaleTokenChange(
    wallet: string,
    mint: string,
    symbol: string,
    preAmount: number,
    postAmount: number
  ): WhaleTradeEvent {
    const key = `${wallet}_${mint}`;
    const delta = postAmount - preAmount;

    if (Math.abs(delta) < 0.0001) {
      return {
        type: "IGNORE",
        wallet,
        mint,
        symbol,
        tokenDelta: 0,
        isFirstBuy: false,
        whaleTotalHolding: postAmount,
      };
    }

    // ─── 1. KASUS WHALE BUY (BELI TOKEN) ───────────────────────────────────
    if (delta > 0) {
      const existing = this.trackedWhalePositions.get(key);

      if (!existing) {
        // Pembelian pertama kali (First Entry) -> KITA IKUT BUY!
        const newItem: WhaleTrackItem = {
          wallet,
          mint,
          symbol,
          totalTokensAccumulated: postAmount,
          initialBuyTimestamp: Date.now(),
          buyCount: 1,
          weBought: true,
        };
        this.trackedWhalePositions.set(key, newItem);

        logger.info(
          {
            wallet: wallet.substring(0, 8) + "...",
            symbol,
            tokensBought: delta,
            totalHolding: postAmount,
          },
          `🐋 [WHALE FIRST BUY] Target wallet masuk di ${symbol}! Memulai copy buy 1x!`
        );

        return {
          type: "BUY",
          wallet,
          mint,
          symbol,
          tokenDelta: delta,
          isFirstBuy: true,
          whaleTotalHolding: postAmount,
        };
      } else {
        // Pembelian bertahap (DCA / Buy ke-2, ke-3, dst.) -> AKUMULASIKAN SAJA, JANGAN BUY LAGI!
        existing.totalTokensAccumulated = postAmount;
        existing.buyCount++;

        logger.info(
          {
            wallet: wallet.substring(0, 8) + "...",
            symbol,
            buyRound: existing.buyCount,
            addedTokens: delta,
            totalHolding: postAmount,
          },
          `🐋 [WHALE DCA ACCUMULATION] Target wallet akumulasi lagi ${symbol} (Buy #${existing.buyCount})! Total akumulasi: ${Math.round(postAmount).toLocaleString()} token. Kita tetap hold tanpa buy ulang.`
        );

        return {
          type: "BUY",
          wallet,
          mint,
          symbol,
          tokenDelta: delta,
          isFirstBuy: false,
          whaleTotalHolding: postAmount,
        };
      }
    }

    // ─── 2. KASUS WHALE SELL (JUAL TOKEN) ──────────────────────────────────
    const tokensSold = Math.abs(delta);
    const existing = this.trackedWhalePositions.get(key);
    const holdingBefore = preAmount > 0 ? preAmount : (existing?.totalTokensAccumulated ?? tokensSold);

    const pctSold = holdingBefore > 0
      ? Number(Math.min(100, Math.max(0, (tokensSold / holdingBefore) * 100)).toFixed(2))
      : 100;

    const isFullExit = postAmount <= 0.0001 || pctSold >= 98;

    if (existing) {
      if (isFullExit) {
        this.trackedWhalePositions.delete(key);
      } else {
        existing.totalTokensAccumulated = postAmount;
      }
    }

    logger.info(
      {
        wallet: wallet.substring(0, 8) + "...",
        symbol,
        tokensSold,
        pctSold: `${pctSold}%`,
        isFullExit,
        remainingWhaleTokens: postAmount,
      },
      `🐋 [WHALE SELL DETECTED] Target wallet jual ${pctSold}% token ${symbol}! Menyiapkan copy sell proporsional (${pctSold}%)...`
    );

    return {
      type: "SELL",
      wallet,
      mint,
      symbol,
      tokenDelta: delta,
      isFirstBuy: false,
      pctSold,
      whaleTotalHolding: postAmount,
    };
  }

  isTracking(wallet: string, mint: string): boolean {
    return this.trackedWhalePositions.has(`${wallet}_${mint}`);
  }

  getWhalePosition(wallet: string, mint: string): WhaleTrackItem | undefined {
    return this.trackedWhalePositions.get(`${wallet}_${mint}`);
  }
}
