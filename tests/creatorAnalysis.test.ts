import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeCreator } from "../src/risk/creatorAnalysis.js";
import type { SolanaRpcClient, SignatureInfo } from "../src/risk/solanaRpc.js";

function mockCreatorRpc(options: {
  balanceLamports: number;
  signatures: SignatureInfo[];
  shouldThrow?: boolean;
}): SolanaRpcClient {
  return {
    getBalance: async () => {
      if (options.shouldThrow) throw new Error("RPC Network Timeout");
      return options.balanceLamports;
    },
    getSignaturesForAddress: async () => {
      if (options.shouldThrow) throw new Error("RPC Network Timeout");
      return options.signatures;
    },
  } as unknown as SolanaRpcClient;
}

const DUMMY_DEV = "DevWallet1111111111111111111111111111111111";

test("Analisis Dev: Wallet Veteran / Berpengalaman (Established Wallet)", async () => {
  const now = Math.floor(Date.now() / 1000);

  const signatures: SignatureInfo[] = Array.from({ length: 20 }, (_, i) => ({
    signature: `sig_${i}`,
    slot: 1000 + i,
    err: null,
    memo: null,
    blockTime: now - (20 - i) * 3600, // 20 jam lalu
  }));

  const rpc = mockCreatorRpc({
    balanceLamports: 3_500_000_000, // 3.5 SOL
    signatures,
  });

  const res = await analyzeCreator(rpc, DUMMY_DEV);

  console.log("   Dev Balance       :", res.profile.balanceSol, "SOL");
  console.log("   Dev Tx Count      :", res.profile.txCount);
  console.log("   Wallet Age        :", res.profile.walletAgeMinutes, "menit");
  console.log("   Is Burner Wallet? :", res.profile.isBurnerWallet);

  assert.equal(res.profile.isBurnerWallet, false);
  assert.equal(res.profile.balanceSol, 3.5);
  assert.equal(res.profile.txCount, 20);

  for (const c of res.checks) {
    assert.equal(c.passed, true, `Check ${c.name} harus passed`);
  }
});

test("Analisis Dev: Burner / Throwaway Wallet Baru Lahir (High Risk Dev)", async () => {
  const now = Math.floor(Date.now() / 1000);

  const signatures: SignatureInfo[] = [
    {
      signature: "sig_fresh_01",
      slot: 5000,
      err: null,
      memo: null,
      blockTime: now - 300, // 5 menit lalu
    },
  ];

  const rpc = mockCreatorRpc({
    balanceLamports: 10_000_000, // 0.01 SOL (sangat tipis)
    signatures,
  });

  const res = await analyzeCreator(rpc, DUMMY_DEV);

  console.log("   Burner Balance    :", res.profile.balanceSol, "SOL");
  console.log("   Burner Tx Count   :", res.profile.txCount);
  console.log("   Burner Age        :", res.profile.walletAgeMinutes, "menit");
  console.log("   Is Burner Wallet? :", res.profile.isBurnerWallet);

  assert.equal(res.profile.isBurnerWallet, true);
  assert.equal(res.profile.balanceSol, 0.01);
  assert.equal(res.profile.txCount, 1);

  const ageCheck = res.checks.find(c => c.name === "creator_wallet_age");
  assert.equal(ageCheck?.passed, false);
  assert.equal(ageCheck?.severity, "HIGH");

  const txCheck = res.checks.find(c => c.name === "creator_tx_history");
  assert.equal(txCheck?.passed, false);

  const balCheck = res.checks.find(c => c.name === "creator_sol_balance");
  assert.equal(balCheck?.passed, false);
});

test("Analisis Dev: Error RPC (Fail-Closed ke Status Unknown)", async () => {
  const rpc = mockCreatorRpc({
    balanceLamports: 0,
    signatures: [],
    shouldThrow: true,
  });

  const res = await analyzeCreator(rpc, DUMMY_DEV);

  assert.equal(res.checks.length, 1);
  assert.equal(res.checks[0].name, "creator_reputation");
  assert.equal(res.checks[0].passed, null);
  assert.equal(res.checks[0].severity, "HIGH");
});