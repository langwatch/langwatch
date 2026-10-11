import type { IdIndexFlags } from "@langwatch/clickhouse-client";
import { afterEach, describe, expect, it } from "vitest";

import {
  TestClickHouseEndpoint,
  TestClock,
} from "../../../__tests__/fixtures/coding-agent.fixture.ts";
import { NoopCodingAgentReadMetricsService } from "../../../__tests__/support/coding-agent-read-metrics-noop.service.ts";
import { CodingAgentSessionEventsClickHouseRepository } from "../clickhouse.coding-agent-session-event.repository.ts";
import { CodingAgentSessionClickHouseRepository } from "../clickhouse.coding-agent-session.repository.ts";
import { CodingAgentTraceSessionClickHouseRepository } from "../clickhouse.coding-agent-trace-session.repository.ts";

const DAY_MS = 86_400_000;
const FROM_MS = Date.parse("2026-08-03T10:00:00Z");
const TO_MS = Date.parse("2026-08-05T10:00:00Z");
const ON: IdIndexFlags = { isOn: () => true };
const OFF: IdIndexFlags = { isOn: () => false };

const endpoints: TestClickHouseEndpoint[] = [];

afterEach(async () => {
  await Promise.all(endpoints.splice(0).map((endpoint) => endpoint.close()));
});

async function endpointWith(bounds: { n: number }) {
  const endpoint = await TestClickHouseEndpoint.create();
  endpoints.push(endpoint);
  endpoint.queryRows.push([{ ...bounds, fromMs: FROM_MS, toMs: TO_MS }]);
  return endpoint;
}

/** The statements that read the source table, leaving out the index point read. */
const sourceReads = (endpoint: TestClickHouseEndpoint) =>
  endpoint.requests.filter((request) => !request.body.includes("_id_index"));

const paramOf = (request: { url: string }, name: string) =>
  new URL(request.url, "http://x").searchParams.get(`param_${name}`);

const countOf = (text: string, needle: string) => text.split(needle).length - 1;

