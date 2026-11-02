import fs from "node:fs";
import path from "node:path";
import initSqlJs, { Database } from "sql.js";
import { config } from "./config.js";
import { TokenCandidate, RiskAssessment } from "./types.js";

export interface PaperTrade {
  id: string;
  mint: string;
  symbol: string;
  platform?: string;           // Asal platform (PUMP.FUN, MOONSHOT, RAYDIUM, METEORA, dll)
  entryPrice: number;
  tokensBought: number;
  tokensRemaining: number;     // Sisa token yang masih di-hold
  costSol: number;
  tp1Price: number;            // Target TP 1 (+50%)
  tp2Price: number;            // Target TP 2 (+100%)
  tp3Price: number;            // Target TP 3 (+200%)
  slPrice: number;             // SL dinamis (naik ke breakeven saat TP1 hit)
  stage: number;               // 0 = Fresh, 1 = TP1 Hit, 2 = TP2 Hit, 3 = Closed
  realizedPnlSol: number;      // Akumulasi PnL bersih dari penjualan bertahap
  status: "OPEN" | "TP_HIT" | "SL_HIT" | "STAGNANT_EXIT";
  exitPrice: number | null;
  pnlSol: number | null;
  pnlPercent: number | null;
  openedAt: number;
  closedAt: number | null;
}

export class Store {
  private db!: Database;

  constructor(private customDbPath?: string) {}

  async init(): Promise<void> {
    const SQL = await initSqlJs({});
    const dbFile = this.customDbPath ?? config.dbPath;
    if (dbFile !== ":memory:") {
      fs.mkdirSync(path.dirname(dbFile), { recursive: true });
    }
    this.db = dbFile !== ":memory:" && fs.existsSync(dbFile)
      ? new SQL.Database(fs.readFileSync(dbFile))
      : new SQL.Database();

    this.db.run(`CREATE TABLE IF NOT EXISTS candidates (
      signature TEXT PRIMARY KEY, slot INTEGER, detected_at INTEGER NOT NULL,
      program_id TEXT NOT NULL, mint TEXT NOT NULL, bonding_curve TEXT NOT NULL,
      creator TEXT NOT NULL, name TEXT, symbol TEXT, metadata_uri TEXT,
      instruction TEXT NOT NULL, source TEXT NOT NULL
    )`);

    this.db.run(`CREATE TABLE IF NOT EXISTS risk_assessments (
      signature TEXT PRIMARY KEY,
      mint TEXT NOT NULL,
      verdict TEXT NOT NULL,
      score INTEGER,
      checks_json TEXT NOT NULL,
      reasons_json TEXT NOT NULL,
      assessed_at INTEGER NOT NULL
    )`);

    this.db.run(`CREATE TABLE IF NOT EXISTS paper_trades (
      id TEXT PRIMARY KEY,
      mint TEXT NOT NULL,
      symbol TEXT,
      platform TEXT DEFAULT 'PUMP.FUN',
      entry_price REAL NOT NULL,
      tokens_bought REAL NOT NULL,
      tokens_remaining REAL NOT NULL DEFAULT 0,
      cost_sol REAL NOT NULL,
      tp1_price REAL NOT NULL,
      tp2_price REAL NOT NULL DEFAULT 0,
      tp3_price REAL NOT NULL DEFAULT 0,
      sl_price REAL NOT NULL,
      stage INTEGER NOT NULL DEFAULT 0,
      realized_pnl_sol REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      exit_price REAL,
      pnl_sol REAL,
      pnl_percent REAL,
      opened_at INTEGER NOT NULL,
      closed_at INTEGER
    )`);

    // Migrasi kolom jika database lama ada
    try { this.db.run("ALTER TABLE paper_trades ADD COLUMN tokens_remaining REAL NOT NULL DEFAULT 0"); } catch {}
    try { this.db.run("ALTER TABLE paper_trades ADD COLUMN tp2_price REAL NOT NULL DEFAULT 0"); } catch {}
    try { this.db.run("ALTER TABLE paper_trades ADD COLUMN tp3_price REAL NOT NULL DEFAULT 0"); } catch {}
    try { this.db.run("ALTER TABLE paper_trades ADD COLUMN stage INTEGER NOT NULL DEFAULT 0"); } catch {}
    try { this.db.run("ALTER TABLE paper_trades ADD COLUMN realized_pnl_sol REAL NOT NULL DEFAULT 0"); } catch {}
    try { this.db.run("ALTER TABLE paper_trades ADD COLUMN platform TEXT DEFAULT 'PUMP.FUN'"); } catch {}

    this.persist();
  }

  hasCandidate(signature: string): boolean {
    const s = this.db.prepare("SELECT signature FROM candidates WHERE signature=?");
    s.bind([signature]);
    const found = s.step();
    s.free();
    return found;
  }

  addCandidate(c: TokenCandidate): void {
    this.db.run(
      `INSERT OR IGNORE INTO candidates
      (signature,slot,detected_at,program_id,mint,bonding_curve,creator,name,symbol,metadata_uri,instruction,source)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        c.signature,
        c.slot ?? null,
        c.detectedAt,
        c.programId,
        c.mint!,
        c.bondingCurve!,
        c.creator!,
        c.name ?? null,
        c.symbol ?? null,
        c.metadataUri ?? null,
        c.instruction,
        c.source,
      ]
    );
    this.persist();
  }

  saveRiskAssessment(assessment: RiskAssessment): void {
    this.db.run(
      `INSERT OR REPLACE INTO risk_assessments
      (signature, mint, verdict, score, checks_json, reasons_json, assessed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        assessment.signature,
        assessment.mint,
        assessment.verdict,
        assessment.score,
        JSON.stringify(assessment.checks),
        JSON.stringify(assessment.reasons),
        assessment.assessedAt,
      ]
    );
    this.persist();
  }

