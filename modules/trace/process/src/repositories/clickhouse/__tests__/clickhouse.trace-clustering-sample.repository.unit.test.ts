import { describe, expect, it } from "vitest";

import type { TraceClickHouseClient } from "../../trace-clickhouse-client.repository.ts";
import { ClickHouseTraceClusteringSampleRepository } from "../clickhouse.trace-clustering-sample.repository.ts";

type Request = Parameters<TraceClickHouseClient["query"]>[0];

/** Answers the rows as JSON, the way the wire does, and remembers each request. */
class RecordingClickHouse implements TraceClickHouseClient {
  readonly requests: Request[] = [];

  constructor(private readonly body: string) {}

  async query<Row>(request: Request): Promise<{ json<T = Row>(): Promise<T[]> }> {
    this.requests.push(request);
    const body = this.body;
    return { json: async () => JSON.parse(body) };
  }
}

function repositoryOver(rows: unknown[]) {
  const clickhouse = new RecordingClickHouse(JSON.stringify(rows));
  const tenants: string[] = [];
  const repository = ClickHouseTraceClusteringSampleRepository.create({
    resolveClient: async (tenantId) => {
      tenants.push(tenantId);
      return clickhouse;
    },
  });
  return { repository, clickhouse, tenants };
}

describe("ClickHouseTraceClusteringSampleRepository", () => {
  it("counts over the tenant's own summaries, in the windows it is given", async () => {
    const { repository, clickhouse, tenants } = repositoryOver([
      { total: "12", recent: "5", assigned: "3" },
    ]);

    await expect(
      repository.countTraces({ tenantId: "project-1", recentSinceMs: 30, windowStartMs: 365 }),
    ).resolves.toEqual({ total: 12, recent: 5, assigned: 3 });
    expect(tenants).toEqual(["project-1"]);
    expect(clickhouse.requests[0]?.query).toContain("WHERE TenantId = {tenantId:String}");
    expect(clickhouse.requests[0]?.query_params).toEqual({
      tenantId: "project-1",
      thirtyDaysAgo: 30,
      twelveMonthsAgo: 365,
    });
  });

  it("reads a first batch page with no topic filter and placeholder topic lists", async () => {
    const { repository, clickhouse } = repositoryOver([
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
    const request = clickhouse.requests[0];
    expect(request?.query).not.toContain("HAVING");
    expect(request?.query_params).toEqual({
      tenantId: "project-1",
      fetchWindowStartMs: 49,
      topicIds: ["__none__"],
      subtopicIds: ["__none__"],
    });
    expect(request?.clickhouse_settings).toEqual({ max_threads: "2" });
  });

  it("streams the outer query without a top-N sort buffer", async () => {
    const { repository, clickhouse } = repositoryOver([]);

    await repository.findPageRows({ tenantId: "project-1", windowStartMs: 49 });

    // An outer ORDER BY ... LIMIT buffers every ComputedInput at once; only the page CTE sorts.
    expect(clickhouse.requests[0]?.query.match(/ORDER BY/gi)).toHaveLength(1);
  });

  it("keeps an incremental page to traces outside the known topics, after the cursor", async () => {
    const { repository, clickhouse } = repositoryOver([]);

    await repository.findPageRows({
      tenantId: "project-1",
      windowStartMs: 49,
      unassignedFrom: { topicIds: ["topic-1"], subtopicIds: [] },
      searchAfter: [4_000, "trace-9"],
    });

    const request = clickhouse.requests[0];
    expect(request?.query).toContain("NOT IN ({topicIds:Array(String)})");
    expect(request?.query).not.toContain("NOT IN ({subtopicIds:Array(String)})");
    expect(request?.query).toContain("TraceId > {lastTraceId:String}");
    expect(request?.query_params).toMatchObject({
      topicIds: ["topic-1"],
      subtopicIds: ["__none__"],
      lastTs: 4_000,
      lastTraceId: "trace-9",
    });
  });
});
