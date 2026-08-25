/**
 * READ-ONLY. Counts what dropping `RoutingPolicy.modelAllowlist` and
 * `RoutingPolicy.strategy` deletes, so the number can be read before the
 * migration that drops them runs, and quoted in the migration comment.
 *
 * This script issues SELECT queries only. It performs no INSERT, UPDATE or
 * DELETE and opens no transaction, so it is safe to point at production.
 * `--emit-sql` prints statements to stdout and runs none of them.
 *
 * Neither column is dormant configuration. Both are inert:
 *
 *   modelAllowlist  never reaches the gateway. The bundle's `models_allowed`
 *                   is materialised from the per-virtual-key config, never
 *                   from the policy, so the list denies nothing today.
 *   strategy        never leaves the database. None of the four documented
 *                   values (priority, cost, latency, round_robin) exists in
 *                   the data plane, so every policy routes by the order of
 *                   `modelProviderIds` whatever the column says.
 *
 * That is what makes the census worth taking: rows carrying a value are rows
 * whose owners believe something is being enforced, and the drop is the
 * moment to find out how many of them there are.
 *
 * The read is a raw SELECT rather than a `routingPolicy.findMany`, because the
 * Prisma model these columns belong to is exactly what the migration removes.
 * A census of what a migration deletes has to outlive the model it counts, and
 * the typed client cannot name a column the schema no longer declares.
 *
 * The counts come from one statement snapshot, so a policy written after the
 * SELECT begins is not in them. They are a shape, not a ledger.
 *
 * Usage:
 *   DATABASE_URL=postgres://... pnpm tsx scripts/report-routing-policy-dead-fields.ts
 *   DATABASE_URL=postgres://... pnpm tsx scripts/report-routing-policy-dead-fields.ts --json
 *   DATABASE_URL=postgres://... pnpm tsx scripts/report-routing-policy-dead-fields.ts --emit-sql
 */
import { Prisma, PrismaClient } from "~/generated/prisma/client";
import { createPrismaPgAdapter } from "~/server/prismaPgAdapter";

const USAGE = [
  "usage: pnpm tsx scripts/report-routing-policy-dead-fields.ts [--json | --emit-sql]",
  "  (no flag)   human-readable census of both dead columns",
  "  --json      the same census, machine-readable",
  "  --emit-sql  print the policyRules patch for each non-empty allowlist, run nothing",
].join("\n");

/** The value `strategy` defaults to, and the only one the product ever meant. */
const DEFAULT_STRATEGY = "priority";

/**
 * One policy, as the raw SELECT hands it back. `modelAllowlist` and
 * `policyRules` are jsonb, which the driver deserialises for us.
 */
type PolicyRow = {
  id: string;
  organizationId: string;
  name: string;
  isDefault: boolean;
  modelAllowlist: Prisma.JsonValue | null;
  strategy: string;
  policyRules: Prisma.JsonValue | null;
};

/** The Postgres SQLSTATE for a column that does not exist. */
const UNDEFINED_COLUMN = "42703";

type Mode = "text" | "json" | "sql";

/** One policy whose `modelAllowlist` holds at least one usable entry. */
type AllowlistPolicy = {
  id: string;
  organizationId: string;
  name: string;
  isDefault: boolean;
  strategy: string;
  entries: string[];
  /** RE2 translations of `entries`, in the same order. */
  patterns: string[];
  /**
   * What `policyRules.models.allow` already enforces, which the emitted patch
   * would replace. Null when the policy enforces no model allowlist.
   */
  existingModelsAllow: string[] | null;
};

type AllowlistCensus = {
  nonEmpty: AllowlistPolicy[];
  /** Rows holding `[]`, which allow everything exactly as a null does. */
  empty: number;
  /** Rows holding SQL NULL. */
  absent: number;
  /** Rows holding JSON that is not an array at all. */
  malformed: number;
  /** Array members that were not strings, summed over every row. */
  skippedEntries: number;
};

type StrategyCensus = {
  nonDefault: number;
  byValue: Array<{ value: string; count: number }>;
};

type Report = {
  total: number;
  allowlist: AllowlistCensus;
  strategy: StrategyCensus;
  /** Rows carrying a non-empty allowlist and a non-default strategy. */
  both: number;
};

/**
 * RE2 metacharacters. `-` is escaped along with them: it carries no meaning
 * outside a character class, but escaping it keeps a pattern reading the same
 * wherever it is later pasted, and model ids are full of hyphens.
 */
const RE2_METACHARACTERS = /[\\.+*?()|[\]{}^$-]/g;

