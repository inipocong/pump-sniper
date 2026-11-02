
import assert from "node:assert/strict";
import { test } from "node:test";
import { SolanaRpcClient } from "../src/risk/solanaRpc.js";

const TOKEN_PROGRAM =
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

const TOKEN_2022_PROGRAM =
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

// USDC mainnet mint, digunakan sebagai fixture publik.
const USDC_MINT =
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

test("reads mint account and identifies token program", async () => {
  const rpc = new SolanaRpcClient();

  const account = await rpc.getAccountInfo(USDC_MINT);

  assert.ok(account, "Mint account not found");

  const programType =
    account.owner === TOKEN_PROGRAM
      ? "SPL_TOKEN"
      : account.owner === TOKEN_2022_PROGRAM
        ? "TOKEN_2022"
        : "UNKNOWN";

  console.log("MINT:", USDC_MINT);
  console.log("OWNER:", account.owner);
  console.log("PROGRAM TYPE:", programType);
  console.log("LAMPORTS:", account.lamports);

  assert.equal(programType, "SPL_TOKEN");
  assert.equal(account.executable, false);

  console.log("MINT PROGRAM CHECK: PASS");
});
