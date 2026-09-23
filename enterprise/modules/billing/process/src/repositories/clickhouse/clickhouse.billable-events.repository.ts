// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";

import {
  BillableEventsRepository,
  type BillableEventsWindow,
} from "../billable-events.repository.ts";

type TotalRow = { total: string | number };
type ProjectRow = { projectId: string; total: string | number };

/** ClickHouse reader for billing-month usage roll-ups. */
export class BillableEventsClickHouseRepository extends BillableEventsRepository {
  readonly #clickhouse: ClickHouseQueryClient;

  private constructor(clickhouse: ClickHouseQueryClient) {
    super();
    this.#clickhouse = clickhouse;
  }

  static create(clickhouse: ClickHouseQueryClient): BillableEventsClickHouseRepository {
    return new BillableEventsClickHouseRepository(clickhouse);
  }

  async findTotal(input: { organizationId: string } & BillableEventsWindow): Promise<number> {
    const result = await this.#organizationQuery<TotalRow>({
      organizationId: input.organizationId,
      startDate: input.startDate,
      endDate: input.endDate,
      sql: `
        SELECT countDistinct(DeduplicationKeyHash) as total
        FROM billable_events
        WHERE OrganizationId = {organizationId:String}
          AND EventTimestamp >= {startDate:DateTime64(3)}
          AND EventTimestamp < {endDate:DateTime64(3)}
      `,
    });

    return totalOf(result.rows);
  }

  /** Approximate in ClickHouse, unlike the deterministic exact memory twin. */
  async findTotalUniq(input: { organizationId: string } & BillableEventsWindow): Promise<number> {
    const result = await this.#organizationQuery<TotalRow>({
      organizationId: input.organizationId,
      startDate: input.startDate,
      endDate: input.endDate,
      sql: `
        SELECT uniq(DeduplicationKeyHash) as total
        FROM billable_events
        WHERE OrganizationId = {organizationId:String}
          AND EventTimestamp >= {startDate:DateTime64(3)}
          AND EventTimestamp < {endDate:DateTime64(3)}
      `,
    });

    return totalOf(result.rows);
  }

  async findTraceSummariesTotalUniq(
    input: { tenantIds: string[] } & BillableEventsWindow,
  ): Promise<number> {
    const tenantId = input.tenantIds[0];
    if (tenantId === undefined) return 0;

    const result = await this.#clickhouse.query<TotalRow>({
      tenantId,
      sql: `
        SELECT uniq(TraceId) as total
        FROM trace_summaries
        WHERE TenantId IN {tenantIds:Array(String)}
          AND CreatedAt >= {startDate:DateTime64(3)}
          AND CreatedAt < {endDate:DateTime64(3)}
      `,
      params: {
        tenantIds: input.tenantIds,
        startDate: input.startDate,
        endDate: input.endDate,
      },
      unscoped: {
        reason: "Billing trace roll-up spans the named projects of one organization.",
      },
    });

    return totalOf(result.rows);
  }

  async findByProjectApprox(
    input: { organizationId: string } & BillableEventsWindow,
  ): Promise<{ projectId: string; count: number }[]> {
    const result = await this.#organizationQuery<ProjectRow>({
      organizationId: input.organizationId,
      startDate: input.startDate,
      endDate: input.endDate,
      sql: `
        SELECT TenantId as projectId, uniq(DeduplicationKeyHash) as total
        FROM billable_events
        WHERE OrganizationId = {organizationId:String}
          AND EventTimestamp >= {startDate:DateTime64(3)}
          AND EventTimestamp < {endDate:DateTime64(3)}
        GROUP BY TenantId
      `,
    });

    return projectsOf(result.rows);
  }

  async findByProject(
    input: { organizationId: string } & BillableEventsWindow,
  ): Promise<{ projectId: string; count: number }[]> {
    const result = await this.#organizationQuery<ProjectRow>({
      organizationId: input.organizationId,
      startDate: input.startDate,
      endDate: input.endDate,
      sql: `
        SELECT TenantId as projectId, countDistinct(DeduplicationKeyHash) as total
        FROM billable_events
        WHERE OrganizationId = {organizationId:String}
          AND EventTimestamp >= {startDate:DateTime64(3)}
          AND EventTimestamp < {endDate:DateTime64(3)}
        GROUP BY TenantId
      `,
    });

    return projectsOf(result.rows);
  }

  #organizationQuery<Row>(input: {
    organizationId: string;
    startDate: string;
    endDate: string;
    sql: string;
  }) {
    return this.#clickhouse.query<Row>({
      tenantId: "",
      organizationId: input.organizationId,
      sql: input.sql,
      params: {
        organizationId: input.organizationId,
        startDate: input.startDate,
        endDate: input.endDate,
      },
      unscoped: {
        reason: "Organization-wide billing meter counts every project the organization owns.",
      },
    });
  }
}

function totalOf(rows: readonly TotalRow[]): number {
  return numberOf(rows[0]?.total);
}

function projectsOf(rows: readonly ProjectRow[]): { projectId: string; count: number }[] {
  return rows.map((row) => ({ projectId: row.projectId, count: numberOf(row.total) }));
}

function numberOf(value: string | number | undefined): number {
  return typeof value === "number" ? value : Number.parseInt(value ?? "0", 10);
}
