import { SolanaRpcClient, SolanaAccountInfo } from "./solanaRpc.js";
import { parseToken2022MintExtensions, TokenExtension } from "./token2022.js";
import { evaluateRisk } from "./engine.js";
import type { RiskAssessment, RiskCheck, RiskPolicy } from "../types.js";

// Program ID resmi Solana
const SPL_TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

/**
 * Extensions yang dianggap CRITICAL — langsung REJECT.
 * Merupakan indikasi kuat rug pull / honeypot.
 */
// src/risk/token2022Adapter.ts
const CRITICAL_EXTENSIONS = new Set([
  "PermanentDelegate",            // bisa transfer token siapapun tanpa izin
  "TransferHook",                 // inject logika saat transfer → bisa block sell
  "NonTransferable",              // token tidak bisa dipindah → tidak bisa dijual
  "TransferFeeConfig",            // High Fee / Tax scam: memotong fee saat transfer/jual
  "ConfidentialTransferFeeConfig",// High Fee scam rahasia
]);

const HIGH_RISK_EXTENSIONS = new Set([
  "ConfidentialTransferMint",   // transaksi tersembunyi, tidak transparan
  "MintCloseAuthority",         // authority bisa tutup mint dan bakar token
  "Pausable",                   // program bisa pause semua transfer
]);

/**
 * Extensions yang umum dan aman / standar metadata.
 */
const SAFE_EXTENSIONS = new Set([
  "ImmutableOwner",
  "MemoTransfer",
  "InterestBearingConfig",
  "MetadataPointer",
  "TokenMetadata",
  "GroupPointer",
  "TokenGroup",
  "GroupMemberPointer",
  "TokenGroupMember",
  "TransferFeeAmount",
  "ConfidentialTransferAccount",
  "NonTransferableAccount",
  "TransferHookAccount",
  "ConfidentialTransferFeeAmount",
  "ConfidentialMintBurn",
  "ScaledUiAmount",
  "PausableAccount",
  "CpiGuard",
  "DefaultAccountState",
]);

/**
 * Pemeriksaan wajib yang harus selalu dievaluasi.
 * Fail-closed: jika salah satu hilang, engine otomatis QUARANTINE.
 */
const REQUIRED_CHECKS = [
  "token_program_detection",
  "token2022_extension_scan",
];

export const DEFAULT_POLICY: RiskPolicy = {
  rejectOnCritical: true,
  quarantineOnUnknown: true,
  maxRiskScore: 30, // 1 high extension bernilai 30 poin, jika lebih dari itu langsung REJECT
};

export interface Token2022AdapterResult {
  assessment: RiskAssessment;
  programType: "SPL_TOKEN" | "TOKEN_2022" | "UNKNOWN";
  extensions: TokenExtension[];
}

/**
 * Adapter Token-2022: Menghubungkan RPC, Parser Extension, dan Risk Engine.
 */