describe("coding-agent lookups by id with the id index", () => {
  describe("given a session looked up by its id alone", () => {
    it("bounds the outer scan and the dedup subquery to the index range, a day each side", async () => {
      const endpoint = await endpointWith({ n: 2 });
      endpoint.queryRows.push([]);
      const repository = CodingAgentSessionClickHouseRepository.create({
        clickhouse: endpoint.clickhouse,
        defaultTraceRetentionDays: 30,
        metrics: NoopCodingAgentReadMetricsService.create(),
        clock: new TestClock(),
      });

      await repository.findBySessionId({ tenantId: "project-1", sessionId: "s-1", idIndex: ON });

      const [read] = sourceReads(endpoint);
      expect(read?.body).toContain("StartedAt >= fromUnixTimestamp64Milli");
      expect(countOf(read?.body ?? "", "StartedAt >=")).toBe(2);
      expect(paramOf(read!, "fromMs")).toBe(String(FROM_MS - DAY_MS));
      expect(paramOf(read!, "toMs")).toBe(String(TO_MS + DAY_MS));
    });

    it("reads as before while the flag is off, with no index read and no bound", async () => {
      const endpoint = await endpointWith({ n: 2 });
      endpoint.queryRows.length = 0;
      endpoint.queryRows.push([]);
      const repository = CodingAgentSessionClickHouseRepository.create({
        clickhouse: endpoint.clickhouse,
        defaultTraceRetentionDays: 30,
        metrics: NoopCodingAgentReadMetricsService.create(),
        clock: new TestClock(),
      });

      await repository.findBySessionId({ tenantId: "project-1", sessionId: "s-1", idIndex: OFF });

      expect(endpoint.requests).toHaveLength(1);
      expect(endpoint.requests[0]?.body).not.toContain("StartedAt >=");
      expect(endpoint.requests[0]?.body).not.toContain("_id_index");
    });

    it("probes the recent weeks once for a session the index has never seen", async () => {
      const endpoint = await endpointWith({ n: 0 });
      endpoint.queryRows.push([]);
      const repository = CodingAgentSessionClickHouseRepository.create({
        clickhouse: endpoint.clickhouse,
        defaultTraceRetentionDays: 30,
        metrics: NoopCodingAgentReadMetricsService.create(),
        clock: new TestClock(),
      });

      await repository.findBySessionId({ tenantId: "project-1", sessionId: "s-1", idIndex: ON });

      expect(sourceReads(endpoint)).toHaveLength(1);
      const [read] = sourceReads(endpoint);
      const spanMs = Number(paramOf(read!, "toMs")) - Number(paramOf(read!, "fromMs"));
      expect(spanMs).toBeLessThan(40 * DAY_MS);
    });
  });

  describe("given a session looked up with the caller's own time", () => {
    it("keeps the caller's window on the outer scan and leaves the dedup unbounded", async () => {
      const endpoint = await TestClickHouseEndpoint.create();
      endpoints.push(endpoint);
      endpoint.queryRows.push([]);
      const repository = CodingAgentSessionClickHouseRepository.create({
        clickhouse: endpoint.clickhouse,
        defaultTraceRetentionDays: 30,
        metrics: NoopCodingAgentReadMetricsService.create(),
        clock: new TestClock(),
      });

      await repository.findBySessionId({
        tenantId: "project-1",
        sessionId: "s-1",
        window: { fromMs: FROM_MS, toMs: TO_MS },
        idIndex: ON,
      });

      expect(endpoint.requests).toHaveLength(1);
      expect(countOf(endpoint.requests[0]?.body ?? "", "StartedAt BETWEEN")).toBe(1);
      expect(paramOf(endpoint.requests[0]!, "from")).toBe(String(FROM_MS));
    });
  });

  describe("given a session's events listed with no window", () => {
    it("bounds the read to the index range", async () => {
      const endpoint = await endpointWith({ n: 1 });
      endpoint.queryRows.push([]);
      const repository = CodingAgentSessionEventsClickHouseRepository.create({
        clickhouse: endpoint.clickhouse,
        defaultTraceRetentionDays: 30,
      });

      await repository.listBySessionId({
        tenantId: "project-1",
        sessionId: "s-1",
        limit: 10,
        idIndex: ON,
      });

      const [read] = sourceReads(endpoint);
      expect(read?.body).toContain("TimeUnixMs >= fromUnixTimestamp64Milli");
      expect(paramOf(read!, "fromMs")).toBe(String(FROM_MS - DAY_MS));
    });

    it("keeps an explicit window as the caller gave it", async () => {
      const endpoint = await TestClickHouseEndpoint.create();
      endpoints.push(endpoint);
      endpoint.queryRows.push([]);
      const repository = CodingAgentSessionEventsClickHouseRepository.create({
        clickhouse: endpoint.clickhouse,
        defaultTraceRetentionDays: 30,
      });

      await repository.listBySessionId({
        tenantId: "project-1",
        sessionId: "s-1",
        occurredAt: { fromMs: FROM_MS, toMs: TO_MS },
        limit: 10,
        idIndex: ON,
      });

      expect(endpoint.requests).toHaveLength(1);
      expect(endpoint.requests[0]?.body).toContain("TimeUnixMs BETWEEN");
    });
  });

  describe("given a trace's session looked up by trace id", () => {
    it("bounds the outer scan and the dedup subquery to the index range", async () => {
      const endpoint = await endpointWith({ n: 1 });
      endpoint.queryRows.push([]);
      const repository = CodingAgentTraceSessionClickHouseRepository.create({
        clickhouse: endpoint.clickhouse,
        defaultTraceRetentionDays: 30,
      });

      await repository.findByTraceId({ tenantId: "project-1", traceId: "t-1", idIndex: ON });

      const [read] = sourceReads(endpoint);
      expect(countOf(read?.body ?? "", "OccurredAt >=")).toBe(2);
      expect(paramOf(read!, "toMs")).toBe(String(TO_MS + DAY_MS));
    });

    it("reads unbounded while the flag is off", async () => {
      const endpoint = await TestClickHouseEndpoint.create();
      endpoints.push(endpoint);
      endpoint.queryRows.push([]);
      const repository = CodingAgentTraceSessionClickHouseRepository.create({
        clickhouse: endpoint.clickhouse,
        defaultTraceRetentionDays: 30,
      });

      await repository.findByTraceId({ tenantId: "project-1", traceId: "t-1", idIndex: OFF });

      expect(endpoint.requests).toHaveLength(1);
      expect(endpoint.requests[0]?.body).not.toContain("OccurredAt >=");
    });
  });
});
