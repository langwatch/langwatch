import { afterEach, describe, expect, it } from "vitest";
import type { ClickHouseClient } from "@clickhouse/client";
import { CodingAgentClickHousePort } from "../src/ports/coding-agent-clickhouse.port";
import { CodingAgentSessionEventsClickHouseRepository } from "../src/repositories/coding-agent-session-event/clickhouse.repository";
import { TestClickHouseEndpoint } from "./fixtures/coding-agent.fixture";

const endpoints: TestClickHouseEndpoint[] = [];

afterEach(async () => {
  await Promise.all(endpoints.splice(0).map((endpoint) => endpoint.close()));
});

class RoutedClickHouse extends CodingAgentClickHousePort {
  constructor(private readonly byTenant: Map<string, TestClickHouseEndpoint>) {
    super();
  }

  async resolve(tenantId: string): Promise<ClickHouseClient> {
    const endpoint = this.byTenant.get(tenantId);
    if (endpoint === undefined) throw new Error(`no ClickHouse endpoint for ${tenantId}`);
    return endpoint.resolve();
  }
}

function modelTotal(tenantId: string, sessionId: string, costUsd: number) {
  return {
    TenantId: tenantId,
    SessionId: sessionId,
    Model: "claude-fable-5",
    InputTokens: "1",
    OutputTokens: "1",
    CacheReadTokens: "1",
    CacheCreationTokens: "1",
    CostUsd: costUsd,
  };
}

describe("Coding Agent session-event ClickHouse repository", () => {
  it("routes each tenant group to its endpoint and combines the model totals", async () => {
    const first = await TestClickHouseEndpoint.create();
    const second = await TestClickHouseEndpoint.create();
    endpoints.push(first, second);
    first.queryRows.push([modelTotal("tenant-a", "session-a", 3)]);
    second.queryRows.push([modelTotal("tenant-b", "session-b", 4)]);
    const repository = new CodingAgentSessionEventsClickHouseRepository(
      new RoutedClickHouse(
        new Map([
          ["tenant-a", first],
          ["tenant-b", second],
        ]),
      ),
      30,
    );

    const totals = await repository.sumTokensByModelPerSession({
      tenantIds: ["tenant-a", "tenant-b"],
      sessionIds: ["session-a", "session-b"],
      fromMs: Date.parse("2026-07-01T00:00:00.000Z"),
    });

    expect(first.requests[0]?.url).toContain("param_tenantIds=%5B%27tenant-a%27%5D");
    expect(second.requests[0]?.url).toContain("param_tenantIds=%5B%27tenant-b%27%5D");
    expect(totals.map((row) => row.sessionId)).toEqual(["session-a", "session-b"]);
    expect(totals.map((row) => row.costUsd)).toEqual([3, 4]);
  });

  it("uses one query when all tenants share an endpoint", async () => {
    const endpoint = await TestClickHouseEndpoint.create();
    endpoints.push(endpoint);
    endpoint.queryRows.push([]);
    const repository = new CodingAgentSessionEventsClickHouseRepository(
      new RoutedClickHouse(
        new Map([
          ["tenant-a", endpoint],
          ["tenant-b", endpoint],
        ]),
      ),
      30,
    );

    await repository.sumTokensByModelPerSession({
      tenantIds: ["tenant-a", "tenant-b"],
      sessionIds: ["session-a"],
      fromMs: Date.parse("2026-07-01T00:00:00.000Z"),
    });

    expect(endpoint.requests).toHaveLength(1);
    expect(endpoint.requests[0]?.url).toContain(
      "param_tenantIds=%5B%27tenant-a%27%2C%27tenant-b%27%5D",
    );
  });
});
