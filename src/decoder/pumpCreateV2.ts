import { createHash } from "node:crypto";
import bs58 from "bs58";

export interface RpcInstruction {
  programIdIndex?: number;
  programId?: string;
  accounts: number[] | string[];
  data: string;
}
export interface RpcTransaction {
  transaction?: { message?: { accountKeys?: Array<string | { pubkey: string }>; instructions?: RpcInstruction[] } };
  meta?: {
    err?: unknown;
    loadedAddresses?: { writable?: string[]; readonly?: string[] };
    innerInstructions?: Array<{ instructions: RpcInstruction[] }>;
    postTokenBalances?: Array<{ mint: string; owner?: string }>;
  };
}
export interface DecodedCreateV2 {
  mint: string;
  bondingCurve: string;
  creator: string;
  name: string;
  symbol: string;
  metadataUri: string;
}
const CREATE_V2_DISC = createHash("sha256").update("global:create_v2").digest().subarray(0, 8);

function readU32LE(buf: Buffer, offset: number): number {
  if (offset + 4 > buf.length) throw new Error("Truncated Borsh u32");
  return buf.readUInt32LE(offset);
}
function readString(buf: Buffer, state: { offset: number }): string {
  const len = readU32LE(buf, state.offset); state.offset += 4;
  if (len > 10_000 || state.offset + len > buf.length) throw new Error("Invalid/truncated Borsh string");
  const out = buf.subarray(state.offset, state.offset + len).toString("utf8");
  state.offset += len; return out;
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
function resolveProgramId(ix: RpcInstruction, keys: string[]): string {
  return ix.programId ?? (ix.programIdIndex === undefined ? "" : keyAt(keys, ix.programIdIndex));
}
function resolveAccounts(ix: RpcInstruction, keys: string[]): string[] {
  return ix.accounts.map(a => typeof a === "string" ? a : keyAt(keys, a));
}

/**
 * Decode create_v2 only. Account positions and argument layout are based on
 * Pump's current official COIN_CREATION.md. Unknown/legacy variants fail closed.
 */
export function decodeCreateV2Transaction(tx: RpcTransaction, signature: string, pumpProgramId: string): DecodedCreateV2 | null {
  if (tx.meta?.err) return null;
  const keys = flattenKeys(tx);
  const outer = tx.transaction?.message?.instructions ?? [];
  const all = [...outer, ...(tx.meta?.innerInstructions ?? []).flatMap(g => g.instructions)];
  for (const ix of all) {
    if (resolveProgramId(ix, keys) !== pumpProgramId) continue;
    let bytes: Buffer;
    try { bytes = Buffer.from(bs58.decode(ix.data)); } catch { continue; }
    if (bytes.length < 8 || !bytes.subarray(0, 8).equals(CREATE_V2_DISC)) continue;
    const accounts = resolveAccounts(ix, keys);
    // Official create_v2 account list: mint is #1, bonding_curve is #3 (1-based).
    if (accounts.length < 16) throw new Error(`create_v2 ${signature}: expected >=16 accounts, got ${accounts.length}`);
    const state = { offset: 8 };
    const name = readString(bytes, state);
    const symbol = readString(bytes, state);
    const metadataUri = readString(bytes, state);
    if (state.offset + 32 + 1 > bytes.length) throw new Error("Truncated create_v2 creator/bool arguments");
    const creator = bs58.encode(bytes.subarray(state.offset, state.offset + 32));
    return {
      mint: accounts[0],
      bondingCurve: accounts[2],
      creator,
      name,
      symbol,
      metadataUri
    };
  }
  return null;
}
