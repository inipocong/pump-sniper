import type {
  RiskAssessment,
  RiskCheck,
  RiskPolicy,
  RiskVerdict
} from "../types.js";

interface RiskEngineInput {
  signature: string;
  mint: string;
  checks: RiskCheck[];
  requiredChecks: string[];
  policy: RiskPolicy;
}

const severityPoints = {
  LOW: 5,
  MEDIUM: 15,
  HIGH: 30,
  CRITICAL: 100
} as const;

export function evaluateRisk(
  input: RiskEngineInput
): RiskAssessment {
  const {
    signature,
    mint,
    checks,
    requiredChecks,
    policy
  } = input;

  const reasons: string[] = [];
  const normalizedChecks = [...checks];

  // Pastikan seluruh pemeriksaan wajib tersedia.
  for (const requiredName of [...new Set(requiredChecks)]) {
    const exists = normalizedChecks.some(
      check => check.name === requiredName
    );

    if (!exists) {
      normalizedChecks.push({
        name: requiredName,
        passed: null,
        severity: "HIGH",
        message: "Required check is missing"
      });
    }
  }

  // Pisahkan pemeriksaan yang belum diketahui dan yang gagal.
  const unknownChecks = normalizedChecks.filter(
    check => check.passed === null
  );

  const failedChecks = normalizedChecks.filter(
    check => check.passed === false
  );

  const criticalFailure = failedChecks.some(
    check => check.severity === "CRITICAL"
  );

  const hasUnknown = unknownChecks.length > 0;

  // Skor tidak dianggap lengkap jika masih ada hasil unknown.
  const score = hasUnknown
    ? null
    : Math.min(
        100,
        failedChecks.reduce(
          (total, check) =>
            total + severityPoints[check.severity],
          0
        )
      );

  let verdict: RiskVerdict;

  // Risiko kritis yang terkonfirmasi.
  if (criticalFailure && policy.rejectOnCritical) {
    verdict = "REJECT";
    reasons.push("Confirmed critical risk detected");
  }

  // Kegagalan yang sudah terkonfirmasi tidak boleh diabaikan.
  else if (failedChecks.length > 0) {
    verdict = "REJECT";
    reasons.push("One or more risk checks failed");
  }

  // Fail-closed: unknown selalu dikarantina.
  else if (hasUnknown) {
    verdict = "QUARANTINE";

    reasons.push(
      policy.quarantineOnUnknown
        ? "One or more checks are unknown"
        : "Unknown checks detected; fail-closed policy overrides configuration"
    );
  }

  // Harus ada pemeriksaan yang bermakna.
  else if (
    normalizedChecks.length === 0 ||
    requiredChecks.length === 0
  ) {
    verdict = "QUARANTINE";
    reasons.push("No meaningful risk checks provided");
  }

  // Skor risiko melebihi batas.
  else if (
    score !== null &&
    score > policy.maxRiskScore
  ) {
    verdict = "REJECT";
    reasons.push("Risk score exceeds configured limit");
  }

  // Hanya lolos jika semua pemeriksaan lengkap dan berhasil.
  else {
    verdict = "ALLOW";
    reasons.push("All supplied checks passed");
  }

  return {
    signature,
    mint,
    verdict,
    score,
    checks: normalizedChecks,
    assessedAt: Date.now(),
    reasons
  };
}