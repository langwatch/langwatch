import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { Temporal, toDate, toEpochMs } from "@langwatch/time";

import {
  BillableEventsMeterRepository,
  type BillableEventRecord,
  type MeterWindow,
  type ProjectMeterCount,
} from "../billable-events-meter.repository.ts";

const TABLE_NAME = "billable_events" as const;

type TotalRow = { total: string | number };
type ProjectRow = { projectId: string; total: string | number };

/** ClickHouse twin of the meter, moved from billing under the same table and row shape. */
export class BillableEventsMeterClickHouseRepository extends BillableEventsMeterRepository {
  readonly #clickhouse: ClickHouseQueryClient;

  private constructor(clickhouse: ClickHouseQueryClient) {
    super();
    this.#clickhouse = clickhouse;
  }

  static create(clickhouse: ClickHouseQueryClient): BillableEventsMeterClickHouseRepository {
    return new BillableEventsMeterClickHouseRepository(clickhouse);
  }

  async insert({
    record,
    organizationId,
  }: {
    record: BillableEventRecord;
    organizationId: string;
  }): Promise<void> {
    await this.#clickhouse.insert({
      tenantId: record.tenantId,
      organizationId,
      table: TABLE_NAME,
      rows: [
        {
          OrganizationId: organizationId,
          TenantId: record.tenantId,
          EventId: record.eventId,
          EventType: record.eventType,
          DeduplicationKey: record.deduplicationKey,
          EventTimestamp: toDate(
            Temporal.Instant.fromEpochMilliseconds(toEpochMs(record.eventTimestamp)),
          ),
        },
      ],
      settings: { async_insert: 1, wait_for_async_insert: 1 },
    });
  }

  async findTotal(input: { organizationId: string } & MeterWindow): Promise<number> {
    const result = await this.#clickhouse.query<TotalRow>({
      tenantId: "",
      organizationId: input.organizationId,
      sql: `
        SELECT countDistinct(DeduplicationKeyHash) as total
        FROM ${TABLE_NAME}
        WHERE OrganizationId = {organizationId:String}
          AND EventTimestamp >= {startDate:DateTime64(3)}
          AND EventTimestamp < {endDate:DateTime64(3)}
      `,
      params: {
        organizationId: input.organizationId,
        startDate: input.startDate,
        endDate: input.endDate,
      },
      // The organization's meter counts every project the organization owns.
      SKIP_TENANT_CHECK: true,
    });
    return numberOf(result.rows[0]?.total);
  }

  /** Billing's former `findByProjectApprox`, kept `uniq` so enforcement's numbers do not move. */
  async countByProjects(input: {
    organizationId: string;
    projectIds: readonly string[];
    window: MeterWindow;
  }): Promise<ProjectMeterCount[]> {
    const result = await this.#clickhouse.query<ProjectRow>({
      tenantId: "",
      organizationId: input.organizationId,
      sql: `
        SELECT TenantId as projectId, uniq(DeduplicationKeyHash) as total
        FROM ${TABLE_NAME}
        WHERE OrganizationId = {organizationId:String}
          AND TenantId IN {projectIds:Array(String)}
          AND EventTimestamp >= {startDate:DateTime64(3)}
          AND EventTimestamp < {endDate:DateTime64(3)}
        GROUP BY TenantId
      `,
      params: {
        organizationId: input.organizationId,
        projectIds: [...input.projectIds],
        startDate: input.window.startDate,
        endDate: input.window.endDate,
      },
      // The organization's meter counts every project the organization owns.
      SKIP_TENANT_CHECK: true,
    });
    return result.rows.map((row) => ({ projectId: row.projectId, count: numberOf(row.total) }));
  }
}

function numberOf(value: string | number | undefined): number {
  return typeof value === "number" ? value : Number.parseInt(value ?? "0", 10);
}
