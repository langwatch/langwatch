// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Every event LangWatch exports, built as an OCSF 1.9.0 API Activity (6003) event with the 1.9 AI
 * objects `ai_model`, `ai_agent` and `message_context`. Only names the published schema defines are
 * set; the cost and LangWatch's own ids sit under `unmapped.langwatch`. No prompt or response text.
 * Spec: enterprise/modules/governance/specs/ocsf-siem.feature
 */
import {
  OCSF_EXPORT_SCHEMA_VERSION,
  OCSF_PUSHED_SOURCE_TYPE,
  type GovernanceOcsfExportRow,
  type OcsfEvent,
} from "@langwatch/enterprise-governance-contract";
import type { TraceSummaryData } from "@langwatch/trace-contract";
import { z } from "zod";

const API_ACTIVITY_CLASS_UID = 6003;
const APPLICATION_ACTIVITY_CATEGORY_UID = 6;
/** OCSF 1.1 stored LLM calls as activity 6; 1.9 API Activity has no Invoke, so it is Other. */
const STORED_INVOKE_ACTIVITY = 6;
export const OTHER_ACTIVITY = 99;
/** The stored rows' severity codes (`ocsf-codes.rules.ts`) on the OCSF 1.9 scale. */
const STORED_SEVERITY_TO_OCSF: Record<number, number> = { 1: 1, 3: 2, 4: 3, 5: 4, 6: 5 };

const ACTIVITY_NAMES: Record<number, string> = {
  0: "Unknown",
  1: "Create",
  2: "Read",
  3: "Update",
  4: "Delete",
  99: "Other",
};

const SEVERITY_NAMES: Record<number, string> = {
  0: "Unknown",
  1: "Informational",
  2: "Low",
  3: "Medium",
  4: "High",
  5: "Critical",
  6: "Fatal",
  99: "Other",
};

/** What LangWatch knows about one action, before it is shaped as OCSF. */
type OcsfActivityFacts = {
  uid: string;
  timeMs: number;
  activityId: number;
  /** Overrides the caption, e.g. "Invoke" for an Other activity. */
  activityName?: string;
  severityId: number;
  operation: string;
  stream: "governance" | "traces" | "audit";
  organizationId: string;
  actor: { userUid?: string; email?: string; subjectUserUid?: string };
  endUserUid?: string;
  model?: { name: string; provider?: string };
  agent?: { name?: string; uid?: string };
  tokens?: { prompt?: number; completion?: number };
  conversationUid?: string;
  cost?: { usd?: number; amount?: string; currency?: string };
  resource?: { uid: string; name?: string; type?: string };
  failed?: boolean;
  message?: string;
  sourceEndpoint?: { ip?: string; userAgent?: string; name?: string };
  langwatch: Record<string, string | undefined>;
};

function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== ""),
  ) as Partial<T>;
}

/** A non-empty string, read as `.safeParse(value).data`: absent when the value is anything else. */
const presentText = z.string().min(1);
/** A finite number, or a numeric string as some pullers store it. */
const presentNumber = z.union([
  z.number().finite(),
  z
    .string()
    .regex(/^-?\d+(\.\d+)?$/)
    .transform(Number),
]);

/** `openai/gpt-5-mini` names its provider; a bare `gpt-5-mini` leaves the provider to the caller. */
function splitModel(model: string): { name: string; provider?: string } {
  const slash = model.indexOf("/");
  if (slash <= 0 || slash === model.length - 1) return { name: model };
  return { provider: model.slice(0, slash), name: model.slice(slash + 1) };
}

function statusFields(failed: boolean | undefined): { status_id: number; status: string } {
  if (failed === undefined) return { status_id: 0, status: "Unknown" };
  return failed ? { status_id: 2, status: "Failure" } : { status_id: 1, status: "Success" };
}

/** The actor's user when LangWatch knows one; an event with no known user keeps an empty actor. */
function actorFields(actor: OcsfActivityFacts["actor"]): Record<string, unknown> {
  const user = compact({ uid: actor.userUid, email_addr: actor.email });
  return Object.keys(user).length > 0 ? { user } : {};
}

