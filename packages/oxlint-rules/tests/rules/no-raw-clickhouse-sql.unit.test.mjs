import { existsSync } from "node:fs";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import baseline from "../../src/rules/no-raw-clickhouse-sql.baseline.json" with { type: "json" };
import {
  baselineVerdict,
  EXEMPT_FILES,
  MUTATION_FILES,
  noRawClickhouseSqlRule,
} from "../../src/rules/no-raw-clickhouse-sql.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({});

afterAll(() => workspace.cleanup());

const ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const REPOSITORY =
  "modules/agent/process/src/repositories/clickhouse/clickhouse.agent-runs.repository.ts";
const ENTERPRISE =
  "enterprise/modules/billing/process/src/repositories/clickhouse/clickhouse.billing-runs.repository.ts";
const SERVICE = "modules/agent/process/src/services/agent-runs.service.ts";
const PRISMA = "modules/agent/process/src/repositories/prisma/prisma.agent-runs.repository.ts";
const TEST_FILE =
  "modules/agent/process/src/repositories/clickhouse/__tests__/agent-runs.unit.test.ts";
const MODULE_PROCESS_SOURCE = /^(?:enterprise\/)?modules\/[^/]+\/process\/src\//;
const TEST_PATH = /(?:__tests__|__mocks__|\.(?:test|spec|unit|integration|e2e)\.)/;
const COUNTING = [{ baseline: false }];
const [EXECUTOR] = EXEMPT_FILES.keys();
const [ERASURE] = MUTATION_FILES.keys();
// The first listed module file; the baseline tests and the baseline retire together.
const [LISTED_FILE, LISTED_COUNT] = Object.entries(baseline.findings).find(([file]) =>
  file.startsWith("modules/"),
);

function report(code, { filename = REPOSITORY, options = COUNTING } = {}) {
  return runRule(noRawClickhouseSqlRule, { code, cwd: workspace.cwd, filename, options });
}

function ids(found) {
  return found.map((finding) => finding.messageId);
}

function rawReads(count) {
  const calls = Array.from({ length: count }, () => '  await client.query({ sql: "SELECT 1" });');

  return ["export async function read(client) {", ...calls, "}"].join("\n");
}

