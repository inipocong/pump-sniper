
import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/db.js";

test("save, read and delete risk assessment", async () => {
  const store = new Store();
  await store.init();

  const signature = "TEST-RISK-DB-001";

  const assessment = {
    signature,
    mint: "TEST-MINT-001",
    verdict: "QUARANTINE" as const,
    score: null,
    checks: [
      {
        name: "holder",
        passed: null,
        severity: "HIGH" as const,
        message: "Holder data unavailable"
      }
    ],
    assessedAt: Date.now(),
    reasons: ["Holder data unavailable"]
  };

  try {
    store.saveRiskAssessment(assessment);

    const saved = store.getRiskAssessment(signature);

    assert.deepEqual(saved, assessment);

    console.log("SAVE AND READ: PASS");
  } finally {
    store.deleteRiskAssessment(signature);
    store.close();
  }
});
