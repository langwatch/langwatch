import type { ClickHouseClient } from "@clickhouse/client";
import type { CodingAgentClickHousePort } from "../../ports/coding-agent-clickhouse.port";

export const asNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];

export const parseClickHouseDateTimeMs = (value: string): number => {
  const parsed = new Date(value.replace(" ", "T") + "Z").getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

export async function groupTenantsByClient(input: {
  tenantIds: string[];
  clickHouse: CodingAgentClickHousePort;
}): Promise<Array<{ client: ClickHouseClient; tenantIds: string[] }>> {
  const groups = new Map<
    ClickHouseClient,
    { client: ClickHouseClient; tenantIds: string[] }
  >();
  for (const tenantId of new Set(input.tenantIds)) {
    const client = await input.clickHouse.resolve(tenantId);
    const existing = groups.get(client);
    if (existing) existing.tenantIds.push(tenantId);
    else groups.set(client, { client, tenantIds: [tenantId] });
  }
  return [...groups.values()];
}
