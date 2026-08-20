import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  FunctionDeclaration,
  Node,
  ObjectLiteralElementLike,
} from "typescript/unstable/ast";
import {
  isFunctionDeclaration,
  isIdentifier,
  isObjectLiteralExpression,
  isPropertyAssignment,
  isShorthandPropertyAssignment,
  isStringLiteral,
} from "typescript/unstable/ast";
import { describe, expect, it } from "vitest";
import { parseSourceText } from "~/test-utils/tsAst";

/**
 * Guard: every MergeTree-family engine declared by a ClickHouse migration must
 * use the deployment-substitutable engine pattern.
 *
 * The production database engine is `Replicated` (00001, CLICKHOUSE_CLUSTER
 * set). That engine replicates DDL to every node but NOT data: table data only
 * replicates through Replicated*MergeTree table engines. A migration that
 * hardcodes a plain engine (`AggregatingMergeTree()`, `MergeTree()`, ...)
 * therefore creates a table whose DDL exists on every replica while every
 * insert stays on the one replica that received it: each node accumulates a
 * private, divergent copy and reads through the load balancer return whichever
 * fraction they happen to hit. Nothing at runtime detects this; this test is
 * the only thing that does.
 *
 * The inverse hardcoding is just as wrong: a literal `Replicated...MergeTree`
 * breaks single-node deployments that run without Keeper. The substitutable
 * pattern serves both worlds, resolved by buildMigrationEnvVars (goose.ts)
 * from CLICKHOUSE_CLUSTER:
 *
 *   ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}Ver)
 *   ENGINE = ${CLICKHOUSE_ENGINE_AGGREGATING:-AggregatingMergeTree()}
 *   ENGINE = ${CLICKHOUSE_ENGINE_MERGETREE:-MergeTree()}
 */

const MIGRATIONS_DIR = resolve(
  process.cwd(),
  "src/server/clickhouse/migrations",
);
const GOOSE_SOURCE = readFileSync(
  resolve(process.cwd(), "src/server/clickhouse/goose.ts"),
  "utf8",
);

function propertyName(property: ObjectLiteralElementLike): string | undefined {
  if (
    !isPropertyAssignment(property) &&
    !isShorthandPropertyAssignment(property)
  ) {
    return undefined;
  }
  const name = property.name;
  return isIdentifier(name) || isStringLiteral(name) ? name.text : undefined;
}

function collectObjectLiteralKeys(node: Node, keys: Set<string>): void {
  if (isObjectLiteralExpression(node)) {
    for (const property of node.properties) {
      const name = propertyName(property);
      if (name !== undefined) keys.add(name);
    }
  }
  node.forEachChild((child) => collectObjectLiteralKeys(child, keys));
}

/**
 * The property names of the object literals buildMigrationEnvVars declares,
 * read from the TypeScript AST so only real object keys count: comments,
 * string contents, and code elsewhere in goose.ts cannot satisfy the
 * provisioning assertion below.
 */
const ENV_VAR_KEYS = (() => {
  const sourceFile = parseSourceText({
    fileName: "goose.ts",
    sourceText: GOOSE_SOURCE,
  });
  const fn = sourceFile.statements.find(
    (statement): statement is FunctionDeclaration =>
      isFunctionDeclaration(statement) &&
      statement.name?.text === "buildMigrationEnvVars",
  );
  if (!fn) {
    throw new Error("buildMigrationEnvVars not found in goose.ts");
  }
  const keys = new Set<string>();
  collectObjectLiteralKeys(fn, keys);
  if (keys.size === 0) {
    throw new Error("buildMigrationEnvVars declares no object literal keys");
  }
  return keys;
})();

const APPROVED_ENGINE_PATTERNS: { name: string; pattern: RegExp }[] = [
  {
    name: "${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}<VersionColumn>)",
    pattern:
      /^\$\{CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree\(\}[A-Za-z_][A-Za-z0-9_]*\)$/,
  },
  {
    name: "${CLICKHOUSE_ENGINE_AGGREGATING:-AggregatingMergeTree()}",
    pattern: /^\$\{CLICKHOUSE_ENGINE_AGGREGATING:-AggregatingMergeTree\(\)\}$/,
  },
  {
    name: "${CLICKHOUSE_ENGINE_MERGETREE:-MergeTree()}",
    pattern: /^\$\{CLICKHOUSE_ENGINE_MERGETREE:-MergeTree\(\)\}$/,
  },
];

/**
 * Migrations that are already applied in production and declared plain
 * engines before this guard existed. They are frozen history: goose never
 * re-runs an applied file, so editing them would change nothing deployed.
 * Each entry is remediated by a later migration that swaps the table to the
 * substitutable engine (00064 / 00065 / 00066); 00058's entries are scratch
 * tables that were created and dropped within that same migration.
 *
 * DO NOT add new entries. A scratch table in a NEW migration qualifies for a
 * plain engine only if it is created and dropped within that one migration
 * AND its data flows into a Replicated table before the migration ends,
 * through the single connection goose runs on; anything else maroons data on
 * one replica. Even then, prefer the substitutable pattern (00064 does this
 * for its scratch tables): it costs nothing and needs no exemption here.
 */
const HISTORICAL_PLAIN_ENGINES: { file: string; table: string }[] = [
  {
    file: "00017_create_gateway_budget_ledger.sql",
    table: "gateway_budget_scope_totals",
  },
  {
    file: "00038_create_trace_analytics_rollup.sql",
    table: "trace_analytics_rollup",
  },
  {
    file: "00040_create_evaluation_analytics_rollup.sql",
    table: "evaluation_analytics_rollup",
  },
  {
    file: "00058_gateway_budget_scope_totals_utc.sql",
    table: "gateway_budget_scope_totals_rebuild",
  },
  {
    file: "00058_gateway_budget_scope_totals_utc.sql",
    table: "gateway_budget_scope_totals_recon",
  },
];

