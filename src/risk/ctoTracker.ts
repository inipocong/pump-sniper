import { logger } from "../logger.js";

export interface CtoWatchItem {
  mint: string;
  symbol: string;
  creator: string;
  bondingCurve: string;
  dipPrice: number;
  dipTimestamp: number;
  initialSolReserves: number;
  highestReboundPrice: number;
  status: "WATCHING" | "REBOUNDED" | "EXPIRED";
}

export interface CtoReboundResult {
  isConfirmed: boolean;
  reboundPercent: number;
  dipPrice: number;
  currentPrice: number;
  reboundDurationSec: number;
}

export class CtoReboundTracker {
  private watchedTokens = new Map<string, CtoWatchItem>();

  /**
   * Catat saat ada event Dev buang barang (Dev Jeeted)
   */
  recordDevJeet(
    mint: string,
    symbol: string,
    creator: string,
    dipPrice: number,
    bondingCurve: string,
    currentSolReserves: number
  ): void {
    if (this.watchedTokens.has(mint)) return;

    this.watchedTokens.set(mint, {
      mint,
      symbol,
      creator,
      bondingCurve,
      dipPrice,
      dipTimestamp: Date.now(),
      initialSolReserves: currentSolReserves,
      highestReboundPrice: dipPrice,
      status: "WATCHING",
    });

    logger.warn(
      {
        symbol,
        mint: mint.substring(0, 8) + "...",
        dipPrice,
        creator: creator.substring(0, 8) + "...",
      },
      `📢 [DEV JEET DETECTED] Dev buang semua token ${symbol}! Memulai pemantauan CTO Rebound (Jendela 10-35 detik)...`
    );
  }

  /**
   * Evaluasi apakah token yang dev-nya kabur berhasil memantul (V-Shape Recovery)
   */
  evaluateRebound(
    mint: string,
    currentPrice: number,
    currentSolReserves: number
  ): CtoReboundResult | null {
    const item = this.watchedTokens.get(mint);
    if (!item || item.status !== "WATCHING") return null;

    const elapsedSec = Math.floor((Date.now() - item.dipTimestamp) / 1000);

    // Jika lewat 40 detik koin tidak memantul, koin dinyatakan MATI
    if (elapsedSec > 40) {
      item.status = "EXPIRED";
      this.watchedTokens.delete(mint);
      return null;
    }

    if (currentPrice > item.highestReboundPrice) {
      item.highestReboundPrice = currentPrice;
    }

    // Beri jeda minimal 6 detik agar panic sell selesai dan daya serap pasar teruji
    if (elapsedSec >= 6) {
      const reboundPercent = Number(
        (((currentPrice - item.dipPrice) / item.dipPrice) * 100).toFixed(2)
      );

      // Kriteria Konfirmasi CTO Rebound:
      // 1. Harga memantul minimal +15% dari dasar dip
      // 2. Cadangan SOL di kurva bertambah (bukti ada net buyer baru yang menyerap koin dev!)
      const hasPriceBounce = reboundPercent >= 15.0;
      const hasAbsorptionVolume = currentSolReserves >= item.initialSolReserves * 1.02;

      if (hasPriceBounce && hasAbsorptionVolume) {
        item.status = "REBOUNDED";
        this.watchedTokens.delete(mint); // Selesai dipantau, siap disnipe!

        logger.info(
          {
            symbol: item.symbol,
            reboundPercent,
            dipPrice: item.dipPrice,
            currentPrice,
            durationSec: elapsedSec,
          },
          `🚀 [CTO REBOUND CONFIRMED] ${item.symbol} V-Shape Recovery (+${reboundPercent}% dari dasar dip)! Komunitas menyerap bersih dump dev!`
        );

        return {
          isConfirmed: true,
          reboundPercent,
          dipPrice: item.dipPrice,
          currentPrice,
          reboundDurationSec: elapsedSec,
        };
      }
    }

    return null;
  }

  isWatching(mint: string): boolean {
    return this.watchedTokens.has(mint);
  }

  getWatchList(): CtoWatchItem[] {
    return Array.from(this.watchedTokens.values());
  }
}
