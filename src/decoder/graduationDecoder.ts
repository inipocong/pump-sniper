import { RpcTransaction } from "./pumpCreateV2.js";

const WSOL_MINT = "So11111111111111111111111111111111111111112";

export interface DecodedGraduation {
  mint: string;
  source: "pump_graduation" | "raydium_migration";
}

/**
 * Mendeteksi token yang sedang bermigrasi / lulus ke Raydium dari transaksi migrasi
 */
export function decodeGraduationTransaction(tx: RpcTransaction): DecodedGraduation | null {
  if (tx.meta?.err) return null;

  // Solana mencatat perubahan saldo token SPL di postTokenBalances
  const balances = tx.meta?.postTokenBalances ?? [];
  const tokenEntry = balances.find((b: { mint: string }) => b.mint && b.mint !== WSOL_MINT);

  if (tokenEntry && tokenEntry.mint) {
    return {
      mint: tokenEntry.mint,
      source: "pump_graduation",
    };
  }

  return null;
}
