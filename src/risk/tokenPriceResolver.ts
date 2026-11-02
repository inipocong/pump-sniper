import { SolanaRpcClient } from "./solanaRpc.js";
import { getBondingCurveMetrics } from "./bondingCurve.js";
import { PublicKey } from "@solana/web3.js";
import { config } from "../config.js";
import { SOL_PRICE_USD } from "../paper/paperTrader.js";

export interface ResolvedTokenPrice {
  mint: string;
  symbol: string;
  name: string;
  priceInSol: number;
  source: "BONDING_CURVE" | "DEXSCREENER" | "FALLBACK";
}

const pumpProgramPk = new PublicKey(config.pumpProgramId);

/**
 * Turunkan PDA Bonding Curve untuk token Pump.fun jika tidak tercatat di SQLite
 */
export async function derivePumpBondingCurve(mint: string): Promise<string | null> {
  try {
    const mintPk = new PublicKey(mint);
    const [curvePda] = await PublicKey.findProgramAddress(
      [Buffer.from("bonding-curve"), Buffer.from(mintPk.toBytes())],
      pumpProgramPk
    );
    return curvePda.toBase58();
  } catch {
    return null;
  }
}

// Memory cache metadata token agar tidak query DexScreener berulang kali
const metadataCache = new Map<string, { symbol: string; name: string }>();

/**
 * Mengambil harga live & metadata token (baik di Pump.fun bonding curve maupun Raydium/PumpSwap)
 */
export async function resolveTokenPriceAndMetadata(
  rpc: SolanaRpcClient,
  mint: string,
  knownBondingCurve?: string | null
): Promise<ResolvedTokenPrice> {
  const curveAddress = knownBondingCurve || (await derivePumpBondingCurve(mint));

  // 1. Coba baca on-chain bonding curve Pump.fun terlebih dahulu
  if (curveAddress) {
    try {
      const curve = await getBondingCurveMetrics(rpc, curveAddress);
      if (curve && !curve.metrics.isComplete && curve.metrics.priceInSol > 0) {
        const cached = metadataCache.get(mint);
        return {
          mint,
          symbol: cached?.symbol || "PUMP_TOKEN",
          name: cached?.name || "Pump Token",
          priceInSol: curve.metrics.priceInSol,
          source: "BONDING_CURVE",
        };
      }
    } catch {}
  }

  // 2. Jika token sudah graduated (PumpSwap / Raydium) atau bonding curve kosong,
  // ambil harga & metadata akurat dari DexScreener
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, {
      signal: AbortSignal.timeout(2500),
    });
    if (res.ok) {
      const data = (await res.json()) as any;
      const pair = data.pairs?.[0];
      if (pair) {
        const symbol = pair.baseToken?.symbol || "WHALE_GEM";
        const name = pair.baseToken?.name || "Whale Gem";
        metadataCache.set(mint, { symbol, name });

        // Hitung harga dalam SOL
        let priceSol = 0;
        const wsolMint = "So11111111111111111111111111111111111111112";
        if (pair.quoteToken?.address === wsolMint && Number(pair.priceNative) > 0) {
          priceSol = Number(pair.priceNative);
        } else if (Number(pair.priceUsd) > 0) {
          priceSol = Number((Number(pair.priceUsd) / SOL_PRICE_USD).toExponential(6));
        }

        if (priceSol > 0) {
          return {
            mint,
            symbol,
            name,
            priceInSol: priceSol,
            source: "DEXSCREENER",
          };
        }
      }
    }
  } catch {}

  const cached = metadataCache.get(mint);
  return {
    mint,
    symbol: cached?.symbol || "WHALE_GEM",
    name: cached?.name || "Whale Gem",
    priceInSol: 3e-8,
    source: "FALLBACK",
  };
}
