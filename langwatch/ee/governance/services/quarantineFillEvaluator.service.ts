// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * QuarantineFillEvaluator — observability surface for the hidden
 * Governance Project soft quarantine.
 *
 * The hidden Gov project is the destination for every IngestionSource
 * trace (push or pull mode). Members can't read it (Layer-1 governance
 * filter strips its rows from member-facing reads); admins read via
 * `governance:view`. Quarantine "fills" — high spans/min landing in
 * the project — almost always indicate a misconfigured ingest source
 * (a puller that's stuck in a tight loop, an OTel collector batch
 * exporter pointed at the wrong endpoint, an admin who copied an
 * ingest URL into a high-volume customer integration without realising
 * it's a 1:1 with the org's quarantine).
 *
 * This service exposes the CURRENT fill rate. It deliberately does
 * NOT auto-fire OCSF events on threshold crossings — the admin UI
 * polls this on `/governance` and surfaces a warning Alert when the
 * rate is elevated. A scheduled OCSF emission worker is a follow-up
 * once the admin UI is in place + we have signal on the right
 * threshold from production data.
 *
 * Why poll vs. push: the spec's "Alert renders on /governance for
 * org admins" is satisfied by either path, and polling avoids the
 * dedup / re-fire-on-next-window state-machine complexity until
 * we know the threshold is well-tuned. SOC2 / ISO27001 review
 * artifact (admin warning fires on misconfigured ingest) holds
 * regardless of push vs. pull as long as the warning IS visible
 * to admin.
 *
 * Spec: specs/ai-gateway/governance/ingestion-attribution.feature
 *       §"Admin warning fires when quarantine fill rate exceeds threshold"
 */
import type { ClickHouseClient } from "@clickhouse/client";
import type { PrismaClient } from "@prisma/client";

import { getClickHouseClientForOrganization } from "~/server/clickhouse/clickhouseClient";
import { createLogger } from "~/utils/logger/server";

import {
  GOVERNANCE_ATTR,
  GOVERNANCE_ORIGIN_KIND_VALUE,
} from "./governanceAttributeKeys";
import { ensureHiddenGovernanceProject } from "./governanceProject.service";

const logger = createLogger(
  "langwatch:governance:quarantine-fill-evaluator",
);

/**
 * Default sliding-window length for rate computation. 60 seconds
 * matches the spec's "spans/min" framing. Callers can override
 * (e.g. to compute a 5-minute average for trend display).
 */
export const QUARANTINE_DEFAULT_WINDOW_SECONDS = 60;

/**
 * Default threshold for the "exceeded" flag. Tuned to be safely
 * above quiescent traffic — a healthy small org running one
 * IngestionSource produces single-digit spans/min, and a busy
 * production org produces hundreds. Misconfigured pullers loop
 * thousands of identical spans/sec. 100 spans/min is the rough
 * dividing line; the admin UI surfaces a warning Alert when the
 * computed rate is at-or-above this.
 *
 * Override via the `threshold` option per call. A future tRPC
 * mutation can persist a per-org override on Organization.
 */
export const QUARANTINE_DEFAULT_THRESHOLD = 100;

export interface QuarantineFillStats {
  /** Window length used for the rate computation, in seconds. */
  windowSeconds: number;
  /** Threshold compared against `rate` to set `exceeded`. */
  threshold: number;
  /** Total span count from governance traffic in the window. */
  spanCount: number;
  /** spans / minute (60 / windowSeconds * spanCount). */
  rate: number;
  /** True iff `rate >= threshold`. */
  exceeded: boolean;
  /**
   * Per-source span counts for the window. The admin UI surfaces
   * these so the admin can pin which source is misconfigured
   * without separate drill-down. Empty when `spanCount === 0`.
   */
  perSource: Array<{ ingestionSourceId: string; spanCount: number }>;
}

export interface QuarantineFillEvaluatorDeps {
  prisma: PrismaClient;
  clickHouseClient?: ClickHouseClient;
}

export class QuarantineFillEvaluator {
  constructor(private readonly deps: QuarantineFillEvaluatorDeps) {}

  static create(deps: QuarantineFillEvaluatorDeps): QuarantineFillEvaluator {
    return new QuarantineFillEvaluator(deps);
  }

  /**
   * Compute the current quarantine-fill rate for an org. Reads the
   * last `windowSeconds` of `trace_summaries` rows whose origin is
   * an IngestionSource, scoped to the org's hidden Gov project.
   *
   * `exceeded` is purely advisory — callers decide whether to
   * surface a warning Alert or persist an OCSF event. The default
   * threshold is calibrated to fire on misconfigured pullers, not
   * busy-but-healthy traffic.
   */
  async evaluate({
    organizationId,
    windowSeconds = QUARANTINE_DEFAULT_WINDOW_SECONDS,
    threshold = QUARANTINE_DEFAULT_THRESHOLD,
  }: {
    organizationId: string;
    windowSeconds?: number;
    threshold?: number;
  }): Promise<QuarantineFillStats> {
    const govProject = await ensureHiddenGovernanceProject(
      this.deps.prisma,
      organizationId,
    );
    const tenantId = govProject.id;

    const ch =
      this.deps.clickHouseClient ??
      (await getClickHouseClientForOrganization(organizationId));

    const since = Date.now() - windowSeconds * 1000;

    try {
      const result = await ch.query({
        query: `
          SELECT
            ts.Attributes[{sourceIdKey:String}] AS sourceId,
            count() AS spanCount
          FROM trace_summaries ts
          WHERE ts.TenantId = {tenantId:String}
            AND ts.OccurredAt >= fromUnixTimestamp64Milli({since:UInt64})
            AND ts.Attributes[{originKey:String}] = {originValue:String}
          GROUP BY sourceId
          ORDER BY spanCount DESC
        `,
        query_params: {
          tenantId,
          since,
          originKey: GOVERNANCE_ATTR.ORIGIN_KIND,
          originValue: GOVERNANCE_ORIGIN_KIND_VALUE,
          sourceIdKey: GOVERNANCE_ATTR.INGESTION_SOURCE_ID,
        },
        format: "JSONEachRow",
      });
      const rows = (await result.json()) as Array<{
        sourceId: string;
        spanCount: number | string;
      }>;

      const perSource = rows
        .filter((r) => r.sourceId)
        .map((r) => ({
          ingestionSourceId: r.sourceId,
          spanCount: Number(r.spanCount ?? 0),
        }));

      const spanCount = perSource.reduce((sum, r) => sum + r.spanCount, 0);
      const rate = (spanCount * 60) / Math.max(1, windowSeconds);

      return {
        windowSeconds,
        threshold,
        spanCount,
        rate,
        exceeded: rate >= threshold,
        perSource,
      };
    } catch (error) {
      logger.warn(
        {
          organizationId,
          tenantId,
          windowSeconds,
          error,
        },
        "quarantine fill evaluation failed — returning empty stats",
      );
      // Fail-safe: an evaluation error shouldn't break the admin
      // dashboard. Surface zero rate + empty perSource; the admin
      // UI will simply show "no quarantine activity in window".
      return {
        windowSeconds,
        threshold,
        spanCount: 0,
        rate: 0,
        exceeded: false,
        perSource: [],
      };
    }
  }
}