/** The OCSF 1.9 AI objects: `ai_model`, `ai_agent` and `message_context`. */
function aiFields(facts: OcsfActivityFacts): Record<string, unknown> {
  const prompt = facts.tokens?.prompt;
  const completion = facts.tokens?.completion;
  const hasTokens = prompt !== undefined || completion !== undefined;
  const agent = compact({ name: facts.agent?.name, uid: facts.agent?.uid });
  const context = compact({
    uid: facts.conversationUid,
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: hasTokens ? (prompt ?? 0) + (completion ?? 0) : undefined,
  });
  return compact({
    ai_model: facts.model
      ? { name: facts.model.name, ai_provider: facts.model.provider ?? "Unknown" }
      : undefined,
    ai_agent: Object.keys(agent).length > 0 ? agent : undefined,
    message_context: Object.keys(context).length > 0 ? context : undefined,
  });
}

function unmappedFields(facts: OcsfActivityFacts): Record<string, unknown> {
  const subject = facts.actor.subjectUserUid;
  return compact({
    ...facts.langwatch,
    end_user_uid: facts.endUserUid,
    impersonated_user_uid: subject && subject !== facts.actor.userUid ? subject : undefined,
    cost_usd: facts.cost?.usd,
    cost_amount: facts.cost?.amount,
    cost_currency: facts.cost?.currency,
  });
}

/** One OCSF 1.9.0 API Activity event from what LangWatch knows about the action. */
export function toOcsfApiActivity(facts: OcsfActivityFacts): OcsfEvent {
  const activityId = facts.activityId in ACTIVITY_NAMES ? facts.activityId : OTHER_ACTIVITY;
  const activityName = facts.activityName ?? ACTIVITY_NAMES[activityId] ?? "Other";
  const severityId = facts.severityId in SEVERITY_NAMES ? facts.severityId : 0;
  const userAgent = facts.sourceEndpoint?.userAgent;

  return compact({
    class_uid: API_ACTIVITY_CLASS_UID,
    class_name: "API Activity",
    category_uid: APPLICATION_ACTIVITY_CATEGORY_UID,
    category_name: "Application Activity",
    activity_id: activityId,
    activity_name: activityName,
    type_uid: API_ACTIVITY_CLASS_UID * 100 + activityId,
    type_name: `API Activity: ${activityName}`,
    severity_id: severityId,
    severity: SEVERITY_NAMES[severityId],
    time: facts.timeMs,
    ...statusFields(facts.failed),
    message: facts.message,
    actor: actorFields(facts.actor),
    api: { operation: facts.operation, service: { name: "LangWatch" } },
    src_endpoint: compact({ ip: facts.sourceEndpoint?.ip, name: facts.sourceEndpoint?.name }),
    http_request: userAgent ? { user_agent: userAgent } : undefined,
    cloud: { provider: facts.model?.provider ?? "LangWatch" },
    osint: [],
    ...aiFields(facts),
    resources: facts.resource ? [compact({ ...facts.resource })] : undefined,
    metadata: compact({
      version: OCSF_EXPORT_SCHEMA_VERSION,
      uid: facts.uid,
      product: { name: "LangWatch", vendor_name: "LangWatch" },
      tenant_uid: facts.organizationId,
      log_name: facts.stream,
      correlation_uid: facts.conversationUid,
    }),
    unmapped: { langwatch: unmappedFields(facts) },
  });
}

function parseObject(json: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function recordAt(value: unknown, key: string): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  const found = (value as Record<string, unknown>)[key];
  return found && typeof found === "object" && !Array.isArray(found)
    ? (found as Record<string, unknown>)
    : {};
}

/**
 * A row of `governance_ocsf_events` as a 1.9.0 event. An event pushed in from another source is
 * returned as it was received; LangWatch's own rows are rebuilt from their columns and the facts
 * their stored payload's `metadata.extension` carries.
 */
