// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  GOVERNANCE_ATTR,
  isGovernanceOriginTrace,
} from "@langwatch/enterprise-governance-contract";
import { Temporal } from "@langwatch/time";

import {
  type GovernanceDiagnosticsSink,
  type GovernanceKpiContribution,
  type GovernanceKpiContributionWriter,
  type GovernanceOcsfEvent,
  type GovernanceOcsfEventWriter,
  type GovernanceTraceSummary,
  OCSF_ACTIVITY,
  OCSF_SEVERITY,
} from "../app/governance.members.ts";
import { ocsfActorFields } from "../rules/ocsf-pull-event-mapping.rules.ts";

const HOUR_MS = 60 * 60 * 1_000;

type GovernanceTraceRows =
  | { kind: "rows"; kpi: GovernanceKpiContribution; ocsf: GovernanceOcsfEvent }
  | { kind: "skipped"; reason: "not_governance" | "missing_source_id" | "no_occurred_at" };

/**
 * Main's `governanceKpisSync` and `governanceOcsfEventsSync` rows, one of each per governance-origin
 * trace, written from its summary. Both tables replace by key, so writing a trace again is safe.
 * A failed write throws so the caller re-drives it. @see specs/ai-gateway/governance/folds.feature
 */
export class GovernanceTraceFactsService {
  private constructor(
    private readonly kpis: GovernanceKpiContributionWriter,
    private readonly ocsf: GovernanceOcsfEventWriter,
    private readonly diagnostics: GovernanceDiagnosticsSink,
  ) {}

  static create(options: {
    kpis: GovernanceKpiContributionWriter;
    ocsf: GovernanceOcsfEventWriter;
    diagnostics: GovernanceDiagnosticsSink;
  }): GovernanceTraceFactsService {
    return new GovernanceTraceFactsService(options.kpis, options.ocsf, options.diagnostics);
  }

  async record({
    tenantId,
    summaries,
  }: {
    tenantId: string;
    summaries: readonly GovernanceTraceSummary[];
  }): Promise<{ written: number }> {
    let written = 0;
    for (const summary of summaries) {
      const rows = governanceTraceRows({ tenantId, summary });
      if (rows.kind === "skipped") {
        if (rows.reason === "missing_source_id") {
          this.diagnostics.warn("governance trace missing langwatch.ingestion_source.id", {
            tenantId,
            traceId: summary.traceId,
          });
        }
        continue;
      }
      await this.kpis.insertContribution(rows.kpi);
      await this.ocsf.insertEvent(rows.ocsf);
      written += 1;
    }
    return { written };
  }
}

/** A trace that is not governance-origin, names no source or has no moment writes nothing. */
function governanceTraceRows({
  tenantId,
  summary,
}: {
  tenantId: string;
  summary: GovernanceTraceSummary;
}): GovernanceTraceRows {
  if (!isGovernanceOriginTrace(summary.attributes)) {
    return { kind: "skipped", reason: "not_governance" };
  }
  const sourceId = summary.attributes[GOVERNANCE_ATTR.INGESTION_SOURCE_ID];
  if (!sourceId) return { kind: "skipped", reason: "missing_source_id" };
  if (!summary.occurredAt || summary.occurredAt <= 0) {
    return { kind: "skipped", reason: "no_occurred_at" };
  }
  const sourceType = summary.attributes[GOVERNANCE_ATTR.INGESTION_SOURCE_TYPE] ?? "unknown";
  return {
    kind: "rows",
    kpi: kpiContribution({ tenantId, summary, sourceId, sourceType }),
    ocsf: ocsfEvent({ tenantId, summary, sourceId, sourceType }),
  };
}

type RowInput = {
  tenantId: string;
  summary: GovernanceTraceSummary;
  sourceId: string;
  sourceType: string;
};

/** One row per (tenant, source, hour, trace), carrying the trace's running totals. */
function kpiContribution({
  tenantId,
  summary,
  sourceId,
  sourceType,
}: RowInput): GovernanceKpiContribution {
  return {
    tenantId,
    sourceId,
    sourceType,
    hourBucket: Temporal.Instant.fromEpochMilliseconds(
      Math.floor(summary.occurredAt / HOUR_MS) * HOUR_MS,
    ),
    traceId: summary.traceId,
    spendUsd: summary.totalCost ?? 0,
    promptTokens: summary.totalPromptTokenCount ?? 0,
    completionTokens: summary.totalCompletionTokenCount ?? 0,
    lastEventOccurredAt: Temporal.Instant.fromEpochMilliseconds(summary.occurredAt),
  };
}

/** One OCSF v1.1 API Activity row per trace; an email-shaped `user.email` is placed as main placed it. */
function ocsfEvent({ tenantId, summary, sourceId, sourceType }: RowInput): GovernanceOcsfEvent {
  const { attributes } = summary;
  const placedEmail = ocsfActorFields(attributes["user.email"] ?? "");
  const actorUserId = (attributes[GOVERNANCE_ATTR.USER_ID] ?? "") || placedEmail.actorUserId;
  const actorEmail = placedEmail.actorEmail;
  const actorEnduserId = attributes["enduser.id"] ?? "";
  const actionName = attributes["tool.name"] ?? "trace.recorded";
  const targetName = attributes["gen_ai.request.model"] ?? summary.models[0] ?? "";
  const anomalyAlertId = attributes[GOVERNANCE_ATTR.ANOMALY_ALERT_ID] ?? "";
  const severityId = anomalyAlertId ? OCSF_SEVERITY.MEDIUM : OCSF_SEVERITY.INFO;
  const rawOcsfJson = JSON.stringify({
    class_uid: 6003,
    category_uid: 6,
    activity_id: OCSF_ACTIVITY.INVOKE,
    type_uid: 6003 * 100 + OCSF_ACTIVITY.INVOKE,
    severity_id: severityId,
    time: summary.occurredAt,
    actor: {
      user: { uid: actorUserId, email_addr: actorEmail },
      enduser: { uid: actorEnduserId },
    },
    api: { operation: actionName },
    dst_endpoint: { name: targetName },
    metadata: {
      product: { name: "LangWatch", vendor_name: "LangWatch" },
      extension: {
        uid: "langwatch.governance",
        source_type: sourceType,
        source_id: sourceId,
        trace_id: summary.traceId,
        anomaly_alert_id: anomalyAlertId || undefined,
      },
    },
  });
  return {
    tenantId,
    eventId: summary.traceId,
    traceId: summary.traceId,
    sourceId,
    sourceType,
    activityId: OCSF_ACTIVITY.INVOKE,
    severityId,
    eventTime: Temporal.Instant.fromEpochMilliseconds(summary.occurredAt),
    actorUserId,
    actorEmail,
    actorEnduserId,
    actionName,
    targetName,
    anomalyAlertId,
    rawOcsfJson,
  };
}