  getBondingCurveByMint(mint: string): string | null {
    const s = this.db.prepare("SELECT bonding_curve FROM candidates WHERE mint = ? LIMIT 1");
    s.bind([mint]);
    if (s.step()) {
      const row = s.getAsObject();
      s.free();
      return String(row.bonding_curve);
    }
    s.free();
    return null;
  }

  getCandidateByMint(mint: string): TokenCandidate | null {
    const s = this.db.prepare("SELECT * FROM candidates WHERE mint = ? LIMIT 1");
    s.bind([mint]);
    if (s.step()) {
      const row = s.getAsObject();
      s.free();
      return {
        signature: String(row.signature),
        slot: row.slot ? Number(row.slot) : undefined,
        detectedAt: Number(row.detected_at),
        programId: String(row.program_id),
        mint: String(row.mint),
        bondingCurve: String(row.bonding_curve),
        creator: String(row.creator),
        name: row.name ? String(row.name) : undefined,
        symbol: row.symbol ? String(row.symbol) : undefined,
        metadataUri: row.metadata_uri ? String(row.metadata_uri) : undefined,
        instruction: row.instruction as any,
        source: row.source as any,
        status: "DECODED",
      };
    }
    s.free();
    return null;
  }

  savePaperTrade(trade: PaperTrade): void {
    this.db.run(
      `INSERT OR REPLACE INTO paper_trades
      (id, mint, symbol, platform, entry_price, tokens_bought, tokens_remaining, cost_sol, tp1_price, tp2_price, tp3_price, sl_price, stage, realized_pnl_sol, status, exit_price, pnl_sol, pnl_percent, opened_at, closed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        trade.id,
        trade.mint,
        trade.symbol,
        trade.platform ?? "PUMP.FUN",
        trade.entryPrice,
        trade.tokensBought,
        trade.tokensRemaining ?? trade.tokensBought,
        trade.costSol,
        trade.tp1Price,
        trade.tp2Price ?? 0,
        trade.tp3Price ?? 0,
        trade.slPrice,
        trade.stage ?? 0,
        trade.realizedPnlSol ?? 0,
        trade.status,
        trade.exitPrice ?? null,
        trade.pnlSol ?? null,
        trade.pnlPercent ?? null,
        trade.openedAt,
        trade.closedAt ?? null,
      ]
    );
    this.persist();
  }

  getOpenPaperTrades(): PaperTrade[] {
    const stmt = this.db.prepare("SELECT * FROM paper_trades WHERE status = 'OPEN'");
    const trades: PaperTrade[] = [];

    try {
      while (stmt.step()) {
        const row = stmt.getAsObject();
        trades.push({
          id: String(row.id),
          mint: String(row.mint),
          symbol: String(row.symbol),
          platform: row.platform ? String(row.platform) : "PUMP.FUN",
          entryPrice: Number(row.entry_price),
          tokensBought: Number(row.tokens_bought),
          tokensRemaining: row.tokens_remaining !== null && row.tokens_remaining !== undefined ? Number(row.tokens_remaining) : Number(row.tokens_bought),
          costSol: Number(row.cost_sol),
          tp1Price: Number(row.tp1_price),
          tp2Price: row.tp2_price !== null && row.tp2_price !== undefined ? Number(row.tp2_price) : 0,
          tp3Price: row.tp3_price !== null && row.tp3_price !== undefined ? Number(row.tp3_price) : 0,
          slPrice: Number(row.sl_price),
          stage: Number(row.stage ?? 0),
          realizedPnlSol: Number(row.realized_pnl_sol ?? 0),
          status: row.status as PaperTrade["status"],
          exitPrice: row.exit_price !== null ? Number(row.exit_price) : null,
          pnlSol: row.pnl_sol !== null ? Number(row.pnl_sol) : null,
          pnlPercent: row.pnl_percent !== null ? Number(row.pnl_percent) : null,
          openedAt: Number(row.opened_at),
          closedAt: row.closed_at !== null ? Number(row.closed_at) : null,
        });
      }
    } finally {
      stmt.free();
    }

    return trades;
  }

  getPaperTradeStats(): { totalTrades: number; winCount: number; lossCount: number; totalPnlSol: number } {
    const stmt = this.db.prepare("SELECT status, pnl_sol FROM paper_trades WHERE status != 'OPEN'");
    let totalTrades = 0;
    let winCount = 0;
    let lossCount = 0;
    let totalPnlSol = 0;

    try {
      while (stmt.step()) {
        const row = stmt.getAsObject();
        totalTrades++;
        const pnl = Number(row.pnl_sol ?? 0);
        totalPnlSol += pnl;
        if (pnl > 0) winCount++;
        else lossCount++;
      }
    } finally {
      stmt.free();
    }

    return {
      totalTrades,
      winCount,
      lossCount,
      totalPnlSol: Number(totalPnlSol.toFixed(4)),
    };
  }

  close(): void {
    this.persist();
    this.db.close();
  }

  private persist(): void {
    const dbFile = this.customDbPath ?? config.dbPath;
    if (dbFile === ":memory:") return;
    if (this.db) {
      fs.writeFileSync(dbFile, Buffer.from(this.db.export()));
    }
  }
}