function escapeRe2Literal(literal: string): string {
  return literal.replace(RE2_METACHARACTERS, (character) => `\\${character}`);
}

/**
 * Translate one `modelAllowlist` entry into an anchored RE2 pattern carrying
 * the same meaning as `domain.ModelPatternMatches` in
 * `services/aigateway/domain/bundle.go`, which knows exactly two forms:
 *
 *   exact    the entry equals the model id
 *   prefix   the entry ends in `*`, and the model id starts with the rest
 *
 * Nothing else is a wildcard there, so an interior `*` is a literal asterisk
 * here, and only the final one is dropped. Anchoring is not decoration: the
 * data plane matches policy patterns with `regexp.MatchString`, which is
 * unanchored, so an unanchored translation of `gpt-4o` would also allow
 * `not-gpt-4o-either`.
 */
function toAnchoredPattern(entry: string): string {
  if (entry.endsWith("*")) {
    return `^${escapeRe2Literal(entry.slice(0, -1))}.*$`;
  }
  return `^${escapeRe2Literal(entry)}$`;
}

type AllowlistShape =
  | { kind: "absent" }
  | { kind: "malformed" }
  | { kind: "list"; entries: string[]; skipped: number };

function readAllowlist(raw: Prisma.JsonValue | null): AllowlistShape {
  if (raw === null || raw === undefined) return { kind: "absent" };
  if (!Array.isArray(raw)) return { kind: "malformed" };
  const entries = raw.filter((item): item is string => typeof item === "string");
  return { kind: "list", entries, skipped: raw.length - entries.length };
}

/** What `policyRules.models.allow` holds, if it holds a list of patterns. */
function readModelsAllow(raw: Prisma.JsonValue | null): string[] | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const models = (raw as Record<string, Prisma.JsonValue>).models;
  if (!models || typeof models !== "object" || Array.isArray(models)) {
    return null;
  }
  const allow = (models as Record<string, Prisma.JsonValue>).allow;
  if (!Array.isArray(allow)) return null;
  return allow.filter((item): item is string => typeof item === "string");
}

function toAllowlistPolicy({
  row,
  entries,
}: {
  row: PolicyRow;
  entries: string[];
}): AllowlistPolicy {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    isDefault: row.isDefault,
    strategy: row.strategy,
    entries,
    patterns: entries.map(toAnchoredPattern),
    existingModelsAllow: readModelsAllow(row.policyRules),
  };
}

function foldAllowlist(rows: PolicyRow[]): AllowlistCensus {
  const census: AllowlistCensus = {
    nonEmpty: [],
    empty: 0,
    absent: 0,
    malformed: 0,
    skippedEntries: 0,
  };
  for (const row of rows) {
    const shape = readAllowlist(row.modelAllowlist);
    if (shape.kind === "absent") {
      census.absent += 1;
    } else if (shape.kind === "malformed") {
      census.malformed += 1;
    } else {
      census.skippedEntries += shape.skipped;
      if (shape.entries.length === 0) census.empty += 1;
      else census.nonEmpty.push(toAllowlistPolicy({ row, entries: shape.entries }));
    }
  }
  return census;
}

function foldStrategy(rows: PolicyRow[]): StrategyCensus {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.strategy === DEFAULT_STRATEGY) continue;
    counts.set(row.strategy, (counts.get(row.strategy) ?? 0) + 1);
  }
  const byValue = [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  return {
    nonDefault: byValue.reduce((sum, entry) => sum + entry.count, 0),
    byValue,
  };
}

function buildReport(rows: PolicyRow[]): Report {
  const allowlist = foldAllowlist(rows);
  return {
    total: rows.length,
    allowlist,
    strategy: foldStrategy(rows),
    both: allowlist.nonEmpty.filter((policy) => policy.strategy !== DEFAULT_STRATEGY)
      .length,
  };
}

function distinctOrganizations(policies: AllowlistPolicy[]): string[] {
  return [...new Set(policies.map((policy) => policy.organizationId))].sort();
}

function count({ label, value }: { label: string; value: number }): void {
  console.log(`  ${label.padEnd(46)} ${String(value).padStart(6)}`);
}