interface EngineDeclaration {
  file: string;
  objectType: string;
  objectName: string;
  engine: string;
}

/** Strip `-- ...` line comments so commented-out DDL is never scanned. */
function stripLineComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("--");
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join("\n");
}

function collectEngineDeclarations(): EngineDeclaration[] {
  const declarations: EngineDeclaration[] = [];
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  if (files.length === 0) {
    throw new Error(`no migration files found in ${MIGRATIONS_DIR}`);
  }

  for (const file of files) {
    const sql = stripLineComments(
      readFileSync(resolve(MIGRATIONS_DIR, file), "utf8"),
    );
    for (const statement of sql.split(";")) {
      const create = statement.match(
        /CREATE\s+(TABLE|MATERIALIZED\s+VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)/i,
      );
      if (!create) continue;
      // Case-insensitive so a lowercase `engine =` cannot slip a declaration
      // past the guard entirely. Lowercase spellings of the APPROVED patterns
      // then fail the (case-sensitive) approval below, which is the correct
      // failure direction: flagged, not skipped.
      const engine = statement.match(/ENGINE\s*=\s*([^\n]+)/i);
      // A materialized view with a TO target has no engine of its own; the
      // engine that matters is the target table's.
      if (!engine) continue;
      // The engine expression ends where the next table clause begins, so a
      // single-line `ENGINE = X() ORDER BY ...` is judged on X() alone.
      const engineText = engine[1]!
        .split(
          /\s+(?:ORDER\s+BY|PARTITION\s+BY|PRIMARY\s+KEY|SETTINGS|TTL|AS)\s/i,
        )[0]!
        .trim();
      declarations.push({
        file,
        objectType: create[1]!.replace(/\s+/g, " ").toUpperCase(),
        objectName: create[2]!.replace("${CLICKHOUSE_DATABASE}.", ""),
        engine: engineText,
      });
    }
  }
  return declarations;
}

function isMergeTreeFamily(engine: string): boolean {
  return /MergeTree/i.test(engine);
}

function isApproved(engine: string): boolean {
  return APPROVED_ENGINE_PATTERNS.some(({ pattern }) => pattern.test(engine));
}

function isHistoricalException(declaration: EngineDeclaration): boolean {
  return HISTORICAL_PLAIN_ENGINES.some(
    (entry) =>
      entry.file === declaration.file && entry.table === declaration.objectName,
  );
}

describe("ClickHouse migration engine guard", () => {
  const declarations = collectEngineDeclarations();

  it("every MergeTree-family engine uses the deployment-substitutable pattern", () => {
    const violations = declarations.filter(
      (d) =>
        isMergeTreeFamily(d.engine) &&
        !isApproved(d.engine) &&
        !isHistoricalException(d),
    );

    const report = violations
      .map(
        (d) =>
          `${d.file}: ${d.objectType} ${d.objectName} declares\n` +
          `    ENGINE = ${d.engine}\n` +
          `  which will not replicate its data on clustered deployments.\n` +
          `  The production database engine is Replicated: DDL replicates to every\n` +
          `  node, data does NOT. With this engine every replica keeps a private,\n` +
          `  divergent copy of the table (each insert stays on the node that\n` +
          `  received it), and a hardcoded Replicated* engine would instead break\n` +
          `  single-node deployments. Declare the engine through the substitution\n` +
          `  goose.ts resolves per deployment:\n` +
          APPROVED_ENGINE_PATTERNS.map((p) => `    ENGINE = ${p.name}`).join(
            "\n",
          ),
      )
      .join("\n\n");

    expect(violations, `\n${report}\n`).toEqual([]);
  });

  it("the historical plain-engine list stays exact", () => {
    // Every exemption must still point at a real plain-engine declaration.
    // If one of these files is ever rewritten to conform (or removed), the
    // stale entry must go too, so the list never quietly widens.
    for (const entry of HISTORICAL_PLAIN_ENGINES) {
      const match = declarations.find(
        (d) =>
          d.file === entry.file &&
          d.objectName === entry.table &&
          isMergeTreeFamily(d.engine) &&
          !isApproved(d.engine),
      );
      expect(
        match,
        `${entry.file} no longer declares a plain engine for ${entry.table}; remove the stale exemption`,
      ).toBeDefined();
    }
  });

  it("every substitution variable used by migrations is provided by buildMigrationEnvVars", () => {
    // ENVSUB defaults make a missing variable INVISIBLE: ${X:-PlainEngine()}
    // silently expands to the plain engine on every deployment when goose.ts
    // does not provide X, which is exactly the unreplicated-table defect the
    // engine guard above exists to prevent.
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const referenced = new Set<string>();
    for (const file of files) {
      const sql = readFileSync(resolve(MIGRATIONS_DIR, file), "utf8");
      for (const match of sql.matchAll(/\$\{(CLICKHOUSE_[A-Z0-9_]+)/g)) {
        referenced.add(match[1]!);
      }
    }
    expect(referenced.size).toBeGreaterThan(0);
    expect(referenced).toContain("CLICKHOUSE_ENGINE_AGGREGATING");

    for (const name of [...referenced].sort()) {
      expect(
        ENV_VAR_KEYS.has(name),
        `migrations reference \${${name}} but buildMigrationEnvVars in goose.ts does not provide it; ` +
          `the ENVSUB default would silently apply on every deployment, including production`,
      ).toBe(true);
    }
  });
});