describe("given module process code that reaches ClickHouse", () => {
  describe("when a request carrying SQL text reaches the client", () => {
    /** @scenario "A hand-written request to the ClickHouse client is reported" */
    it("reports rawRequest for `sql` and the vendor `query` key, in a repository or a service", () => {
      const found = report(
        [
          "export async function read(client, tenantId) {",
          "  await client.query({ tenantId, sql: `SELECT RunId FROM agent_runs` });",
          '  await client.command({ tenantId, sql: "OPTIMIZE TABLE agent_runs" });',
          '  await client["query"]({ tenantId, sql: "SELECT 1" });',
          "}",
        ].join("\n"),
      );
      const vendor = report('export const read = (ch) => ch.query({ query: "SELECT 1" });', {
        filename: SERVICE,
      });

      expect(found.map((finding) => [finding.messageId, finding.data.method])).toEqual([
        ["rawRequest", "query"],
        ["rawRequest", "command"],
        ["rawRequest", "query"],
      ]);
      expect(found[0].message).toBe(
        "`.query({ sql })` hands ClickHouse a hand-written statement. Hand-written SQL can drop its tenant predicate; a built read renders it from its scope." +
          " Build it with `clickhouseRead` from `@langwatch/clickhouse-client/builder` under a `tenantScope`, and send it with `client.read({ statement })`." +
          " Read the `backend` skill.",
      );
      expect(vendor.map((finding) => finding.data.key)).toEqual(["query"]);
    });
  });

  describe("when a repository sends a request it did not build", () => {
    /** @scenario "A request a repository did not build is reported" */
    it("reports forwardedRequest for a passed-in or spread request, and only in a repository", () => {
      const code = [
        "export async function read(client, request) {",
        "  await client.query(request);",
        "  await client.command({ ...request, tenantId: request.tenantId });",
        "}",
      ].join("\n");

      expect(ids(report(code))).toEqual(["forwardedRequest", "forwardedRequest"]);
      expect(ids(report(code, { filename: SERVICE }))).toEqual([]);
    });
  });

  describe("when a ClickHouse repository spells a statement under `sql`", () => {
    /** @scenario "An object spelling SQL under sql in a ClickHouse repository is reported" */
    it("reports sqlProperty in a repository or mapper, not in a service", () => {
      const code = "export const build = (id) => ({ sql: `SELECT * FROM t WHERE Id = ${id}` });";

      expect(ids(report(code, { filename: ENTERPRISE }))).toEqual(["sqlProperty"]);
      expect(ids(report(code, { filename: SERVICE }))).toEqual([]);
    });

    /** @scenario "An object spelling SQL under sql in a ClickHouse repository is reported" */
    it("reports a variable under sql beside params, and passes a domain field named sql", () => {
      const request = "export const build = (text) => ({ sql: text, params: {} });";
      const domain = "export const mapRow = (record) => ({ id: record.Id, sql: record.Sql });";

      expect(ids(report(request, { filename: ENTERPRISE }))).toEqual(["sqlProperty"]);
      expect(ids(report(domain, { filename: ENTERPRISE }))).toEqual([]);
    });
  });

  describe("when a ClickHouse repository opts a request out of a check", () => {
    /** @scenario "A tenant or cold-scan opt-out on a hand-written request is reported" */
    it("reports skipMarker beside the request, and on a loose opt-out object", () => {
      const found = report(
        [
          "export const UNSCOPED = { SKIP_COLD_SCAN_CHECK: true };",
          "export async function sweep(client) {",
          '  await client.query({ tenantId: "", sql: "SELECT 1", SKIP_TENANT_CHECK: true });',
          "}",
        ].join("\n"),
      );

      expect(found.map((finding) => [finding.messageId, finding.data.name])).toEqual([
        ["skipMarker", "SKIP_COLD_SCAN_CHECK"],
        ["rawRequest", undefined],
        ["skipMarker", "SKIP_TENANT_CHECK"],
      ]);
    });

    it("passes an insert's opt-out and a Prisma repository's", () => {
      const insert = report(
        "export const append = (client, rows) => client.insert({ tenantId: '', table: 't', rows, SKIP_TENANT_CHECK: true });",
      );
      const prisma = report("export const find = (db) => db.run({ SKIP_TENANT_CHECK: true });", {
        filename: PRISMA,
      });

      expect([...insert, ...prisma]).toEqual([]);
    });
  });

  describe("when module code imports the fence markers", () => {
    /** @scenario "An import of the fence markers is reported" */
    it("reports fenceMarker on the import, wherever in the process half", () => {
      const code = 'import { tenantScope } from "@langwatch/clickhouse-markers";';

      expect(ids(report(code, { filename: SERVICE }))).toEqual(["fenceMarker"]);
    });
  });

  describe("when module code imports the vendor ClickHouse client", () => {
    /** @scenario "An import of the vendor ClickHouse client is reported" */
    it("reports vendorClient on a value import and passes a type-only one", () => {
      const value = report('import { createClient } from "@clickhouse/client";');
      const typeOnly = report('import type { ClickHouseClient } from "@clickhouse/client";');

      expect(value.map((finding) => finding.data.source)).toEqual(["@clickhouse/client"]);
      expect(typeOnly).toEqual([]);
    });
  });

  describe("when the statement is built, inserted or under test", () => {
    /** @scenario "A built read, an insert and a test file pass" */
    it("reports nothing", () => {
      const built = [
        'import { clickhouseRead, tenantScope } from "@langwatch/clickhouse-client/builder";',
        "export async function find(client, tenantId, runs) {",
        "  const statement = clickhouseRead({ scope: tenantScope.single({ tenantId }) })",
        "    .from(runs)",
        "    .select({ id: runs.RunId });",
        "  await client.insert({ tenantId, table: 'agent_runs', rows: [] });",
        "  return client.read({ statement, declaresFullScan: true });",
        "}",
      ].join("\n");

      expect(report(built)).toEqual([]);
      expect(report(rawReads(2), { filename: TEST_FILE })).toEqual([]);
    });
  });
});

