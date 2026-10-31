/**
 * The LangWatchQL guide restates the limits, the per-plan rate limits and the extraction-function
 * key caps between MDX markers. A number changed in code with no docs change ships a false
 * promise, so each table must carry the code's numbers.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_LWQL_RESOURCE_LIMITS,
  MAX_LWQL_LENGTH,
} from "@langwatch/analytics-contract/langwatch-ql-limits";
import { APP_ERROR_CODES } from "@langwatch/handled-error";
import { resolveRequestBound } from "@langwatch/plans";
import { describe, expect, it } from "vitest";

import { LWQL_APP_FUNCTION_KEY_CAPS } from "../../features/app-functions/rules/langwatch-ql-app-function-shapes.rules.ts";

const GUIDE_DIR = "../../../../../../docs/features/langwatchql/";

/** The files that write the LangWatchQL error messages the guide quotes. */
const MESSAGE_SOURCES = [
  "../langwatch-ql-query-walk.rules.ts",
  "../../services/langwatch-ql-validation.service.ts",
  "../../../../contract/src/features/lwql/langwatch-ql.errors.ts",
  "../../../../contract/src/analytics-query.errors.ts",
];

function read(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf-8");
}

function section(file: string, name: string): string {
  const doc = read(GUIDE_DIR + file);
  const start = `{/* ${name}-start */}`;
  const end = `{/* ${name}-end */}`;
  expect(doc.indexOf(start), `${start} marker present`).toBeGreaterThan(-1);
  expect(doc.indexOf(end), `${end} marker present`).toBeGreaterThan(-1);
  return doc.slice(doc.indexOf(start), doc.indexOf(end));
}

const format = (value: number): string => value.toLocaleString("en-US");

describe("given the LangWatchQL guide and the code's numbers", () => {
  describe("when the limits table is read", () => {
    /** @scenario "The guide's limits table carries the shipped resource limits and the statement length" */
    it("carries the shipped resource limits and the statement length", () => {
      const table = section("limits-and-cost.mdx", "lwql-limits");
      const limits = DEFAULT_LWQL_RESOURCE_LIMITS;

      expect(table).toContain(`| Rows per response | ${format(limits.maxResultRows)}.`);
      expect(table).toContain(`About ${format(limits.maxResultBytes)} bytes`);
      expect(table).toContain(`${format(MAX_LWQL_LENGTH)} characters`);
      expect(table).toContain(`| Run time | ${limits.maxExecutionTimeSeconds} seconds`);
      expect(table).toContain(`| Memory | ${limits.maxMemoryUsageBytes / 1_000_000_000} GB`);
      expect(table).toContain(
        `${format(limits.maxRowsToRead)} rows or ${format(limits.maxBytesToRead)} bytes`,
      );
      expect(table).toContain(`| Threads | ${limits.maxThreads} per query`);
      expect(table).toContain(`| Queries running at once | ${limits.maxConcurrentQueriesForUser},`);
    });
  });

  describe("when the per-plan rate table is read", () => {
    /** @scenario "The guide's per-plan rate table carries each plan's queries per minute" */
    it("carries the lwqlPerMinute bound of each plan", () => {
      const table = section("limits-and-cost.mdx", "lwql-rates");

      expect(table).toContain(`| Free | ${resolveRequestBound("lwqlPerMinute", "FREE")} |`);
      expect(table).toContain(`| Paid | ${resolveRequestBound("lwqlPerMinute", "PRO")} |`);
      expect(table).toContain(
        `| Enterprise | ${resolveRequestBound("lwqlPerMinute", "ENTERPRISE")} |`,
      );
    });
  });

  describe("when the extraction function table is read", () => {
    /** @scenario "The guide's extraction function page carries the key cap of each kind of key" */
    it("carries the key cap of each kind of key", () => {
      const table = section("extraction-functions.mdx", "lwql-key-caps");
      const caps = LWQL_APP_FUNCTION_KEY_CAPS;

      expect(table).toContain(`| ${format(caps.thread)} conversations |`);
      expect(table).toContain(`| ${format(caps.trace)} traces |`);
      expect(table).toContain(`| ${format(caps.span)} spans |`);
    });

    /** @scenario "The guide's extraction function page carries the key cap of each kind of key" */
    it("states the distinct text cap beside the eval functions", () => {
      const doc = read(`${GUIDE_DIR}extraction-functions.mdx`);

      expect(doc).toContain(`at most ${format(LWQL_APP_FUNCTION_KEY_CAPS.text)} distinct texts`);
    });
  });

  describe("when the row limit is stated outside the limits table", () => {
    /** @scenario "The guide's row limit figures outside the limits table match the shipped row limit" */
    it("states the shipped maximum result rows each time", () => {
      const maxRows = DEFAULT_LWQL_RESOURCE_LIMITS.maxResultRows;
      const pages = ["limits-and-cost.mdx", "common-questions.mdx"].map((file) =>
        read(GUIDE_DIR + file),
      );
      const counts = pages.flatMap((doc) => [
        ...[...doc.matchAll(/(?:more than|maximum of|above) ([\d,]+) rows/g)].map((m) => m[1]),
        ...[...doc.matchAll(/`LIMIT (\d+)`/g)].map((m) => m[1]),
        ...[...doc.matchAll(/`LIMIT` above ([\d,]+)/g)].map((m) => m[1]),
      ]);

      expect(counts.length).toBeGreaterThan(0);
      for (const count of counts) {
        expect(Number(count?.replaceAll(",", ""))).toBe(maxRows);
      }
    });
  });

  describe("when the error messages and error codes are read", () => {
    /** @scenario "The guide's error messages and error codes are the ones the code returns" */
    it("quotes only messages the code produces", () => {
      const code = MESSAGE_SOURCES.map(read)
        .join("\n")
        .replace(/[`"]\s*\+\s*[`"]/g, "")
        .replaceAll("\\`", "`");
      const doc = read(`${GUIDE_DIR}common-questions.mdx`);
      const lines = [...doc.matchAll(/```text\n([\s\S]*?)```/g)].flatMap((m) =>
        (m[1] ?? "").split("\n").filter(Boolean),
      );
      const placeholder = new RegExp(
        `<[a-z]+>|\\bN\\b|X\\.X|: X\\.|\\.\\.\\.$|${format(DEFAULT_LWQL_RESOURCE_LIMITS.maxResultRows)}`,
      );

      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        for (const fragment of line.split(placeholder).filter((part) => part.length > 3)) {
          expect(code, `message fragment "${fragment}"`).toContain(fragment);
        }
      }
    });

    /** @scenario "The guide's error messages and error codes are the ones the code returns" */
    it("lists only registered error codes", () => {
      const table = section("limits-and-cost.mdx", "lwql-error-codes");
      const codes = [...table.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]);
      const registered = new Set<string>(APP_ERROR_CODES);

      expect(codes.length).toBeGreaterThan(10);
      for (const code of codes) {
        expect(registered.has(code ?? ""), `${code} is registered`).toBe(true);
      }
    });
  });
});
