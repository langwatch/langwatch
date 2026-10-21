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
import { resolveRequestBound } from "@langwatch/plans";
import { describe, expect, it } from "vitest";

import { LWQL_APP_FUNCTION_KEY_CAPS } from "../../features/app-functions/rules/langwatch-ql-app-function-shapes.rules.ts";

const GUIDE_DIR = "../../../../../../docs/features/langwatchql/";

function section(file: string, name: string): string {
  const doc = readFileSync(fileURLToPath(new URL(GUIDE_DIR + file, import.meta.url)), "utf-8");
  const start = `{/* ${name}-start */}`;
  const end = `{/* ${name}-end */}`;
  expect(doc.indexOf(start), `${start} marker present`).toBeGreaterThan(-1);
  expect(doc.indexOf(end), `${end} marker present`).toBeGreaterThan(-1);
  return doc.slice(doc.indexOf(start), doc.indexOf(end));
}

const format = (value: number): string => value.toLocaleString("en-US");

describe("given the LangWatchQL guide and the code's numbers", () => {
  describe("when the limits table is read", () => {
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
    it("carries the key cap of each kind of key", () => {
      const table = section("extraction-functions.mdx", "lwql-key-caps");
      const caps = LWQL_APP_FUNCTION_KEY_CAPS;

      expect(table).toContain(`| ${format(caps.thread)} conversations |`);
      expect(table).toContain(`| ${format(caps.trace)} traces |`);
      expect(table).toContain(`| ${format(caps.span)} spans |`);
    });

    it("states the distinct text cap beside the eval functions", () => {
      const doc = readFileSync(
        fileURLToPath(new URL(`${GUIDE_DIR}extraction-functions.mdx`, import.meta.url)),
        "utf-8",
      );

      expect(doc).toContain(`at most ${format(LWQL_APP_FUNCTION_KEY_CAPS.text)} distinct texts`);
    });
  });
});
