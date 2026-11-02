import { assessToken2022Risk } from "../src/risk/token2022Adapter.js";
import type { SolanaRpcClient, SolanaAccountInfo } from "../src/risk/solanaRpc.js";

/**
 * Mock RPC Client (Murni simulasi offline di memori, tidak nembak internet sama sekali)
 */
function mockRpc(accountInfo: SolanaAccountInfo | null | "error"): SolanaRpcClient {
  return {
    getAccountInfo: async (_address: string) => {
      if (accountInfo === "error") throw new Error("RPC timeout");
      return accountInfo;
    },
  } as unknown as SolanaRpcClient;
}

const DUMMY_SIGNATURE = "5xTest1234567890Signature";
const DUMMY_MINT = "MintPubkey1234567890";

const SPL_OWNER = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const T22_OWNER = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

// Helper untuk menyusun byte data Token-2022 buatan
function buildToken2022Data(extensions: Array<{ id: number; data: Buffer }>): string {
  const baseMint = Buffer.alloc(82, 0);
  const padding = Buffer.alloc(83, 0);
  const accountType = Buffer.from([1]); // 1 = extended mint

  const extBuffers: Buffer[] = [];
  for (const ext of extensions) {
    const header = Buffer.alloc(4);
    header.writeUInt16LE(ext.id, 0);
    header.writeUInt16LE(ext.data.length, 2);
    extBuffers.push(header, ext.data);
  }

  const full = Buffer.concat([baseMint, padding, accountType, ...extBuffers]);
  return full.toString("base64");
}

