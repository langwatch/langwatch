// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * How far back the event log still reaches, per tenant (ADR-128 §9 step 4).
 *
 * A governance erasure deletes the money rows carrying an identifier and then
 * asks for those days to be rebuilt by replaying the events they were folded
 * from. ADR-022 makes the log's retention the ceiling on that: for a day whose
 * events have expired there is nothing left to replay, the delete is the whole
 * operation, and the day's total is permanently lower by the erased amount.
 * The erasure reports those days rather than pretending the totals are
 * unchanged, and this repository is what tells it which ones they are.
 *
 * It ASKS THE LOG rather than computing the boundary from the retention
 * policy, and the difference is not cosmetic. `_retention_days` is stamped on
 * each row from the policy in force when it was written, so a policy that has
 * since changed does not describe the rows already in the table; ClickHouse
 * applies a DELETE TTL lazily on merge, so rows past their nominal expiry
 * routinely survive; and the platform default is itself environment-dependent.
 * Every one of those makes a policy-derived boundary a prediction. The oldest
 * surviving event is an observation, and it is the only number that is true
 * about the table this replay will actually read.
 *
 * Spec: specs/governance/governance-data-retention.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:governance:event-log-horizon");

export class GovernanceEventLogHorizonClickHouseRepository {
  constructor(
    private readonly resolveClient: (
      tenantId: string,
    ) => Promise<ClickHouseClient>,
  ) {}

  /**
   * The oldest event still in the log for each tenant, as an instant.
   *
   * A tenant whose log holds nothing is absent from the result rather than
   * mapped to "now". An empty log alongside money rows that need rebuilding is
   * an anomaly, and the safe reading of an anomaly is that we cannot state a
   * horizon — so every day gets attempted, and a day that genuinely cannot be
   * replayed surfaces as a rebuild that changed nothing rather than as a day
   * written off unasked.
   *
   * Tenants are queried one at a time rather than through a single `IN` list,
   * for the reason `GovernanceRollupErasureClickHouseRepository` gives: the
   * resolver maps a tenant to its organization's ClickHouse instance, and an
   * organization on a dedicated instance would otherwise have one query aimed
   * at the wrong one.
   *
   * `EventOccurredAt` is epoch milliseconds and the table's partition key
   * (`toYearWeek`), so this is a min over the tenant's granules — `TenantId`
   * leads the sort key, which is what keeps the scan to them. Rows carrying
   * the unknown-time default of 0 are excluded: one of those would report the
   * horizon as 1970 and quietly make every day look replayable.
   */
  async oldestEventByTenant({
    tenantIds,
  }: {
    tenantIds: string[];
  }): Promise<Map<string, Date>> {
    const horizons = new Map<string, Date>();
    for (const tenantId of tenantIds) {
      try {
        const client = await this.resolveClient(tenantId);
        const result = await client.query({
          query: `
            SELECT min(EventOccurredAt) AS OldestOccurredAt
            FROM event_log
            WHERE TenantId = {tenantId:String}
              AND EventOccurredAt > 0
          `,
          query_params: { tenantId },
          format: "JSONEachRow",
        });
        const rows = (await result.json()) as Record<string, unknown>[];
        // ClickHouse renders UInt64 as a string in JSONEachRow, and min() over
        // an empty set returns 0 rather than no row at all.
        const oldest = Number(rows[0]?.OldestOccurredAt ?? 0);
        if (!Number.isFinite(oldest) || oldest <= 0) continue;
        horizons.set(tenantId, new Date(oldest));
      } catch (error) {
        // Swallowed on purpose, and only here. This query decides which days an
        // erasure REPORTS as unrebuildable; the deletion and the rebuild happen
        // either way. Leaving the tenant out of the result means every one of
        // its days is attempted, which is the same answer the caller reaches
        // when the log is empty — so a failed read costs a wider replay and a
        // warning, never a refused erasure.
        logger.warn(
          { error, tenantId },
          "Could not read how far back the event log reaches; every affected day will be attempted rather than written off",
        );
      }
    }
    return horizons;
  }
}
