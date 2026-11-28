/** @vitest-environment node */

/**
 * A template database built once per server and copied per test file.
 * Spec: specs/ci/package-suite-integration-lane.feature
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { startTestClickHouseEndpoints } from "../clickhouse-test-endpoints.ts";
import { cloneClickHouseTemplate } from "../clickhouse-test-templates.ts";
import { ClickHouseSchemaLock } from "../schema-lock.ts";

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const TEMPLATE = `test_template_${RUN}`;
const FIRST = `test_template_${RUN}_first`;
const SECOND = `test_template_${RUN}_second`;
const VERSIONS = `test_template_${RUN}_v_`;
const THIRD = `test_template_${RUN}_third`;

let admin: ClickHouseClient;
const lockPath = join(mkdtempSync(join(tmpdir(), "template-lock-")), "schema.lock");

async function buildSchema({ database }: { database: string }): Promise<void> {
  for (const query of [
    `CREATE TABLE ${database}.events (id UInt64, value UInt64) ENGINE = MergeTree ORDER BY id`,
    `CREATE TABLE ${database}.totals (value UInt64) ENGINE = MergeTree ORDER BY value`,
    `CREATE MATERIALIZED VIEW ${database}.events_to_totals TO ${database}.totals AS SELECT value FROM ${database}.events`,
    `CREATE VIEW ${database}.recent AS SELECT id FROM ${database}.events WHERE id > 10`,
    `CREATE TABLE ${database}.versions (version UInt64) ENGINE = MergeTree ORDER BY version`,
    `INSERT INTO ${database}.versions VALUES (1), (2)`,
  ]) {
    await admin.command({ query });
  }
}

async function rows<T>(query: string): Promise<T[]> {
  const result = await admin.query({ query, format: "JSONEachRow" });
  return result.json<T>();
}

async function objectNames(database: string): Promise<string[]> {
  const found = await rows<{ name: string }>(
    `SELECT name FROM system.tables WHERE database = '${database}' AND NOT startsWith(name, '.inner') AND name != '_langwatch_template_ready' ORDER BY name`,
  );
  return found.map(({ name }) => name);
}

beforeAll(async () => {
  const [endpoint] = await startTestClickHouseEndpoints({
    suite: "templates",
    names: ["root"],
    environment: process.env,
  });
  if (!endpoint) throw new Error("No ClickHouse endpoint was provisioned");
  const root = new URL(endpoint.url);
  root.pathname = "/";
  admin = createClient({ url: root.toString() });
});

afterAll(async () => {
  for (const database of [TEMPLATE, FIRST, SECOND, THIRD, `${VERSIONS}old`, `${VERSIONS}new`]) {
    await admin.command({ query: `DROP DATABASE IF EXISTS ${database} SYNC` });
  }
  await admin.close();
});

describe("cloneClickHouseTemplate", () => {
  describe("given two files that each need the same template on one server", () => {
    /** @scenario "A migrated schema is built once and copied into each file's database" */
    it("builds the template once and gives each file every table, view and row", async () => {
      const build = vi.fn(buildSchema);

      await Promise.all(
        [FIRST, SECOND].map((target) =>
          cloneClickHouseTemplate({
            client: admin,
            template: TEMPLATE,
            target,
            build,
            lock: ClickHouseSchemaLock.create({ lockPath }),
          }),
        ),
      );

      expect(build).toHaveBeenCalledTimes(1);
      const expected = await objectNames(TEMPLATE);
      expect(expected).toEqual(["events", "events_to_totals", "recent", "totals", "versions"]);
      expect(await objectNames(FIRST)).toEqual(expected);
      expect(await objectNames(SECOND)).toEqual(expected);
      expect(
        await rows<{ version: string }>(
          `SELECT toString(version) AS version FROM ${FIRST}.versions ORDER BY version`,
        ),
      ).toEqual([{ version: "1" }, { version: "2" }]);
    });
  });

  describe("given a copy whose materialised view reads one of its tables", () => {
    /** @scenario "A copied materialised view writes into its own database" */
    it("fills the copy's own target and leaves the template's and the other copy's empty", async () => {
      await admin.command({ query: `INSERT INTO ${FIRST}.events VALUES (11, 5), (12, 7)` });

      const totals = async (database: string) =>
        rows<{ total: string }>(`SELECT toString(sum(value)) AS total FROM ${database}.totals`);
      expect(await totals(FIRST)).toEqual([{ total: "12" }]);
      expect(await totals(TEMPLATE)).toEqual([{ total: "0" }]);
      expect(await totals(SECOND)).toEqual([{ total: "0" }]);
      expect(
        await rows<{ id: string }>(`SELECT toString(id) AS id FROM ${FIRST}.recent ORDER BY id`),
      ).toEqual([{ id: "11" }, { id: "12" }]);
    });
  });

  describe("given an older version of a template on the server", () => {
    /** @scenario "Building a template drops its older versions" */
    it("drops the older version and leaves other databases alone", async () => {
      await cloneClickHouseTemplate({
        client: admin,
        template: `${VERSIONS}old`,
        target: THIRD,
        build: buildSchema,
        supersedes: VERSIONS,
        lock: ClickHouseSchemaLock.create({ lockPath }),
      });

      await cloneClickHouseTemplate({
        client: admin,
        template: `${VERSIONS}new`,
        target: THIRD,
        build: buildSchema,
        supersedes: VERSIONS,
        lock: ClickHouseSchemaLock.create({ lockPath }),
      });

      const left = await rows<{ name: string }>(
        `SELECT name FROM system.databases WHERE startsWith(name, 'test_template_${RUN}') ORDER BY name`,
      );
      expect(left.map(({ name }) => name)).toEqual(
        [FIRST, SECOND, THIRD, TEMPLATE, `${VERSIONS}new`].toSorted(),
      );
    });
  });
});