describe("given a file listed by design", () => {
  describe("when it is exempt", () => {
    /** @scenario "A file exempt by design passes" */
    it("reports nothing in it, and every exempt file exists with a reason", () => {
      expect(report(rawReads(2), { filename: EXECUTOR })).toEqual([]);
      for (const [file, reason] of [...EXEMPT_FILES, ...MUTATION_FILES]) {
        expect(existsSync(join(ROOT, file)), file).toBe(true);
        expect(reason.length, file).toBeGreaterThan(20);
      }
    });
  });

  describe("when it is a system-identity mutation file", () => {
    /** @scenario "A listed mutation file passes its writes and still reports its reads" */
    it('passes `command` and `kind: "write"` requests and reports the read', () => {
      const found = report(
        [
          "export async function erase(client, tenantId) {",
          '  await client.command({ tenantId, sql: "ALTER TABLE t DELETE WHERE TenantId = {tenantId:String}" });',
          '  await client.query({ tenantId, kind: "write", sql: "ALTER TABLE t UPDATE X = 1 WHERE 1", SKIP_TENANT_CHECK: true });',
          '  await client.query({ tenantId, sql: "SELECT count() FROM t" });',
          "}",
        ].join("\n"),
        { filename: ERASURE },
      );

      expect(found.map((finding) => [finding.messageId, finding.line])).toEqual([
        ["rawRequest", 4],
      ]);
    });
  });
});

describe("given the shrink-only baseline", () => {
  describe("when a file holds as many sites as it lists", () => {
    /** @scenario "A baselined file at its listed count passes" */
    it("reports nothing", () => {
      expect(report(rawReads(LISTED_COUNT), { filename: LISTED_FILE, options: [] })).toEqual([]);
      expect(baselineVerdict({ found: 0, listed: 0 })).toBe("pass");
    });
  });

  describe("when a file holds fewer sites than it lists", () => {
    /** @scenario "A baselined file below its listed count is told to lower the baseline" */
    it("reports baselineStale once, naming both counts", () => {
      const found = report(rawReads(LISTED_COUNT - 1), { filename: LISTED_FILE, options: [] });

      expect(found.map((finding) => [finding.messageId, finding.data])).toEqual([
        ["baselineStale", { file: LISTED_FILE, found: LISTED_COUNT - 1, listed: LISTED_COUNT }],
      ]);
    });
  });

  describe("when a file holds more sites than it lists", () => {
    /** @scenario "A baselined file above its listed count reports every site" */
    it("reports every site, since the baseline cannot grow", () => {
      const found = report(rawReads(LISTED_COUNT + 1), { filename: LISTED_FILE, options: [] });

      expect(ids(found)).toEqual(Array.from({ length: LISTED_COUNT + 1 }, () => "rawRequest"));
    });
  });

  describe("when the baseline itself is read", () => {
    /** @scenario "Every baselined file still exists as module process source" */
    it("lists only existing, governed, non-exempt files with positive counts, in order", () => {
      const files = Object.keys(baseline.findings);

      expect(baseline.record).toContain("Shrink-only");
      expect(files).toEqual(files.toSorted((left, right) => left.localeCompare(right)));
      for (const [file, count] of Object.entries(baseline.findings)) {
        expect(existsSync(join(ROOT, file)), `${file} left the tree; regenerate the baseline`).toBe(
          true,
        );
        expect(MODULE_PROCESS_SOURCE.test(file) && !TEST_PATH.test(file), file).toBe(true);
        expect(EXEMPT_FILES.has(file), file).toBe(false);
        expect(Number.isInteger(count) && count > 0, file).toBe(true);
      }
    });
  });
});
