import { test } from "node:test";
import assert from "node:assert/strict";
import { assessToken2022Risk } from "../src/risk/token2022Adapter.js";
import { SolanaRpcClient } from "../src/risk/solanaRpc.js";
import { config } from "../src/config.js";

// Endpoint RPC
const rpcUrl = config.rpcUrl || "https://api.mainnet-beta.solana.com";
const rpc = new SolanaRpcClient(rpcUrl);

// 1. USDC Mint resmi di Solana
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// 2. Fake Mint (Alamat buatan yang tidak pernah ada di blockchain)
const FAKE_MINT = "11111111111111111111111111111112";

test("real mainnet mint: USDC SPL Token check", async () => {
  console.log(`\n📡 Menghubungi RPC: ${rpcUrl}`);
  console.log(`🔍 Memeriksa USDC Mint: ${USDC_MINT}`);

  const res = await assessToken2022Risk(USDC_MINT, "REAL-SIG-USDC", rpc);

  console.log("   Program Type :", res.programType);
  console.log("   Verdict      :", res.assessment.verdict);
  console.log("   Reasons      :", res.assessment.reasons.join(", "));

  // Token resmi SPL harus terdeteksi dan lolos (ALLOW)
  assert.equal(res.programType, "SPL_TOKEN", "USDC harus terdeteksi sebagai SPL_TOKEN");
  assert.equal(res.assessment.verdict, "ALLOW", "USDC harus berstatus ALLOW");
});

test("real mainnet mint: Fake / Non-existent Mint check", async () => {
  console.log(`\n🔍 Memeriksa Fake Mint: ${FAKE_MINT}`);

  const res = await assessToken2022Risk(FAKE_MINT, "REAL-SIG-FAKE", rpc);

  console.log("   Program Type :", res.programType);
  console.log("   Verdict      :", res.assessment.verdict);
  console.log("   Reasons      :", res.assessment.reasons.join(", "));

  // Mint palsu harus langsung REJECT
  assert.equal(res.assessment.verdict, "REJECT", "Mint palsu harus ditolak (REJECT)");
});