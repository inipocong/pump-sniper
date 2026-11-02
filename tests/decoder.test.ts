
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import bs58 from "bs58";
import { decodeCreateV2Transaction } from "../src/decoder/pumpCreateV2.js";

const pumpProgramId = "PumpProgramTest";

function borshString(value: string): Buffer {
  const data = Buffer.from(value, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(data.length);
  return Buffer.concat([len, data]);
}

function makeFixture() {
  const creatorBytes = Buffer.alloc(32, 7);
  const creator = bs58.encode(creatorBytes);

  const discriminator = createHash("sha256")
    .update("global:create_v2")
    .digest()
    .subarray(0, 8);

  const data = Buffer.concat([
    discriminator,
    borshString("Test Token"),
    borshString("TEST"),
    borshString("https://example.com/token.json"),
    creatorBytes,
    Buffer.from([0])
  ]);

  const keys = Array.from(
    { length: 16 },
    (_, i) => bs58.encode(Buffer.alloc(32, i + 1))
  );

  keys.push(pumpProgramId);

  return {
    creator,
    mint: keys[0],
    bondingCurve: keys[2],
    tx: {
      transaction: {
        message: {
          accountKeys: keys,
          instructions: [{
            programIdIndex: 16,
            accounts: Array.from({ length: 16 }, (_, i) => i),
            data: bs58.encode(data)
          }]
        }
      },
      meta: { err: null }
    }
  };
}

test("decodes create_v2 fixture", () => {
  const fixture = makeFixture();

  const result = decodeCreateV2Transaction(
    fixture.tx,
    "test-signature",
    pumpProgramId
  );

  assert.ok(result);
  assert.equal(result.name, "Test Token");
  assert.equal(result.symbol, "TEST");
  assert.equal(result.creator, fixture.creator);
  assert.equal(result.mint, fixture.mint);
  assert.equal(result.bondingCurve, fixture.bondingCurve);
});

test("ignores failed transaction", () => {
  const fixture = makeFixture();
  fixture.tx.meta.err = { InstructionError: [0, "Custom"] };

  const result = decodeCreateV2Transaction(
    fixture.tx,
    "failed-signature",
    pumpProgramId
  );

  assert.equal(result, null);
});
