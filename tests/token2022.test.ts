import assert from "node:assert/strict";
import { test } from "node:test";
import { parseToken2022MintExtensions } from "../src/risk/token2022.js";

function makeMintData(extension?: {
  id: number;
  value: Buffer;
}): string {
  if (!extension) {
    return Buffer.alloc(82).toString("base64");
  }

  const data = Buffer.alloc(166 + 4 + extension.value.length);
  data[165] = 1;

  data.writeUInt16LE(extension.id, 166);
  data.writeUInt16LE(extension.value.length, 168);
  extension.value.copy(data, 170);

  return data.toString("base64");
}

test("mint tanpa extension menghasilkan array kosong", () => {
  assert.deepEqual(
    parseToken2022MintExtensions(makeMintData()),
    []
  );
});

test("extension dikenal berhasil dibaca", () => {
  const result = parseToken2022MintExtensions(
    makeMintData({
      id: 3,
      value: Buffer.alloc(32)
    })
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].name, "MintCloseAuthority");
});

test("extension tidak dikenal ditandai Unknown", () => {
  const result = parseToken2022MintExtensions(
    makeMintData({
      id: 999,
      value: Buffer.alloc(4)
    })
  );

  assert.equal(result[0].name, "Unknown(999)");
});

test("data TLV rusak harus ditolak", () => {
  const data = Buffer.alloc(170);
  data[165] = 1;
  data.writeUInt16LE(3, 166);
  data.writeUInt16LE(100, 168);

  assert.throws(
    () => parseToken2022MintExtensions(data.toString("base64")),
    /Malformed extension TLV data/
  );
});