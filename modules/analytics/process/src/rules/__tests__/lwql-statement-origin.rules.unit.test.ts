/**
 * Who wrote a statement: the stock text is built in, anything else is the user's.
 * @see specs/lwql/query-origin.feature
 * @vitest-environment node
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  LWQL_BUILTIN_STATEMENT_COVERAGE,
  LWQL_BUILTIN_STATEMENT_HASHES,
} from "../lwql-builtin-statements.generated.ts";
import { hashStatement, originOfStatement } from "../lwql-statement-origin.rules.ts";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const STOCK: readonly { label: string; sql: string }[] = JSON.parse(
  read("../../langwatch-ql/__tests__/fixtures/stock-widget-queries.json"),
);

describe("given the committed stock widget statements", () => {
  /** @scenario "Every current stock statement is on the list" */
  it("has every statement's sha256 hash, as written, on the generated list", () => {
    const missing = STOCK.filter(
      ({ sql }) =>
        !LWQL_BUILTIN_STATEMENT_HASHES.includes(createHash("sha256").update(sql).digest("hex")),
    ).map(({ label }) => label);

    expect(STOCK.length).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });

  it("hashes the statement exactly as sent, without trimming", () => {
    const sql = STOCK[0]!.sql;

    expect(hashStatement({ sql })).toBe(createHash("sha256").update(sql).digest("hex"));
    expect(hashStatement({ sql: `${sql} ` })).not.toBe(hashStatement({ sql }));
  });

  /** @scenario "A hand-pasted copy of a stock statement counts as built in" */
  it("reads every stock statement, typed by anyone, as built in", () => {
    expect(STOCK.map(({ sql }) => originOfStatement({ sql }))).toEqual(STOCK.map(() => "built_in"));
  });

  /** @scenario "A statement edited by one character is user-written" */
  it("reads a stock statement with one character changed as user-written", () => {
    const sql = STOCK[0]!.sql;

    expect(originOfStatement({ sql: sql.replace("SELECT", "SELEKT") })).toBe("user_written");
    expect(originOfStatement({ sql: `${sql};` })).toBe("user_written");
  });

  it("reads a statement the stock never held as user-written", () => {
    expect(originOfStatement({ sql: "SELECT 1" })).toBe("user_written");
  });
});

describe("given the generated list", () => {
  /** @scenario "The list says what it covers" */
  it("states in its header the stock statement versions it covers and the oldest commit", () => {
    const header = read("../lwql-builtin-statements.generated.ts")
      .split("\n")
      .slice(0, 4)
      .join("\n");
    const { versions, oldestCommit, commits } = LWQL_BUILTIN_STATEMENT_COVERAGE;

    expect(versions).toBeGreaterThanOrEqual(1);
    expect(commits).toHaveLength(versions);
    expect(commits.at(-1)).toBe(oldestCommit);
    expect(oldestCommit).toMatch(/^[0-9a-f]{7,40}$/);
    expect(header).toContain(
      `Covers ${versions} stock statement versions, oldest commit ${oldestCommit}`,
    );
  });

  it("holds only distinct sha256 hex hashes", () => {
    expect(new Set(LWQL_BUILTIN_STATEMENT_HASHES).size).toBe(LWQL_BUILTIN_STATEMENT_HASHES.length);
    expect(LWQL_BUILTIN_STATEMENT_HASHES.every((hash) => /^[0-9a-f]{64}$/.test(hash))).toBe(true);
  });
});
