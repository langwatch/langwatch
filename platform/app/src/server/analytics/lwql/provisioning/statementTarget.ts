/**
 * Parses a ClickHouse DDL/DCL statement's own access-store target — the user
 * it creates/alters/drops or grants to, its settings profile, or a row policy
 * by short name and `ON <db>.<table>` — and the leading-keyword "kind" used to
 * log a statement without ever logging its identifier, quote or value.
 *
 * @see ./clickhouseStatementRunner.ts — matches a parsed target against the
 *   config-store inventory to decide whether a 495 is tolerated
 * @see specs/lwql/api.feature
 */

import type { ConfigStoreLwqlEntity } from "./clickhouseStatementRunner";

// Whole-token identifier, optionally backticked, capturing the bare name.
const IDENTIFIER = "`?([A-Za-z0-9_]+)`?";
// Optional `OR REPLACE` / `IF [NOT] EXISTS` between the object keyword and name.
const OPTIONAL_MODIFIERS =
  "(?:OR\\s+REPLACE\\s+)?(?:IF\\s+(?:NOT\\s+)?EXISTS\\s+)?";

// A row policy is keyed by short name AND its `ON <db>.<table>` target, so the
// pattern captures all three: 1 = short name, 2 = database (optional), 3 =
// table. Two tables can carry the same bare short name, so the ON target is
// load-bearing, not decoration — see {@link toleratedConfigStoreSkipCode}.
const ROW_POLICY_PATTERN = new RegExp(
  `^\\s*(?:CREATE|ALTER|DROP)\\s+ROW\\s+POLICY\\s+${OPTIONAL_MODIFIERS}${IDENTIFIER}\\s+ON\\s+(?:${IDENTIFIER}\\.)?${IDENTIFIER}`,
  "i",
);

const STATEMENT_TARGET_PATTERNS: ReadonlyArray<{
  readonly kind: "user" | "settings_profile";
  readonly pattern: RegExp;
}> = [
  {
    kind: "settings_profile",
    pattern: new RegExp(
      `^\\s*(?:CREATE|ALTER|DROP)\\s+SETTINGS\\s+PROFILE\\s+${OPTIONAL_MODIFIERS}${IDENTIFIER}`,
      "i",
    ),
  },
  {
    // `CREATE USER ... SETTINGS PROFILE <p>` still targets the user: the profile
    // is a clause, and this pattern anchors on `USER`, not on `SETTINGS`.
    kind: "user",
    pattern: new RegExp(
      `^\\s*(?:CREATE|ALTER|DROP)\\s+USER\\s+${OPTIONAL_MODIFIERS}${IDENTIFIER}`,
      "i",
    ),
  },
  // A grant/revoke targets the grantee — the user named after TO/FROM.
  {
    kind: "user",
    pattern: new RegExp(`^\\s*GRANT\\b[\\s\\S]*?\\bTO\\s+${IDENTIFIER}`, "i"),
  },
  {
    kind: "user",
    pattern: new RegExp(
      `^\\s*REVOKE\\b[\\s\\S]*?\\bFROM\\s+${IDENTIFIER}`,
      "i",
    ),
  },
];

/**
 * The access entity a statement targets in its OWN right — the user it
 * creates/alters/drops or grants to, the settings profile, or the row policy by
 * its short name AND its `ON <db>.<table>` target — or `null` for a statement
 * that targets no config-store entity (a table, view, named collection,
 * function, or anything unrecognized).
 *
 * A 495 is excused only when this target matches an inventoried entity (see
 * {@link toleratedConfigStoreSkipCode}). A row-policy statement whose `TO <user>`
 * clause names the config-owned user is NOT excused by that user — the target is
 * the policy, not the grantee — and a policy short name is qualified by its ON
 * target, so the same short name on another table is a different policy. Keyword
 * matching is case-insensitive and whole-token; names may be backticked.
 */
export function statementTarget(
  statement: string,
): ConfigStoreLwqlEntity | null {
  const policy = ROW_POLICY_PATTERN.exec(statement);
  if (policy) {
    // `noUncheckedIndexedAccess`: narrow the required groups. The short name and
    // table are mandatory in the pattern, so a match always has them; database
    // is the optional `(?:<db>\.)?` group and may be undefined.
    const [, name, database, table] = policy;
    if (name !== undefined && table !== undefined) {
      return { kind: "row_policy", name, database, table };
    }
  }
  for (const { kind, pattern } of STATEMENT_TARGET_PATTERNS) {
    const name = pattern.exec(statement)?.[1];
    if (name !== undefined) return { kind, name };
  }
  return null;
}

/** Throws unless `name` is a bare identifier safe to interpolate into a query. */
export function assertPlainIdentifier(name: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(
      `lwql provisioning: refusing to interpolate a non-identifier name into the config-store inventory query: ${JSON.stringify(name)}`,
    );
  }
  return name;
}

// Leading object keywords that qualify a DDL verb, so `CREATE USER lwql` logs as
// `CREATE USER` — never the identifier. Consumed until the first non-keyword.
const STATEMENT_OBJECT_KEYWORDS: ReadonlySet<string> = new Set([
  "USER",
  "ROLE",
  "ROW",
  "POLICY",
  "SETTINGS",
  "PROFILE",
  "NAMED",
  "COLLECTION",
  "FUNCTION",
  "TABLE",
  "VIEW",
  "MATERIALIZED",
  "LIVE",
  "DICTIONARY",
  "DATABASE",
  "QUOTA",
  "INTO",
]);

/**
 * The leading DDL keywords of a statement — `CREATE USER`, `CREATE ROW POLICY`,
 * `CREATE NAMED COLLECTION`, `GRANT`, `DROP NAMED COLLECTION` — with no
 * identifier, quote or value, so it is always safe to log. The `OR REPLACE` and
 * `IF [NOT] EXISTS` modifiers are dropped as noise; `GRANT`/`REVOKE` reduce to
 * the verb alone. Returns `UNKNOWN` for a statement with no leading keyword.
 */
export function statementKind(statement: string): string {
  const tokens = statement
    .replace(/\bOR\s+REPLACE\b/gi, " ")
    .replace(/\bIF\s+(?:NOT\s+)?EXISTS\b/gi, " ")
    .trim()
    .split(/\s+/);
  const verb = tokens[0]?.toUpperCase();
  if (verb === undefined || !/^[A-Z]+$/.test(verb)) return "UNKNOWN";
  if (verb === "GRANT" || verb === "REVOKE") return verb;
  const objects: string[] = [];
  for (const token of tokens.slice(1)) {
    const upper = token.toUpperCase();
    if (objects.length >= 3 || !STATEMENT_OBJECT_KEYWORDS.has(upper)) break;
    objects.push(upper);
  }
  return [verb, ...objects].join(" ");
}
