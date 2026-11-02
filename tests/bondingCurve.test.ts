import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseBondingCurveData,
  calculateBondingCurveMetrics,
} from "../src/risk/bondingCurve.js";

const DISC = Buffer.from([0x17, 0xb7, 0xf8, 0x37, 0x60, 0xd8, 0xac, 0x60]);

function buildMockBondingCurveBuffer(data: {
  vToken: bigint;
  vSol: bigint;
  rToken: bigint;
  rSol: bigint;
  supply: bigint;
  complete: boolean;
}): string {
  const buf = Buffer.alloc(49);
  DISC.copy(buf, 0);
  buf.writeBigUInt64LE(data.vToken, 8);
  buf.writeBigUInt64LE(data.vSol, 16);
  buf.writeBigUInt64LE(data.rToken, 24);
  buf.writeBigUInt64LE(data.rSol, 32);
  buf.writeBigUInt64LE(data.supply, 40);
  buf.writeUInt8(data.complete ? 1 : 0, 48);
  return buf.toString("base64");
}

test("Bonding Curve: Koin Baru Lahir (Initial State 0% Progress)", () => {
  const base64 = buildMockBondingCurveBuffer({
    vToken: 1_073_000_000_000_000n,
    vSol: 30_000_000_000n,
    rToken: 793_100_000_000_000n,
    rSol: 0n,
    supply: 1_000_000_000_000_000n,
    complete: false,
  });

  const state = parseBondingCurveData(base64);
  assert.equal(state.complete, false);
  assert.equal(state.realSolReserves, 0n);

  const metrics = calculateBondingCurveMetrics(state);
  console.log("   Initial Price SOL :", metrics.priceInSol.toExponential(4));
  console.log("   Initial MarketCap :", metrics.marketCapSol, "SOL");
  console.log("   Progress Kurva    :", metrics.progressPercent, "%");

  assert.equal(metrics.progressPercent, 0);
  assert.equal(metrics.isComplete, false);
  assert.equal(metrics.realSolCollected, 0);
  assert.ok(metrics.marketCapSol > 27 && metrics.marketCapSol < 29, "Market cap awal ~27.9 SOL");
});

test("Bonding Curve: Sedang Berjalan (Mid-Way ~50% Progress)", () => {
  const base64 = buildMockBondingCurveBuffer({
    vToken: 600_000_000_000_000n,
    vSol: 72_500_000_000n,
    rToken: 320_000_000_000_000n,
    rSol: 42_500_000_000n, // 42.5 SOL
    supply: 1_000_000_000_000_000n,
    complete: false,
  });

  const state = parseBondingCurveData(base64);
  const metrics = calculateBondingCurveMetrics(state);

  console.log("   Mid-way Price SOL :", metrics.priceInSol.toExponential(4));
  console.log("   Mid-way Progress  :", metrics.progressPercent, "%");
  console.log("   SOL Terkumpul     :", metrics.realSolCollected, "SOL");

  assert.equal(metrics.progressPercent, 50);
  assert.equal(metrics.realSolCollected, 42.5);
  assert.equal(metrics.isComplete, false);
});

test("Bonding Curve: Sudah Lulus / Migrasi Raydium (Complete 100%)", () => {
  const base64 = buildMockBondingCurveBuffer({
    vToken: 200_000_000_000_000n,
    vSol: 115_000_000_000n,
    rToken: 0n,
    rSol: 85_000_000_000n,
    supply: 1_000_000_000_000_000n,
    complete: true,
  });

  const state = parseBondingCurveData(base64);
  const metrics = calculateBondingCurveMetrics(state);

  assert.equal(metrics.isComplete, true);
  assert.equal(metrics.progressPercent, 100);
});

test("Bonding Curve: Menolak Discriminator Palsu / Bukan Akun Pump.fun", () => {
  const fakeBuf = Buffer.alloc(49);
  fakeBuf.write("FAKEDISC", 0);
  const base64 = fakeBuf.toString("base64");

  assert.throws(
    () => parseBondingCurveData(base64),
    /Discriminator akun bukan BondingCurve Pump.fun yang valid/
  );
});