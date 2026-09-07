/**
 * The row coercions every coding-agent ClickHouse repository decodes with, and the fan-out
 * that groups a set of tenants by the client each resolves to.
 */
import { Temporal, toDate, toEpochMs } from "@langwatch/time";
import type {
  CodingAgentClickHouseClient,
  CodingAgentClickHousePort,
} from "../../ports/coding-agent-clickhouse.port.ts";

/** A moment as a ClickHouse INSERT carries it. The client serialises this into
 *  `DateTime64(3)`; an instant serialises to `{}`, so the conversion is here. */
export type ClickHouseMoment = ReturnType<typeof toDate>;

/** The instant a row is stamped with, as the INSERT wants it. */
export const clickHouseMomentOf = (epochMilliseconds: number): ClickHouseMoment =>
  toDate(Temporal.Instant.fromEpochMilliseconds(epochMilliseconds));

export const asNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

export const parseClickHouseDateTimeMs = (value: string): number => {
  const parsed = toEpochMs(value.replace(" ", "T") + "Z");
  return Number.isFinite(parsed) ? parsed : 0;
};

export async function groupTenantsByClient(input: {
  tenantIds: string[];
  clickHouse: CodingAgentClickHousePort;
}): Promise<Array<{ client: CodingAgentClickHouseClient; tenantIds: string[] }>> {
  const groups = new Map<
    CodingAgentClickHouseClient,
    { client: CodingAgentClickHouseClient; tenantIds: string[] }
  >();
  for (const tenantId of new Set(input.tenantIds)) {
    const client = await input.clickHouse.resolve(tenantId);
    const existing = groups.get(client);
    if (existing) existing.tenantIds.push(tenantId);
    else groups.set(client, { client, tenantIds: [tenantId] });
  }
  return [...groups.values()];
}
