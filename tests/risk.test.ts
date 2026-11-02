
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateRisk } from "../src/risk/engine.js";

const policy = {
  rejectOnCritical: true,
  quarantineOnUnknown: true,
  maxRiskScore: 30
};

test("all checks pass => ALLOW", () => {
  const result = evaluateRisk({
    signature: "test-1",
    mint: "mint-1",
    checks: [
      {
        name: "mint",
        passed: true,
        severity: "LOW",
        message: "Mint validated"
      }
    ],
    requiredChecks: ["mint"],
    policy
  });

  assert.equal(result.verdict, "ALLOW");
});

test("unknown check => QUARANTINE", () => {
  const result = evaluateRisk({
    signature: "test-2",
    mint: "mint-2",
    checks: [],
    requiredChecks: ["holder"],
    policy
  });

  assert.equal(result.verdict, "QUARANTINE");
  assert.equal(result.score, null);
});

test("critical failure => REJECT", () => {
  const result = evaluateRisk({
    signature: "test-3",
    mint: "mint-3",
    checks: [
      {
        name: "token-extension",
        passed: false,
        severity: "CRITICAL",
        message: "Dangerous extension detected"
      }
    ],
    requiredChecks: ["token-extension"],
    policy
  });

  assert.equal(result.verdict, "REJECT");
});

test("failed high-risk check => REJECT", () => {
  const result = evaluateRisk({
    signature: "test-4",
    mint: "mint-4",
    checks: [
      {
        name: "holder",
        passed: false,
        severity: "HIGH",
        message: "Concentration too high"
      }
    ],
    requiredChecks: ["holder"],
    policy
  });

  assert.equal(result.verdict, "REJECT");
});


test("empty checks => QUARANTINE", () => {
  const result = evaluateRisk({
    signature: "edge-1",
    mint: "mint-edge-1",
    checks: [],
    requiredChecks: [],
    policy
  });

  assert.equal(result.verdict, "QUARANTINE");
});

test("missing required check => QUARANTINE", () => {
  const result = evaluateRisk({
    signature: "edge-2",
    mint: "mint-edge-2",
    checks: [
      {
        name: "mint",
        passed: true,
        severity: "LOW",
        message: "Mint validated"
      }
    ],
    requiredChecks: ["mint", "holder", "sell-simulation"],
    policy
  });

  assert.equal(result.verdict, "QUARANTINE");
});

test("critical failure takes priority over unknown data", () => {
  const result = evaluateRisk({
    signature: "edge-3",
    mint: "mint-edge-3",
    checks: [
      {
        name: "token-extension",
        passed: false,
        severity: "CRITICAL",
        message: "Critical risk detected"
      }
    ],
    requiredChecks: ["token-extension", "sell-simulation"],
    policy
  });

  assert.equal(result.verdict, "REJECT");
});
