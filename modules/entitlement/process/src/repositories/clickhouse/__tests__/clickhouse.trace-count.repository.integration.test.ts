/**
 * @vitest-environment node
 * The trace count's own SQL against the migrated ClickHouse the running job supplies (goose
 * 00104): skipped when no test ClickHouse is configured.
 * Spec: modules/entitlement/specs/usage.feature
 */
import { randomUUID } from "node:crypto";

import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { vendorQueryClient } from "@langwatch/clickhouse-client/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TraceCountClickHouseRepository } from "../clickhouse.trace-count.repository.ts";

/** `TEST_CLICKHOUSE_URL` names its own database; `CI_CLICKHOUSE_URL` is the job's migrated one. */
function testClickHouseUrl(): URL | null {
  const configured = process.env.TEST_CLICKHOUSE_URL ?? process.env.CI_CLICKHOUSE_URL;
  if (!configured) return null;
  const url = new URL(configured);
  if (!process.env.TEST_CLICKHOUSE_URL) url.pathname = "/test_langwatch";
  return url;
}

const clickHouseUrl = testClickHouseUrl();
const organizationId = `${randomUUID()}-trace-count`;
const projectA = `${organizationId}-a`;
const projectB = `${organizationId}-b`;
const projectQuiet = `${organizationId}-quiet`;

let ch: ClickHouseClient;
let counts: TraceCountClickHouseRepository;

beforeAll(async () => {
  if (!clickHouseUrl) return;
  ch = createClient({ url: clickHouseUrl });
  counts = TraceCountClickHouseRepository.create(vendorQueryClient({ vendor: ch, indexes: [] }));
  // trace-1 was first seen in September, so it counts there and not in October; trace-2 is
  // written twice and still counts once; project B's trace-1 is its own trace.
  await counts.insert({
    organizationId,
    rows: [
      { projectId: projectA, traceId: "trace-1", month: "2026-09" },
      { projectId: projectA, traceId: "trace-1", month: "2026-10" },
      { projectId: projectA, traceId: "trace-2", month: "2026-10" },
      { projectId: projectA, traceId: "trace-2", month: "2026-10" },
      { projectId: projectA, traceId: "trace-3", month: "2026-10" },
    ],
  });
  await counts.insert({
    organizationId,
    rows: [{ projectId: projectB, traceId: "trace-1", month: "2026-10" }],
  });
}, 60_000);

afterAll(async () => {
  if (!ch) return;
  await ch.command({
    query: "ALTER TABLE usage_trace_meter DELETE WHERE OrganizationId = {organizationId:String}",
    query_params: { organizationId },
  });
  await ch.close();
});

describe.skipIf(clickHouseUrl === null)("TraceCountClickHouseRepository on ClickHouse", () => {
  describe("given trace usage rows for two projects over two months", () => {
    /** @scenario The trace count's statements run on the shipped schema */
    it("counts each trace once, in the earliest month it has a row", async () => {
      await expect(counts.findTotal({ organizationId, month: "2026-10" })).resolves.toBe(3);
      await expect(counts.findTotal({ organizationId, month: "2026-09" })).resolves.toBe(1);
    });

    /** @scenario The trace count's statements run on the shipped schema */
    it("reports each project's count under its own id, and nothing for a quiet project", async () => {
      const october = await counts.countByProjects({
        organizationId,
        projectIds: [projectQuiet, projectB, projectA],
        month: "2026-10",
      });

      expect(october).toHaveLength(2);
      expect(october).toEqual(
        expect.arrayContaining([
          { projectId: projectA, count: 2 },
          { projectId: projectB, count: 1 },
        ]),
      );
    });
  });
});