export async function assessToken2022Risk(
  mint: string,
  signature: string,
  rpc?: SolanaRpcClient,
  policy: RiskPolicy = DEFAULT_POLICY,
  prefetchedAccountInfo?: SolanaAccountInfo | null
): Promise<Token2022AdapterResult> {
  const client = rpc ?? new SolanaRpcClient();
  const checks: RiskCheck[] = [];
  let programType: Token2022AdapterResult["programType"] = "UNKNOWN";
  let extensions: TokenExtension[] = [];

  // 1. Ambil data akun mint dari RPC (gunakan prefetched jika tersedia)
  let accountInfo: SolanaAccountInfo | null = null;
  if (prefetchedAccountInfo !== undefined) {
    accountInfo = prefetchedAccountInfo;
  } else {
    try {
      accountInfo = await client.getAccountInfo(mint);
    } catch (err) {
    checks.push({
      name: "token_program_detection",
      passed: null,
      severity: "HIGH",
      message: "RPC request getAccountInfo gagal",
      evidence: String(err),
    });
    checks.push({
      name: "token2022_extension_scan",
      passed: null,
      severity: "HIGH",
      message: "Scan extension dilewati karena error koneksi RPC",
    });

    return {
      assessment: evaluateRisk({ signature, mint, checks, requiredChecks: REQUIRED_CHECKS, policy }),
      programType: "UNKNOWN",
      extensions: [],
    };
    }
  }

  // 2. Validasi keberadaan akun mint
  if (!accountInfo) {
    checks.push({
      name: "token_program_detection",
      passed: false,
      severity: "CRITICAL",
      message: "Akun mint tidak ditemukan di blockchain",
      evidence: mint,
    });
    checks.push({
      name: "token2022_extension_scan",
      passed: null,
      severity: "HIGH",
      message: "Tidak dapat scan extension karena mint tidak ada",
    });

    return {
      assessment: evaluateRisk({ signature, mint, checks, requiredChecks: REQUIRED_CHECKS, policy }),
      programType: "UNKNOWN",
      extensions: [],
    };
  }

  const owner = accountInfo.owner;

  // 3. Deteksi Program Token
  if (owner === SPL_TOKEN_PROGRAM_ID) {
    programType = "SPL_TOKEN";
    checks.push({
      name: "token_program_detection",
      passed: true,
      severity: "LOW",
      message: "Token SPL standar (bukan Token-2022)",
      evidence: owner,
    });
    checks.push({
      name: "token2022_extension_scan",
      passed: true,
      severity: "LOW",
      message: "Bukan Token-2022, tidak memerlukan scan extension",
    });

  } else if (owner === TOKEN_2022_PROGRAM_ID) {
    programType = "TOKEN_2022";
    checks.push({
      name: "token_program_detection",
      passed: true,
      severity: "LOW",
      message: "Program Token-2022 terdeteksi",
      evidence: owner,
    });

    // 4. Parse Extension Token-2022
    const base64Data = accountInfo.data[0];
    try {
      extensions = parseToken2022MintExtensions(base64Data);
    } catch (err) {
      checks.push({
        name: "token2022_extension_scan",
        passed: null,
        severity: "HIGH",
        message: "Gagal membaca struktur TLV extension (data corrupt/malformed)",
        evidence: String(err),
      });

      return {
        assessment: evaluateRisk({ signature, mint, checks, requiredChecks: REQUIRED_CHECKS, policy }),
        programType,
        extensions: [],
      };
    }

    if (extensions.length === 0) {
      checks.push({
        name: "token2022_extension_scan",
        passed: true,
        severity: "LOW",
        message: "Token-2022 bersih tanpa extension tambahan",
      });
    } else {
      let hasUnknown = false;

      for (const ext of extensions) {
        if (CRITICAL_EXTENSIONS.has(ext.name)) {
          checks.push({
            name: "token2022_extension_scan",
            passed: false,
            severity: "CRITICAL",
            message: `Extension berbahaya terdeteksi: ${ext.name}`,
            evidence: `id=${ext.id}, length=${ext.length}`,
          });
        } else if (HIGH_RISK_EXTENSIONS.has(ext.name)) {
          checks.push({
            name: "token2022_extension_scan",
            passed: false,
            severity: "HIGH",
            message: `Extension berisiko tinggi: ${ext.name}`,
            evidence: `id=${ext.id}, length=${ext.length}`,
          });
        } else if (SAFE_EXTENSIONS.has(ext.name)) {
          checks.push({
            name: "token2022_extension_scan",
            passed: true,
            severity: "LOW",
            message: `Extension aman: ${ext.name}`,
            evidence: `id=${ext.id}, length=${ext.length}`,
          });
        } else {
          // Extension tidak dikenal → wajib QUARANTINE (fail-closed)
          hasUnknown = true;
          checks.push({
            name: "token2022_extension_scan",
            passed: null,
            severity: "HIGH",
            message: `Extension asing terdeteksi: ${ext.name} (belum divalidasi)`,
            evidence: `id=${ext.id}, length=${ext.length}`,
          });
        }
      }

      if (!hasUnknown && !checks.some(c => c.name === "token2022_extension_scan" && c.passed === false)) {
        checks.push({
          name: "token2022_extension_scan",
          passed: true,
          severity: "LOW",
          message: "Seluruh extension Token-2022 lolos verifikasi keamanan",
        });
      }
    }

  } else {
    // Owner program tidak sah
    programType = "UNKNOWN";
    checks.push({
      name: "token_program_detection",
      passed: false,
      severity: "CRITICAL",
      message: `Owner akun bukan token program resmi Solana: ${owner}`,
      evidence: owner,
    });
    checks.push({
      name: "token2022_extension_scan",
      passed: null,
      severity: "HIGH",
      message: "Scan dibatalkan karena program owner tidak valid",
    });
  }

  return {
    assessment: evaluateRisk({ signature, mint, checks, requiredChecks: REQUIRED_CHECKS, policy }),
    programType,
    extensions,
  };
}