export interface TokenCandidate {
  
  signature: string;
  slot?: number;
  detectedAt: number;
  programId: string;
  mint?: string;
  bondingCurve?: string;
  creator?: string;
  name?: string;
  symbol?: string;
  metadataUri?: string;
  instruction: "create_v2" | "tokenMint" | "migrate" | "initialize" | "initialize_lb_pair" | "cto_rebound";
  source: "solana_logs" | "solana_logs_pump" | "solana_logs_moonshot" | "solana_logs_graduation" | "solana_logs_raydium" | "solana_logs_meteora" | "solana_logs_cto" | "demo";
  status: "DECODED";
}

export type RiskVerdict =
  | "ALLOW"
  | "REJECT"
  | "QUARANTINE";

export type RiskSeverity =
  | "LOW"
  | "MEDIUM"
  | "HIGH"
  | "CRITICAL";

export interface RiskCheck {
  name: string;
  passed: boolean | null;
  severity: RiskSeverity;
  message: string;
  evidence?: string;
}

export interface RiskAssessment {
  signature: string;
  mint: string;
  verdict: RiskVerdict;
  score: number | null;
  checks: RiskCheck[];
  assessedAt: number;
  reasons: string[];
}

export interface RiskPolicy {
  rejectOnCritical: boolean;
  quarantineOnUnknown: boolean;
  maxRiskScore: number;
}

