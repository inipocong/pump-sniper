import { SolanaRpcClient } from "./solanaRpc.js";

// Discriminator Anchor resmi Pump.fun untuk BondingCurve (sha256("account:BondingCurve")[0..8])
const BONDING_CURVE_DISCRIMINATOR = Buffer.from([0x17, 0xb7, 0xf8, 0x37, 0x60, 0xd8, 0xac, 0x60]);

// Target cadangan SOL nyata Pump.fun untuk lulus/migrasi ke Raydium (~85 SOL dalam lamports)
const GRADUATION_SOL_LAMPORTS = 85_000_000_000n; // 85 * 10^9

export interface BondingCurveState {
  virtualTokenReserves: bigint;
  virtualSolReserves: bigint;
  realTokenReserves: bigint;
  realSolReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;
}

export interface BondingCurveMetrics {
  priceInSol: number;        // Harga 1 token dalam SOL
  marketCapSol: number;      // Market Cap koin dalam SOL
  progressPercent: number;   // Kemajuan bonding curve (0% - 100%)
  realSolCollected: number;  // Jumlah SOL nyata yang terkumpul di kurva
  devHoldingPct: number;     // Estimasi persentase suplai yang dibeli dev di awal (0% - 100%)
  isComplete: boolean;       // Apakah sudah lulus ke Raydium
}

/**
 * Membaca data binary mentah akun BondingCurve Pump.fun dari Base64.
 */
export function parseBondingCurveData(base64Data: string): BondingCurveState {
  const buf = Buffer.from(base64Data, "base64");

  if (buf.length < 49) {
    throw new Error(`Data bonding curve terlalu pendek: ${buf.length} bytes (minimal 49 bytes)`);
  }

  // Validasi discriminator akun
  const disc = buf.subarray(0, 8);
  if (!disc.equals(BONDING_CURVE_DISCRIMINATOR)) {
    throw new Error("Discriminator akun bukan BondingCurve Pump.fun yang valid");
  }

  return {
    virtualTokenReserves: buf.readBigUInt64LE(8),
    virtualSolReserves: buf.readBigUInt64LE(16),
    realTokenReserves: buf.readBigUInt64LE(24),
    realSolReserves: buf.readBigUInt64LE(32),
    tokenTotalSupply: buf.readBigUInt64LE(40),
    complete: buf.readUInt8(48) === 1,
  };
}

/**
 * Menghitung metrik matematis dari state BondingCurve:
 * - Harga token dalam SOL
 * - Market Cap dalam SOL
 * - Persentase progress bonding curve (0 - 100%)
 */
export function calculateBondingCurveMetrics(state: BondingCurveState): BondingCurveMetrics {
  // Token Pump.fun memiliki 6 desimal, SOL memiliki 9 desimal (1 SOL = 1e9 lamports)
  const vSol = Number(state.virtualSolReserves) / 1e9;
  const vToken = Number(state.virtualTokenReserves) / 1e6;
  const totalSupply = Number(state.tokenTotalSupply) / 1e6;
  const realSol = Number(state.realSolReserves) / 1e9;

  // Harga 1 token dalam SOL = virtualSol / virtualToken
  const priceInSol = vToken > 0 ? vSol / vToken : 0;

  // Market cap = total supply * harga per token
  const marketCapSol = totalSupply * priceInSol;

  // Progress kurva: realSolReserves / 85 SOL (dibatasi 0% - 100%)
  const progressRatio = Number(state.realSolReserves) / Number(GRADUATION_SOL_LAMPORTS);
  const progressPercent = Math.min(100, Math.max(0, Number((progressRatio * 100).toFixed(2))));

  // Pada awal peluncuran Pump.fun, cadangan token nyata di kurva adalah 793.1M token
  const initialRealTokens = 793_100_000_000_000n;
  const tokensBought = initialRealTokens > state.realTokenReserves ? initialRealTokens - state.realTokenReserves : 0n;
  const devHoldingRatio = Number(tokensBought) / Number(state.tokenTotalSupply);
  const devHoldingPct = Number(Math.max(0, devHoldingRatio * 100).toFixed(2));

  return {
    priceInSol,
    marketCapSol: Number(marketCapSol.toFixed(4)),
    progressPercent: state.complete ? 100 : progressPercent,
    realSolCollected: Number(realSol.toFixed(4)),
    devHoldingPct,
    isComplete: state.complete,
  };
}

/**
 * Mengambil data Bonding Curve langsung dari RPC Solana untuk address tertentu.
 */
export async function getBondingCurveMetrics(
  rpc: SolanaRpcClient,
  bondingCurveAddress: string
): Promise<{ state: BondingCurveState; metrics: BondingCurveMetrics } | null> {
  try {
    const accountInfo = await rpc.getAccountInfo(bondingCurveAddress);
    if (!accountInfo) return null;

    const state = parseBondingCurveData(accountInfo.data[0]);
    const metrics = calculateBondingCurveMetrics(state);

    return { state, metrics };
  } catch {
    return null;
  }
}
