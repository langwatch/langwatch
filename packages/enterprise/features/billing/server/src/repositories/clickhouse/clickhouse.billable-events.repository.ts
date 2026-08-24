// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * BillableEventsClickHouseRepository — the queries behind billing-month
 * usage rollups (`billableEventsQuery.ts`'s public functions).
 *
 * Two resolvers because the table has two different scoping stories:
 *   - `billable_events` is queried by `OrganizationId` (the billing
 *     entity), not by a single project's TenantId — an org's billable
 *     events span every project it owns, and `resolveOrganizationClient`
 *     routes to that org's ClickHouse instance directly.
 *   - `trace_summaries` is queried by `TenantId IN (...)` across a set of
 *     project ids the caller already resolved for the org, so the client
 *     is picked via the first of those projects with `resolveClient`
 *     (per-tenant routing lands on the same org's instance either way).
 */
import type { ClickHouseClient } from "@clickhouse/client";
import {
  BillableEventsRepository,
  type BillableEventsWindow,
} from "../../ports/billable-events.port";

export type ClickHouseClientResolver = (
  tenantId: string,
) => Promise<ClickHouseClient>;

export class BillableEventsClickHouseRepository extends BillableEventsRepository {
  private constructor(
    private readonly resolveClient: ClickHouseClientResolver,
    private readonly resolveOrganizationClient: ClickHouseClientResolver,
  ) {
    super();
  }

  static create(options: {
    resolveClient: ClickHouseClientResolver;
    resolveOrganizationClient: ClickHouseClientResolver;
  }): BillableEventsClickHouseRepository {
    return new BillableEventsClickHouseRepository(
      options.resolveClient,
      options.resolveOrganizationClient,
    );
  }

  /** Exact distinct billable-event count for the org in the window. */
  async findTotal(
    input: { organizationId: string } & BillableEventsWindow,
  ): Promise<number> {
    const client = await this.resolveOrganizationClient(input.organizationId);
    const result = await client.query({
      query: `
        SELECT countDistinct(DeduplicationKeyHash) as total
        FROM billable_events
        WHERE OrganizationId = {organizationId:String}
          AND EventTimestamp >= {startDate:DateTime64(3)}
          AND EventTimestamp < {endDate:DateTime64(3)}
      `,
      query_params: {
        organizationId: input.organizationId,
        startDate: input.startDate,
        endDate: input.endDate,
      },
      format: "JSONEachRow",
    });
    return parseTotal(await result.json());
  }

  /**
   * Approximate distinct billable-event count (HyperLogLog, ~1% error,
   * constant memory) for the org in the window.
   */
  async findTotalUniq(
    input: { organizationId: string } & BillableEventsWindow,
  ): Promise<number> {
    const client = await this.resolveOrganizationClient(input.organizationId);
    const result = await client.query({
      query: `
        SELECT uniq(DeduplicationKeyHash) as total
        FROM billable_events
        WHERE OrganizationId = {organizationId:String}
          AND EventTimestamp >= {startDate:DateTime64(3)}
          AND EventTimestamp < {endDate:DateTime64(3)}
      `,
      query_params: {
        organizationId: input.organizationId,
        startDate: input.startDate,
        endDate: input.endDate,
      },
      format: "JSONEachRow",
    });
    return parseTotal(await result.json());
  }

  /**
   * Approximate distinct trace count (HyperLogLog) across the given
   * project ids in the window. The client routes off `tenantIds[0]` —
   * callers pass ids that all belong to the same org, so any of them
   * resolves the same ClickHouse instance.
   */
  async findTraceSummariesTotalUniq(
    input: { tenantIds: string[] } & BillableEventsWindow,
  ): Promise<number> {
    const client = await this.resolveClient(input.tenantIds[0]!);
    const result = await client.query({
      query: `
        SELECT uniq(TraceId) as total
        FROM trace_summaries
        WHERE TenantId IN {tenantIds:Array(String)}
          AND CreatedAt >= {startDate:DateTime64(3)}
          AND CreatedAt < {endDate:DateTime64(3)}
      `,
      query_params: {
        tenantIds: input.tenantIds,
        startDate: input.startDate,
        endDate: input.endDate,
      },
      format: "JSONEachRow",
    });
    return parseTotal(await result.json());
  }

  /**
   * Approximate per-project billable-event counts (HyperLogLog). Suitable
   * for limit checking and UI display, not for billing itself.
   */
  async findByProjectApprox(
    input: { organizationId: string } & BillableEventsWindow,
  ): Promise<Array<{ projectId: string; count: number }>> {
    const client = await this.resolveOrganizationClient(input.organizationId);
    const result = await client.query({
      query: `
        SELECT TenantId as projectId, uniq(DeduplicationKeyHash) as total
        FROM billable_events
        WHERE OrganizationId = {organizationId:String}
          AND EventTimestamp >= {startDate:DateTime64(3)}
          AND EventTimestamp < {endDate:DateTime64(3)}
        GROUP BY TenantId
      `,
      query_params: {
        organizationId: input.organizationId,
        startDate: input.startDate,
        endDate: input.endDate,
      },
      format: "JSONEachRow",
    });
    return parseByProject(await result.json());
  }

  /** Exact per-project billable-event counts for the org in the window. */
  async findByProject(
    input: { organizationId: string } & BillableEventsWindow,
  ): Promise<Array<{ projectId: string; count: number }>> {
    const client = await this.resolveOrganizationClient(input.organizationId);
    const result = await client.query({
      query: `
        SELECT TenantId as projectId, countDistinct(DeduplicationKeyHash) as total
        FROM billable_events
        WHERE OrganizationId = {organizationId:String}
          AND EventTimestamp >= {startDate:DateTime64(3)}
          AND EventTimestamp < {endDate:DateTime64(3)}
        GROUP BY TenantId
      `,
      query_params: {
        organizationId: input.organizationId,
        startDate: input.startDate,
        endDate: input.endDate,
      },
      format: "JSONEachRow",
    });
    return parseByProject(await result.json());
  }
}

function parseTotal(jsonResult: unknown): number {
  const rows = Array.isArray(jsonResult) ? jsonResult : [];
  const firstRow = rows[0] as { total: string } | undefined;
  return parseInt(firstRow?.total ?? "0", 10);
}

function parseByProject(
  jsonResult: unknown,
): Array<{ projectId: string; count: number }> {
  const rows = Array.isArray(jsonResult) ? jsonResult : [];
  return (rows as Array<{ projectId: string; total: string }>).map((row) => ({
    projectId: row.projectId,
    count: parseInt(row.total, 10),
  }));
}
