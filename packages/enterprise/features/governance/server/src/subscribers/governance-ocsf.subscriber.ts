import {
  GOVERNANCE_ATTR,
  isGovernanceOriginTrace,
} from "@langwatch/enterprise-governance-contract";
import {
  GovernanceOcsfEventPort,
  GovernanceSubscriberDiagnosticsPort,
  type GovernanceOcsfEvent,
  type GovernanceTraceContext,
  type GovernanceTraceEvent,
} from "../ports/governance-subscriber.port";

export const GOVERNANCE_OCSF_EVENTS_SYNC_WINDOW_MS = 30_000;
export const GOVERNANCE_OCSF_INVOKE_ACTIVITY_ID = 6;
export const GOVERNANCE_OCSF_INFO_SEVERITY_ID = 1;
export const GOVERNANCE_OCSF_MEDIUM_SEVERITY_ID = 4;

export class GovernanceOcsfSubscriber {
  private constructor(
    private readonly events: GovernanceOcsfEventPort,
    private readonly diagnostics: GovernanceSubscriberDiagnosticsPort,
  ) {}

  static create(options: {
    events: GovernanceOcsfEventPort;
    diagnostics: GovernanceSubscriberDiagnosticsPort;
  }): GovernanceOcsfSubscriber {
    return new GovernanceOcsfSubscriber(options.events, options.diagnostics);
  }

  when(_event: GovernanceTraceEvent, context: GovernanceTraceContext): boolean {
    return isGovernanceOriginTrace(context.state.attributes);
  }

  async handle(
    _event: GovernanceTraceEvent,
    context: GovernanceTraceContext,
  ): Promise<void> {
    const row = this.row(context);
    if (!row) return;
    try {
      await this.events.insertEvent(row);
    } catch (error) {
      this.diagnostics.capture(error);
    }
  }

  private row(
    context: GovernanceTraceContext,
  ): GovernanceOcsfEvent | undefined {
    const { tenantId, state } = context;
    if (!isGovernanceOriginTrace(state.attributes)) return undefined;
    const sourceId = state.attributes[GOVERNANCE_ATTR.INGESTION_SOURCE_ID];
    if (!sourceId) {
      this.diagnostics.warn({
        code: "governance_ocsf_missing_source_id",
        tenantId,
        traceId: state.traceId,
      });
      return undefined;
    }
    if (state.occurredAt <= 0) return undefined;

    const sourceType =
      state.attributes[GOVERNANCE_ATTR.INGESTION_SOURCE_TYPE] ?? "unknown";
    const actorUserId = state.attributes[GOVERNANCE_ATTR.USER_ID] ?? "";
    const actorEmail = state.attributes["user.email"] ?? "";
    const actorEnduserId = state.attributes["enduser.id"] ?? "";
    const actionName = state.attributes["tool.name"] ?? "trace.recorded";
    const targetName =
      state.attributes["gen_ai.request.model"] ?? state.models[0] ?? "";
    const anomalyAlertId =
      state.attributes[GOVERNANCE_ATTR.ANOMALY_ALERT_ID] ?? "";
    const severityId = anomalyAlertId
      ? GOVERNANCE_OCSF_MEDIUM_SEVERITY_ID
      : GOVERNANCE_OCSF_INFO_SEVERITY_ID;
    const rawOcsfJson = JSON.stringify({
      class_uid: 6003,
      category_uid: 6,
      activity_id: GOVERNANCE_OCSF_INVOKE_ACTIVITY_ID,
      type_uid: 6003 * 100 + GOVERNANCE_OCSF_INVOKE_ACTIVITY_ID,
      severity_id: severityId,
      time: state.occurredAt,
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
          trace_id: state.traceId,
          anomaly_alert_id: anomalyAlertId || undefined,
        },
      },
    });

    return {
      tenantId,
      eventId: state.traceId,
      traceId: state.traceId,
      sourceId,
      sourceType,
      activityId: GOVERNANCE_OCSF_INVOKE_ACTIVITY_ID,
      severityId,
      eventTime: new Date(state.occurredAt),
      actorUserId,
      actorEmail,
      actorEnduserId,
      actionName,
      targetName,
      anomalyAlertId,
      rawOcsfJson,
    };
  }
}