function reportSummary(report: Report): void {
  const allowlist = report.allowlist;
  console.log("RoutingPolicy dead-field census");
  count({ label: "policies", value: report.total });
  console.log("");
  console.log("modelAllowlist, never read by the gateway");
  count({
    label: "with a non-empty allowlist",
    value: allowlist.nonEmpty.length,
  });
  count({ label: "with an empty allowlist", value: allowlist.empty });
  count({ label: "with no allowlist", value: allowlist.absent });
  count({
    label: "organizations owning a non-empty allowlist",
    value: distinctOrganizations(allowlist.nonEmpty).length,
  });
  count({
    label: "allowlist entries in total",
    value: allowlist.nonEmpty.reduce((sum, policy) => sum + policy.entries.length, 0),
  });
  if (allowlist.malformed > 0) {
    count({
      label: "holding JSON that is not an array",
      value: allowlist.malformed,
    });
  }
  if (allowlist.skippedEntries > 0) {
    count({
      label: "array members that were not strings",
      value: allowlist.skippedEntries,
    });
  }
  reportStrategySummary(report);
}

function reportStrategySummary(report: Report): void {
  const strategy = report.strategy;
  console.log("");
  console.log("strategy, never emitted to the gateway");
  count({
    label: `on the default (${DEFAULT_STRATEGY})`,
    value: report.total - strategy.nonDefault,
  });
  count({ label: "on another strategy", value: strategy.nonDefault });
  for (const entry of strategy.byValue) {
    count({ label: `  ${entry.value}`, value: entry.count });
  }
  console.log("");
  console.log("overlap");
  count({
    label: "a non-empty allowlist and another strategy",
    value: report.both,
  });
}

function reportPolicy(policy: AllowlistPolicy): void {
  const marker = policy.isDefault ? "  (organization default)" : "";
  console.log(`  ${policy.id}  ${policy.name}${marker}`);
  console.log(`    ${policy.entries.length} entries: ${policy.entries.join(", ")}`);
  if (policy.existingModelsAllow && policy.existingModelsAllow.length > 0) {
    console.log(
      `    policyRules.models.allow already enforces ${policy.existingModelsAllow.length}: ${policy.existingModelsAllow.join(
        ", ",
      )}`,
    );
  }
}

function reportDetail(policies: AllowlistPolicy[]): void {
  console.log("");
  if (policies.length === 0) {
    console.log("no policy carries a non-empty modelAllowlist");
    return;
  }
  console.log("policies carrying a non-empty modelAllowlist");
  for (const organizationId of distinctOrganizations(policies)) {
    console.log("");
    console.log(`organization ${organizationId}`);
    for (const policy of policies.filter(
      (candidate) => candidate.organizationId === organizationId,
    )) {
      reportPolicy(policy);
    }
  }
}

function reportJson(report: Report): void {
  console.log(
    JSON.stringify(
      {
        total: report.total,
        modelAllowlist: {
          nonEmpty: report.allowlist.nonEmpty.length,
          empty: report.allowlist.empty,
          absent: report.allowlist.absent,
          malformed: report.allowlist.malformed,
          skippedEntries: report.allowlist.skippedEntries,
          organizations: distinctOrganizations(report.allowlist.nonEmpty),
          policies: report.allowlist.nonEmpty,
        },
        strategy: {
          default: DEFAULT_STRATEGY,
          onDefault: report.total - report.strategy.nonDefault,
          nonDefault: report.strategy.nonDefault,
          byValue: report.strategy.byValue,
        },
        both: report.both,
      },
      null,
      2,
    ),
  );
}

const SQL_BANNER = [
  "-- ====================================================================",
  "-- NOT RUN. NOT APPLIED. NOTHING BELOW HAS TOUCHED THE DATABASE.",
  "--",
  "-- RoutingPolicy.modelAllowlist denies nothing today. The gateway bundle",
  "-- never reads it, so every entry below is decoration on a column that",
  "-- is about to be dropped.",
  "--",
  "-- policyRules.models.allow is the opposite: the data plane compiles it",
  "-- as RE2 and rejects any model no pattern matches. Applying these",
  "-- statements therefore does not preserve behaviour, it changes it. From",
  "-- the next config materialisation onward, every model outside the list",
  "-- stops answering for every virtual key bound to the policy.",
  "--",
  "-- So apply one organization at a time, only where that customer has",
  "-- asked for the allowlist to be enforced, and never as part of the",
  "-- migration that drops the column.",
  "--",
  "-- Each statement merges into the existing policyRules JSON. The other",
  "-- dimensions (tools, mcp, urls) and models.deny are left untouched;",
  "-- only models.allow is written, and it is replaced rather than added to.",
  "-- ====================================================================",
].join("\n");

/** Single-quoted SQL literal, quotes doubled the way the standard wants. */
function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/** Keeps a value from breaking out of the `--` comment it is printed in. */
function commentSafe(value: string): string {
  return value.replace(/[\r\n]+/g, " ");
}

