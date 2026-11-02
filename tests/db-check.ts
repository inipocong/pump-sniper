
import fs from "node:fs";
import initSqlJs from "sql.js";

async function main() {
  const SQL = await initSqlJs();
  const db = new SQL.Database(
    fs.readFileSync("./data/sniper.sqlite")
  );

  console.log("INTEGRITY:", db.exec("PRAGMA integrity_check"));

  const result = db.exec(`
    SELECT signature, slot, mint, name, symbol, instruction, source
    FROM candidates
    ORDER BY detected_at DESC
    LIMIT 10
  `);

  if (!result.length) {
    console.log("Belum ada candidate tersimpan.");
  } else {
    console.log("COLUMNS:", result[0].columns);
    console.table(
      result[0].values.map(row =>
        Object.fromEntries(
          result[0].columns.map((col, i) => [col, row[i]])
        )
      )
    );
  }

  console.log(
  "INTEGRITY RESULT:",
  JSON.stringify(db.exec("PRAGMA integrity_check"))
);

console.log(
  "TOTAL CANDIDATES:",
  JSON.stringify(
    db.exec("SELECT COUNT(*) AS total FROM candidates")
  )
);

console.log(
  "LATEST SOURCES:",
  JSON.stringify(
    db.exec(`
      SELECT name, symbol, instruction, source
      FROM candidates
      ORDER BY detected_at DESC
      LIMIT 5
    `)
  )
);

  db.close();
}

main().catch(console.error);