function makeAccountInfo(owner: string, base64Data: string): SolanaAccountInfo {
  return {
    owner,
    executable: false,
    lamports: 1_000_000,
    data: [base64Data, "base64"],
    rentEpoch: 0,
  };
}

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ FAIL: ${name}`);
    console.log(`         ${String(err)}`);
    failed++;
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function runTests() {
  console.log("\n🧪 Menjalankan 11 Skenario Uji Token-2022 Risk Adapter...\n");

  // 1. SPL Token standar
  await test("SPL Token standar tanpa extension → ALLOW", async () => {
    const base64 = Buffer.alloc(82, 0).toString("base64");
    const rpc = mockRpc(makeAccountInfo(SPL_OWNER, base64));
    const result = await assessToken2022Risk(DUMMY_MINT, DUMMY_SIGNATURE, rpc);
    assert(result.programType === "SPL_TOKEN", "programType harus SPL_TOKEN");
    assert(result.assessment.verdict === "ALLOW", `verdict harus ALLOW, dapat: ${result.assessment.verdict}`);
    assert(result.extensions.length === 0, "extensions harus kosong");
  });

  // 2. Token-2022 tanpa extension
  await test("Token-2022 tanpa extension → ALLOW", async () => {
    const base64 = Buffer.alloc(82, 0).toString("base64");
    const rpc = mockRpc(makeAccountInfo(T22_OWNER, base64));
    const result = await assessToken2022Risk(DUMMY_MINT, DUMMY_SIGNATURE, rpc);
    assert(result.programType === "TOKEN_2022", "programType harus TOKEN_2022");
    assert(result.assessment.verdict === "ALLOW", `verdict harus ALLOW, dapat: ${result.assessment.verdict}`);
  });

  // 3. PermanentDelegate (CRITICAL honeypot)
  await test("Token-2022 dengan PermanentDelegate (CRITICAL) → REJECT", async () => {
    const base64 = buildToken2022Data([{ id: 12, data: Buffer.alloc(32, 0) }]);
    const rpc = mockRpc(makeAccountInfo(T22_OWNER, base64));
    const result = await assessToken2022Risk(DUMMY_MINT, DUMMY_SIGNATURE, rpc);
    assert(result.assessment.verdict === "REJECT", `verdict harus REJECT, dapat: ${result.assessment.verdict}`);
    assert(result.extensions.some(e => e.name === "PermanentDelegate"), "harus detect PermanentDelegate");
  });

  // 4. TransferHook (CRITICAL trap)
  await test("Token-2022 dengan TransferHook (CRITICAL) → REJECT", async () => {
    const base64 = buildToken2022Data([{ id: 14, data: Buffer.alloc(4, 0) }]);
    const rpc = mockRpc(makeAccountInfo(T22_OWNER, base64));
    const result = await assessToken2022Risk(DUMMY_MINT, DUMMY_SIGNATURE, rpc);
    assert(result.assessment.verdict === "REJECT", `verdict harus REJECT, dapat: ${result.assessment.verdict}`);
  });

  // 5. NonTransferable (CRITICAL tidak bisa dijual)
  await test("Token-2022 dengan NonTransferable (CRITICAL) → REJECT", async () => {
    const base64 = buildToken2022Data([{ id: 9, data: Buffer.alloc(0) }]);
    const rpc = mockRpc(makeAccountInfo(T22_OWNER, base64));
    const result = await assessToken2022Risk(DUMMY_MINT, DUMMY_SIGNATURE, rpc);
    assert(result.assessment.verdict === "REJECT", `verdict harus REJECT, dapat: ${result.assessment.verdict}`);
  });

  // 6. TransferFeeConfig (HIGH risk tax)
  await test("Token-2022 dengan TransferFeeConfig (HIGH) → REJECT", async () => {
    const base64 = buildToken2022Data([{ id: 1, data: Buffer.alloc(8, 0) }]);
    const rpc = mockRpc(makeAccountInfo(T22_OWNER, base64));
    const result = await assessToken2022Risk(DUMMY_MINT, DUMMY_SIGNATURE, rpc);
    assert(result.assessment.verdict === "REJECT", `verdict harus REJECT, dapat: ${result.assessment.verdict}`);
  });

  // 7. Extension asing/belum divalidasi
  await test("Token-2022 dengan extension tidak dikenal (id=99) → QUARANTINE", async () => {
    const base64 = buildToken2022Data([{ id: 99, data: Buffer.alloc(4, 0) }]);
    const rpc = mockRpc(makeAccountInfo(T22_OWNER, base64));
    const result = await assessToken2022Risk(DUMMY_MINT, DUMMY_SIGNATURE, rpc);
    assert(result.assessment.verdict === "QUARANTINE", `verdict harus QUARANTINE, dapat: ${result.assessment.verdict}`);
  });

  // 8. Akun mint tidak ditemukan
  await test("Mint account tidak ditemukan di RPC → REJECT", async () => {
    const rpc = mockRpc(null);
    const result = await assessToken2022Risk(DUMMY_MINT, DUMMY_SIGNATURE, rpc);
    assert(result.assessment.verdict === "REJECT", `verdict harus REJECT, dapat: ${result.assessment.verdict}`);
    assert(result.programType === "UNKNOWN", "programType harus UNKNOWN");
  });

  // 9. Gangguan RPC
  await test("RPC error → QUARANTINE (fail-closed)", async () => {
    const rpc = mockRpc("error");
    const result = await assessToken2022Risk(DUMMY_MINT, DUMMY_SIGNATURE, rpc);
    assert(result.assessment.verdict === "QUARANTINE", `verdict harus QUARANTINE, dapat: ${result.assessment.verdict}`);
  });

  // 10. Owner program palsu / tidak dikenal
  await test("Owner program tidak dikenal → REJECT", async () => {
    const base64 = Buffer.alloc(82, 0).toString("base64");
    const rpc = mockRpc(makeAccountInfo("FakeProgram111111111111111111111111111111111", base64));
    const result = await assessToken2022Risk(DUMMY_MINT, DUMMY_SIGNATURE, rpc);
    assert(result.assessment.verdict === "REJECT", `verdict harus REJECT, dapat: ${result.assessment.verdict}`);
    assert(result.programType === "UNKNOWN", "programType harus UNKNOWN");
  });

  // 11. MetadataPointer (Extension aman/standar)
  await test("Token-2022 dengan MetadataPointer (SAFE) saja → ALLOW", async () => {
    const base64 = buildToken2022Data([{ id: 18, data: Buffer.alloc(8, 0) }]);
    const rpc = mockRpc(makeAccountInfo(T22_OWNER, base64));
    const result = await assessToken2022Risk(DUMMY_MINT, DUMMY_SIGNATURE, rpc);
    assert(result.assessment.verdict === "ALLOW", `verdict harus ALLOW, dapat: ${result.assessment.verdict}`);
  });

  console.log(`\n📊 Ringkasan: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});