export function governanceRowToOcsfEvent({
  row,
  organizationId,
}: {
  row: GovernanceOcsfExportRow;
  organizationId: string;
}): OcsfEvent {
  const raw = parseObject(row.rawOcsfJson);
  if (row.sourceType === OCSF_PUSHED_SOURCE_TYPE) return raw;

  const extension = recordAt(raw.metadata, "extension");
  const invoke = row.activityId === STORED_INVOKE_ACTIVITY;
  const text = (key: string) => presentText.safeParse(extension[key]).data;
  const number = (key: string) => presentNumber.safeParse(extension[key]).data;
  const modelName =
    text("model") ?? (invoke ? presentText.safeParse(row.targetName).data : undefined);
  const model = modelName ? splitModel(modelName) : undefined;
  const provider = text("provider") ?? model?.provider;
  const prompt = number("tokens_input");
  const completion = number("tokens_output");

  return toOcsfApiActivity({
    uid: row.eventId,
    timeMs: row.eventTimeMs,
    activityId: invoke ? OTHER_ACTIVITY : row.activityId,
    ...(invoke ? { activityName: "Invoke" } : {}),
    severityId: STORED_SEVERITY_TO_OCSF[row.severityId] ?? 0,
    operation: row.actionName,
    stream: "governance",
    organizationId,
    actor: { userUid: row.actorUserId, email: row.actorEmail },
    endUserUid: row.actorEnduserId,
    ...(model ? { model: { name: model.name, ...(provider ? { provider } : {}) } } : {}),
    agent: { name: text("agent_name"), uid: text("agent_id") },
    ...(prompt !== undefined || completion !== undefined ? { tokens: { prompt, completion } } : {}),
    conversationUid: row.traceId,
    cost: { usd: number("cost_usd"), amount: text("cost_amount"), currency: text("cost_currency") },
    ...(!invoke && row.sourceId
      ? { resource: { uid: row.sourceId, name: row.targetName, type: row.sourceType } }
      : {}),
    sourceEndpoint: { name: row.sourceType },
    langwatch: {
      source_type: row.sourceType,
      source_id: row.sourceId,
      trace_id: row.traceId,
      anomaly_alert_id: row.anomalyAlertId,
      stored_ocsf_version: row.ocsfSchemaVersion,
    },
  });
}

/** The trace summary fields a project trace's event is built from. */
export type ProjectTraceSummary = Pick<
  TraceSummaryData,
  | "traceId"
  | "occurredAt"
  | "totalCost"
  | "totalPromptTokenCount"
  | "totalCompletionTokenCount"
  | "models"
  | "attributes"
  | "containsErrorStatus"
  | "traceName"
>;

/** One trace of a project as an Other activity named Invoke, one event per trace. */
export function projectTraceToOcsfEvent({
  summary,
  projectId,
  organizationId,
}: {
  summary: ProjectTraceSummary;
  projectId: string;
  organizationId: string;
}): OcsfEvent {
  const { attributes } = summary;
  const modelName = attributes["gen_ai.request.model"] || summary.models[0];
  const model = modelName ? splitModel(modelName) : undefined;
  const provider =
    attributes["gen_ai.provider.name"] || attributes["gen_ai.system"] || model?.provider;
  const prompt = summary.totalPromptTokenCount ?? undefined;
  const completion = summary.totalCompletionTokenCount ?? undefined;

  return toOcsfApiActivity({
    uid: `trace:${projectId}:${summary.traceId}`,
    timeMs: summary.occurredAt,
    activityId: OTHER_ACTIVITY,
    activityName: "Invoke",
    severityId: 1,
    operation: attributes["gen_ai.operation.name"] || summary.traceName || "trace",
    stream: "traces",
    organizationId,
    actor: {
      userUid: attributes["user.id"] || attributes["langwatch.user_id"],
      email: attributes["user.email"],
    },
    endUserUid: attributes["enduser.id"],
    ...(model ? { model: { name: model.name, ...(provider ? { provider } : {}) } } : {}),
    agent: {
      name: attributes["gen_ai.agent.name"],
      uid: attributes["gen_ai.agent.id"],
    },
    ...(prompt !== undefined || completion !== undefined ? { tokens: { prompt, completion } } : {}),
    conversationUid: summary.traceId,
    cost: { usd: summary.totalCost ?? undefined },
    failed: summary.containsErrorStatus,
    langwatch: { project_id: projectId, trace_id: summary.traceId },
  });
}
