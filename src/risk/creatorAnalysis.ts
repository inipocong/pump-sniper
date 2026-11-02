import { SolanaRpcClient } from "./solanaRpc.js";
import type { RiskCheck } from "../types.js";

export interface CreatorProfile {
  address: string;
  balanceSol: number;
  txCount: number;
  walletAgeMinutes: number | null;
  isBurnerWallet: boolean;
}

export interface CreatorAnalysisResult {
  profile: CreatorProfile;
  checks: RiskCheck[];
}

/**
 * Menganalisis reputasi dan riwayat on-chain wallet creator/dev koin:
 * 1. Mengecek saldo SOL dev saat ini.
 * 2. Mengambil riwayat transaksi terakhir.
 * 3. Menghitung usia wallet (kapan transaksi pertama kali terjadi).
 * 4. Mendeteksi apakah ini throwaway/burner wallet yang sengaja dibuat untuk rug pull.
 */
export async function analyzeCreator(
  rpc: SolanaRpcClient,
  creatorAddress: string
): Promise<CreatorAnalysisResult> {
  const checks: RiskCheck[] = [];

  let balanceLamports = 0;
  let signatures: Awaited<ReturnType<SolanaRpcClient["getSignaturesForAddress"]>> = [];

  try {
    const [bal, sigs] = await Promise.all([
      rpc.getBalance(creatorAddress),
      rpc.getSignaturesForAddress(creatorAddress, 25),
    ]);
    balanceLamports = bal;
    signatures = sigs;
  } catch (err) {
    checks.push({
      name: "creator_reputation",
      passed: null,
      severity: "HIGH",
      message: "Gagal mengambil riwayat transaksi creator dari RPC",
      evidence: String(err),
    });

    return {
      profile: {
        address: creatorAddress,
        balanceSol: 0,
        txCount: 0,
        walletAgeMinutes: null,
        isBurnerWallet: true,
      },
      checks,
    };
  }

  const balanceSol = Number((balanceLamports / 1e9).toFixed(4));
  const txCount = signatures.length;

  // Hitung usia wallet berdasarkan blockTime transaksi paling lama
  const validTimes = signatures
    .map(s => s.blockTime)
    .filter((t): t is number => t !== null && t > 0);

  const nowSeconds = Math.floor(Date.now() / 1000);
  const oldestTime = validTimes.length > 0 ? Math.min(...validTimes) : null;
  const walletAgeMinutes = oldestTime !== null ? Math.max(0, Math.floor((nowSeconds - oldestTime) / 60)) : null;

  // Indikasi kuat burner wallet: transaksi sangat sedikit (<= 2) atau umur < 30 menit
  const isBurnerWallet = txCount <= 2 || (walletAgeMinutes !== null && walletAgeMinutes < 30);

  // ─── CHECK 1: Usia Wallet Dev ─────────────────────────────────────────────
  if (walletAgeMinutes !== null && walletAgeMinutes < 15) {
    checks.push({
      name: "creator_wallet_age",
      passed: false,
      severity: "HIGH",
      message: `Wallet dev sangat baru (${walletAgeMinutes} menit lalu), indikasi kuat burner wallet`,
      evidence: `age=${walletAgeMinutes}m, txs=${txCount}`,
    });
  } else {
    checks.push({
      name: "creator_wallet_age",
      passed: true,
      severity: "LOW",
      message: walletAgeMinutes !== null
        ? `Usia wallet memadai (~${walletAgeMinutes} menit)`
        : "Usia wallet tidak terdeteksi tapi riwayat ada",
      evidence: `age=${walletAgeMinutes ?? "unknown"}m`,
    });
  }

  // ─── CHECK 2: Volume / Reputasi Transaksi ─────────────────────────────────
  if (txCount <= 2) {
    checks.push({
      name: "creator_tx_history",
      passed: false,
      severity: "MEDIUM",
      message: `Aktivitas transaksi dev sangat minim (${txCount} tx), minim reputasi on-chain`,
      evidence: `txCount=${txCount}`,
    });
  } else {
    checks.push({
      name: "creator_tx_history",
      passed: true,
      severity: "LOW",
      message: `Dev memiliki riwayat aktivitas (${txCount}+ transaksi)`,
      evidence: `txCount=${txCount}`,
    });
  }

  // ─── CHECK 3: Saldo SOL Dev ──────────────────────────────────────────────
  if (balanceSol < 0.02) {
    checks.push({
      name: "creator_sol_balance",
      passed: false,
      severity: "MEDIUM",
      message: `Saldo SOL dev sangat tipis (${balanceSol} SOL), dev tidak memiliki modal likuiditas`,
      evidence: `balance=${balanceSol} SOL`,
    });
  } else {
    checks.push({
      name: "creator_sol_balance",
      passed: true,
      severity: "LOW",
      message: `Saldo dev cukup (${balanceSol} SOL)`,
      evidence: `balance=${balanceSol} SOL`,
    });
  }

  return {
    profile: {
      address: creatorAddress,
      balanceSol,
      txCount,
      walletAgeMinutes,
      isBurnerWallet,
    },
    checks,
  };
}