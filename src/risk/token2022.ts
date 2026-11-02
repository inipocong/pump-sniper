
export interface TokenExtension {
  id: number;
  name: string;
  length: number;
}

const EXTENSION_NAMES: Record<number, string> = {
  1: "TransferFeeConfig",
  2: "TransferFeeAmount",
  3: "MintCloseAuthority",
  4: "ConfidentialTransferMint",
  5: "ConfidentialTransferAccount",
  6: "DefaultAccountState",
  7: "ImmutableOwner",
  8: "MemoTransfer",
  9: "NonTransferable",
  10: "InterestBearingConfig",
  11: "CpiGuard",
  12: "PermanentDelegate",
  13: "NonTransferableAccount",
  14: "TransferHook",
  15: "TransferHookAccount",
  16: "ConfidentialTransferFeeConfig",
  17: "ConfidentialTransferFeeAmount",
  18: "MetadataPointer",
  19: "TokenMetadata",
  20: "GroupPointer",
  21: "TokenGroup",
  22: "GroupMemberPointer",
  23: "TokenGroupMember",
  24: "ConfidentialMintBurn",
  25: "ScaledUiAmount",
  26: "Pausable",
  27: "PausableAccount"
};

export function parseToken2022MintExtensions(
  base64Data: string
): TokenExtension[] {
  const data = Buffer.from(base64Data, "base64");

  // Base Mint tanpa extension
  if (data.length === 82) return [];

  if (data.length < 82) {
    throw new Error("Mint account data is incomplete");
  }

  if (data.length < 166) {
    throw new Error("Extended mint data is incomplete");
  }

  const accountType = data[165];

  if (accountType !== 1) {
    throw new Error("Account is not an extended mint");
  }

  const extensions: TokenExtension[] = [];
  let offset = 166;

  while (offset + 4 <= data.length) {
    const id = data.readUInt16LE(offset);
    const length = data.readUInt16LE(offset + 2);
    offset += 4;

    if (id === 0) break;

    if (offset + length > data.length) {
      throw new Error("Malformed extension TLV data");
    }

    extensions.push({
      id,
      name: EXTENSION_NAMES[id] ?? `Unknown(${id})`,
      length
    });

    offset += length;
  }

  return extensions;
}
