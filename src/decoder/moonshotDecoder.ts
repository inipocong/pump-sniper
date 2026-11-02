import { RpcTransaction } from "./pumpCreateV2.js";

export interface DecodedMoonshot {
  mint: string;
  bondingCurve: string;
  creator: string;
  name: string;
  symbol: string;
  metadataUri: string;
}

function keyAt(keys: string[], index: number): string {
  const key = keys[index];
  if (!key) throw new Error(`Missing account key at index ${index}`);
  return key;
}

function flattenKeys(tx: RpcTransaction): string[] {
  const messageKeys = tx.transaction?.message?.accountKeys ?? [];
  const base = messageKeys.map(k => typeof k === "string" ? k : k.pubkey);
  return [
    ...base,
    ...(tx.meta?.loadedAddresses?.writable ?? []),
    ...(tx.meta?.loadedAddresses?.readonly ?? [])
  ];
}

function resolveProgramId(ix: any, keys: string[]): string {
  return ix.programId ?? (ix.programIdIndex === undefined ? "" : keyAt(keys, ix.programIdIndex));
}

function resolveAccounts(ix: any, keys: string[]): string[] {
  return ix.accounts.map((a: any) => typeof a === "string" ? a : keyAt(keys, a));
}

/**
 * Decoder resmi untuk instruksi pembuatan token Moonshot (DexScreener)
 */
export function decodeMoonshotTransaction(
  tx: RpcTransaction,
  signature: string,
  moonshotProgramId: string
): DecodedMoonshot | null {
  if (tx.meta?.err) return null;

  const keys = flattenKeys(tx);
  const outer = tx.transaction?.message?.instructions ?? [];
  const all = [...outer, ...(tx.meta?.innerInstructions ?? []).flatMap(g => g.instructions)];

  for (const ix of all) {
    if (resolveProgramId(ix, keys) !== moonshotProgramId) continue;

    const accounts = resolveAccounts(ix, keys);
    if (accounts.length < 5) continue;

    // Struktur akun standar Moonshot tokenMint:
    // [0] sender/creator (signer)
    // [1] senderTokenAccount
    // [2] curveAccount (bonding curve PDA)
    // [3] curveTokenAccount
    // [4] dexFeeAccount
    // [5] ...
    // [6] mint (SPL token mint)
    const creator = accounts[0];
    const curve = accounts[2];
    const mint = accounts.length > 6 ? accounts[6] : accounts[1];

    return {
      mint,
      bondingCurve: curve,
      creator,
      name: "Moonshot Token",
      symbol: "MOON",
      metadataUri: ""
    };
  }

  return null;
}