function sqlComment(policy: AllowlistPolicy): string {
  const lines = [
    `-- organization ${policy.organizationId}`,
    `-- policy ${policy.id} ${commentSafe(policy.name)}${
      policy.isDefault ? " (organization default)" : ""
    }`,
    `-- modelAllowlist: ${commentSafe(policy.entries.join(", "))}`,
    `-- becomes:        ${commentSafe(policy.patterns.join(", "))}`,
  ];
  if (policy.existingModelsAllow && policy.existingModelsAllow.length > 0) {
    lines.push(
      `-- WARNING: policyRules.models.allow already enforces ${policy.existingModelsAllow.length} pattern(s). This statement replaces them.`,
    );
  }
  return lines.join("\n");
}

function updateStatement(policy: AllowlistPolicy): string {
  const patch = sqlString(JSON.stringify({ allow: policy.patterns }));
  return [
    'UPDATE "RoutingPolicy" SET "policyRules" =',
    `  (CASE WHEN jsonb_typeof("policyRules") = 'object'`,
    `        THEN "policyRules" ELSE '{}'::jsonb END)`,
    `  || jsonb_build_object('models',`,
    `       (CASE WHEN jsonb_typeof("policyRules" -> 'models') = 'object'`,
    `             THEN "policyRules" -> 'models' ELSE '{}'::jsonb END)`,
    `       || ${patch}::jsonb)`,
    `WHERE id = ${sqlString(policy.id)}`,
    `  AND "organizationId" = ${sqlString(policy.organizationId)};`,
  ].join("\n");
}

function reportSql(policies: AllowlistPolicy[]): void {
  console.log(SQL_BANNER);
  if (policies.length === 0) {
    console.log("");
    console.log("-- No policy carries a non-empty modelAllowlist.");
    console.log("-- There is nothing to fold into policyRules, and nothing to apply.");
    return;
  }
  for (const policy of policies) {
    console.log("");
    console.log(sqlComment(policy));
    console.log(updateStatement(policy));
  }
}

const MODE_FLAGS: Record<string, Mode> = {
  "--json": "json",
  "--emit-sql": "sql",
};

function parseMode(argv: string[]): Mode {
  // The modes are alternatives, not layers. Letting the last flag win would
  // make the output depend on argument order, which is how someone asks for
  // SQL and pastes JSON into a migration.
  const requested = new Set<Mode>();
  for (const argument of argv) {
    const mode = MODE_FLAGS[argument];
    if (!mode) return refuse(`unknown argument: ${argument}`);
    requested.add(mode);
  }
  if (requested.size > 1) {
    return refuse("--json and --emit-sql are alternatives; pass one.");
  }
  return [...requested][0] ?? "text";
}

function refuse(reason: string): never {
  console.error(reason);
  console.error(USAGE);
  process.exit(1);
}

/**
 * The whole read, unqualified so the schema comes from the connection string
 * the way the migrations do. SELECT only, no transaction, nothing locked.
 */
async function readPolicies(prisma: PrismaClient): Promise<PolicyRow[]> {
  return await prisma.$queryRaw<PolicyRow[]>`
    SELECT id,
           "organizationId",
           name,
           "isDefault",
           "modelAllowlist",
           strategy,
           "policyRules"
      FROM "RoutingPolicy"
     ORDER BY "organizationId" ASC, id ASC
  `;
}

/** True when the target database has already had the columns dropped. */
function isUndefinedColumn(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.meta as { code?: string } | undefined)?.code === UNDEFINED_COLUMN
  );
}

async function main(): Promise<void> {
  const mode = parseMode(process.argv.slice(2));
  // A client of its own rather than the app's singleton: this runs against a
  // DATABASE_URL the operator points at, and must not pick up whatever the
  // surrounding environment had configured.
  const prisma = new PrismaClient({
    adapter: createPrismaPgAdapter(process.env.DATABASE_URL ?? ""),
  });
  try {
    const report = buildReport(await readPolicies(prisma));
    if (mode === "sql") {
      reportSql(report.allowlist.nonEmpty);
      return;
    }
    if (mode === "json") {
      reportJson(report);
      return;
    }
    reportSummary(report);
    reportDetail(report.allowlist.nonEmpty);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  if (isUndefinedColumn(error)) {
    console.error(
      "This database no longer has RoutingPolicy.modelAllowlist and " +
        "RoutingPolicy.strategy: the migration that drops them has already " +
        "run here. There is nothing left to count.",
    );
    process.exit(1);
  }
  console.error(error);
  process.exit(1);
});
