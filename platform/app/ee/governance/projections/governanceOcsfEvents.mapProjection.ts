// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * `governance_ocsf_events` as a derived-state map (ADR-107 decision 17,
 * pre-built): one OCSF v1.1 audit row per governance span, keyed by the span
 * id so a rebuild reproduces the live row exactly.
 */

import {
  type GovernanceOcsfEventInput,
  OCSF_ACTIVITY,
  OCSF_SEVERITY,
} from "@ee/governance/services/governanceOcsfEvents.clickhouse.repository";
import type {
  AppendStore,
  BuiltMap,
  WireEvent,
} from "@langwatch/event-sourcing";
import { ATTR_KEYS } from "~/server/app-layer/traces/canonicalisation/extractors/_constants";
import type { CanonicalSpan } from "~/server/event-sourcing/trace-processing/schema";
import { GOVERNANCE_ATTR } from "../services/governanceAttributeKeys";
import { readGovernanceSpanFacts } from "./governanceSpanFacts";

const OCSF_CLASS_API_ACTIVITY = 6003;
const OCSF_CATEGORY_APPLICATION_ACTIVITY = 6;

const ACTOR_USER_ID_KEYS = [
  ATTR_KEYS.LANGWATCH_USER_ID,
  ATTR_KEYS.LANGWATCH_USER_ID_LEGACY,
] as const;
const ATTR_USER_EMAIL = "user.email";
const ATTR_ENDUSER_ID = "enduser.id";
const ATTR_TOOL_NAME = "tool.name";
const ACTION_FALLBACK = "trace.recorded";

function stringAttr(
  attrs: Readonly<Record<string, unknown>>,
  key: string,
): string {
  const value = attrs[key];
  return typeof value === "string" ? value : "";
}

function firstStringAttr(
  attrs: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): string {
  for (const key of keys) {
    const value = stringAttr(attrs, key);
    if (value) return value;
  }
  return "";
}

/** PURE and TOTAL over the span: no clock, no random, no I/O. */
export function deriveGovernanceOcsfEvent({
  tenantId,
  span,
}: {
  tenantId: string;
  span: CanonicalSpan;
}): GovernanceOcsfEventInput | null {
  const facts = readGovernanceSpanFacts(span);
  if (!facts) return null;

  const actorUserId = firstStringAttr(span.attributes, ACTOR_USER_ID_KEYS);
  const actorEmail = stringAttr(span.attributes, ATTR_USER_EMAIL);
  const actorEnduserId = stringAttr(span.attributes, ATTR_ENDUSER_ID);

  const actionName =
    stringAttr(span.attributes, ATTR_TOOL_NAME) || span.name || ACTION_FALLBACK;
  const targetName =
    stringAttr(span.attributes, ATTR_KEYS.GEN_AI_REQUEST_MODEL) ||
    span.model ||
    "";

  const anomalyAlertId = stringAttr(
    span.attributes,
    GOVERNANCE_ATTR.ANOMALY_ALERT_ID,
  );
  const severityId = anomalyAlertId ? OCSF_SEVERITY.MEDIUM : OCSF_SEVERITY.INFO;

  const rawOcsfJson = JSON.stringify({
    class_uid: OCSF_CLASS_API_ACTIVITY,
    category_uid: OCSF_CATEGORY_APPLICATION_ACTIVITY,
    activity_id: OCSF_ACTIVITY.INVOKE,
    type_uid: OCSF_CLASS_API_ACTIVITY * 100 + OCSF_ACTIVITY.INVOKE,
    severity_id: severityId,
    time: facts.eventTimeMs,
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
        source_type: facts.sourceType,
        source_id: facts.sourceId,
        trace_id: facts.traceId,
        span_id: facts.eventId,
        anomaly_alert_id: anomalyAlertId || undefined,
      },
    },
  });

  return {
    tenantId,
    eventId: facts.eventId,
    traceId: facts.traceId,
    sourceId: facts.sourceId,
    sourceType: facts.sourceType,
    activityId: OCSF_ACTIVITY.INVOKE,
    severityId,
    eventTime: new Date(facts.eventTimeMs),
    actorUserId,
    actorEmail,
    actorEnduserId,
    actionName,
    targetName,
    anomalyAlertId,
    rawOcsfJson,
  };
}

export function createGovernanceOcsfEventsMap(deps: {
  store: AppendStore<GovernanceOcsfEventInput>;
}): BuiltMap {
  return {
    name: "governanceOcsfEvents",
    eventTypes: ["lw.obs.trace.span_received"],
    async apply(delivery) {
      const records: GovernanceOcsfEventInput[] = [];
      for (const event of delivery.events as readonly WireEvent[]) {
        const span = event.data as CanonicalSpan;
        const record = deriveGovernanceOcsfEvent({
          tenantId: span.tenantId,
          span,
        });
        if (record) records.push(record);
      }
      if (records.length === 0) return { written: 0 };
      await deps.store.writeBatch(records, {
        tenantId: delivery.tenantId,
        retentionDays: delivery.retentionDays,
      });
      return { written: records.length };
    },
  };
}
