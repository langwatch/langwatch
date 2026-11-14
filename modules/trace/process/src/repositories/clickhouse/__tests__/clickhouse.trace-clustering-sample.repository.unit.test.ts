import type { ClickHouseQueryClient, QueryRequest } from "@langwatch/clickhouse-client";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it } from "vitest";

import { ClickHouseTraceClusteringSampleRepository } from "../clickhouse.trace-clustering-sample.repository.ts";

type ReadRequest = Parameters<ClickHouseQueryClient["read"]>[0];

/** Answers the rows given and remembers each raw request and each built statement. */
function repositoryOver(rows: unknown[]) {
  const requests: QueryRequest[] = [];
  const statements: ReadRequest["statement"][] = [];
  const clickhouse = clickHouseQueryClientDouble({
    async query(request: QueryRequest): Promise<{ rows: unknown[] }> {
      requests.push(request);
      return { rows };
    },
    async read({ statement }: ReadRequest) {
      statements.push(statement);
      return { rows };
    },
  });
  const repository = ClickHouseTraceClusteringSampleRepository.create(clickhouse);
  return { repository, requests, statements };
}

describe("ClickHouseTraceClusteringSampleRepository", () => {
  it("counts over the tenant's own summaries, in the windows it is given", async () => {
    const { repository, statements } = repositoryOver([
      { total: "12", recent: "5", assigned: "3" },
    ]);

    await expect(
      repository.countTraces({ tenantId: "project-1", recentSinceMs: 30, windowStartMs: 365 }),
    ).resolves.toEqual({ total: 12, recent: 5, assigned: 3 });
    expect(statements[0]).toMatchObject({
      kind: "tenant",
      identity: "reader",
      tenantId: "project-1",
      tenantIds: undefined,
    });
    expect(statements[0]?.settings).toMatchObject({ SQL_langwatch_tenant_ids: "project-1" });
    expect(statements[0]?.sql).toContain("WHERE TenantId = {tenantId:String}");
    expect(statements[0]?.sql).toMatch(/GROUP BY TenantId, TraceId/);
    expect(Object.values(statements[0]?.params ?? {})).toEqual(
      expect.arrayContaining(["project-1", 30, 365]),
    );
  });

  it("reads a first batch page with no topic filter and placeholder topic lists", async () => {
    const { repository, requests } = repositoryOver([
      {
        TraceId: "trace-1",
        ComputedInput: '"hello"',
        TopicId: null,
        SubTopicId: null,
        OccurredAtMs: "5000",
      },
    ]);

    await expect(
      repository.findPageRows({ tenantId: "project-1", windowStartMs: 49 }),
    ).resolves.toEqual([
      {
        traceId: "trace-1",
        computedInput: '"hello"',
        topicId: null,
        subtopicId: null,
        occurredAtMs: 5000,
      },
    ]);
    const request = requests[0];
    expect(request?.tenantId).toBe("project-1");
    expect(request?.sql).not.toContain("HAVING");
    expect(request?.params).toEqual({
      tenantId: "project-1",
      fetchWindowStartMs: 49,
      topicIds: ["__none__"],
      subtopicIds: ["__none__"],
    });
    expect(request?.settings).toEqual({ max_threads: "2" });
  });

  it("streams the outer query without a top-N sort buffer", async () => {
    const { repository, requests } = repositoryOver([]);

    await repository.findPageRows({ tenantId: "project-1", windowStartMs: 49 });

    // An outer ORDER BY ... LIMIT buffers every ComputedInput at once; only the page CTE sorts.
    expect(requests[0]?.sql.match(/ORDER BY/gi)).toHaveLength(1);
  });

  /** @scenario "A finished run moves the clustering watermark so the next run skips what it read" */
  it("ends the page at the run's window end instead of now when given one", async () => {
    const { repository, requests } = repositoryOver([]);

    await repository.findPageRows({ tenantId: "project-1", windowStartMs: 49, windowEndMs: 90 });

    const request = requests[0];
    expect(request?.sql).not.toContain("now64(3)");
    expect(request?.sql.match(/fetchWindowEndMs:UInt64/g)).toHaveLength(3);
    expect(request?.params).toMatchObject({ fetchWindowEndMs: 90 });
  });

  it("keeps an incremental page to traces outside the known topics, after the cursor", async () => {
    const { repository, requests } = repositoryOver([]);

    await repository.findPageRows({
      tenantId: "project-1",
      windowStartMs: 49,
      unassignedFrom: { topicIds: ["topic-1"], subtopicIds: [] },
      searchAfter: [4_000, "trace-9"],
    });

    const request = requests[0];
    expect(request?.sql).toContain("NOT IN ({topicIds:Array(String)})");
    expect(request?.sql).not.toContain("NOT IN ({subtopicIds:Array(String)})");
    expect(request?.sql).toContain("TraceId > {lastTraceId:String}");
    expect(request?.params).toMatchObject({
      topicIds: ["topic-1"],
      subtopicIds: ["__none__"],
      lastTs: 4_000,
      lastTraceId: "trace-9",
    });
  });
});
