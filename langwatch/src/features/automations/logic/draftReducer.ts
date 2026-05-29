import { AlertType, TriggerAction } from "@prisma/client";
import type { FilterField, FilterParam } from "~/hooks/useFilterParams";
import type { FieldDraft } from "../editors/templateAuthoring";

/**
 * Pure state machine for the staged automation drawer (ADR-028). Lives outside
 * any React component so it can be unit-tested as a normal function. The
 * drawer is just a view onto this state plus a few async effects (preview,
 * test-fire, save) — every other interaction goes through `reducer`.
 */

export type SlackTemplateType = "string" | "block_kit";
export type ConditionSource = "trace" | "customGraph";

export interface AutomationDraft {
  action: TriggerAction | null;
  name: string;
  alertType: AlertType | null;
  source: ConditionSource;
  filters: Partial<Record<FilterField, FilterParam>>;
  customGraphId: string | null;
  members: string[];
  slackWebhook: string;
  slackTemplateType: SlackTemplateType;
  slackTemplate: FieldDraft;
  emailSubject: FieldDraft;
  emailBody: FieldDraft;
  datasetId: string;
  datasetMapping: {
    mapping: Record<string, { source: string; key: string; subkey: string }>;
    expansions: string[];
  };
  annotators: { id: string; name: string }[];
}

export type DraftAction =
  | { type: "SET_ACTION"; value: TriggerAction }
  | { type: "SET_NAME"; value: string }
  | { type: "SET_ALERT_TYPE"; value: AlertType | null }
  | { type: "SET_SOURCE"; value: ConditionSource }
  | { type: "SET_CUSTOM_GRAPH_ID"; value: string | null }
  | { type: "SET_FILTERS"; value: Partial<Record<FilterField, FilterParam>> }
  | { type: "SET_MEMBERS"; value: string[] }
  | { type: "SET_SLACK_WEBHOOK"; value: string }
  | { type: "SET_SLACK_TYPE"; value: SlackTemplateType }
  | { type: "SET_SLACK_TEMPLATE"; value: FieldDraft }
  | { type: "SET_EMAIL_SUBJECT"; value: FieldDraft }
  | { type: "SET_EMAIL_BODY"; value: FieldDraft }
  | { type: "SET_DATASET_ID"; value: string }
  | { type: "SET_ANNOTATORS"; value: { id: string; name: string }[] }
  | { type: "HYDRATE"; value: AutomationDraft };

export const EMPTY_FIELD: FieldDraft = { value: "", usingDefault: true };

export const INITIAL_DRAFT: AutomationDraft = {
  action: null,
  name: "",
  alertType: null,
  source: "trace",
  filters: {},
  customGraphId: null,
  members: [],
  slackWebhook: "",
  slackTemplateType: "string",
  slackTemplate: EMPTY_FIELD,
  emailSubject: EMPTY_FIELD,
  emailBody: EMPTY_FIELD,
  datasetId: "",
  datasetMapping: { mapping: {}, expansions: [] },
  annotators: [],
};

export function reducer(
  state: AutomationDraft,
  action: DraftAction,
): AutomationDraft {
  switch (action.type) {
    case "HYDRATE":
      return action.value;
    case "SET_ACTION":
      // Action change resets the destination-specific config but keeps the
      // identity, conditions, and templates that may still be relevant.
      return {
        ...state,
        action: action.value,
        members: [],
        slackWebhook: "",
        datasetId: "",
        annotators: [],
      };
    case "SET_NAME":
      return { ...state, name: action.value };
    case "SET_ALERT_TYPE":
      return { ...state, alertType: action.value };
    case "SET_SOURCE":
      // Switching source clears the conditions tied to the other source so
      // we never persist stale filters next to a customGraphId or vice versa.
      return action.value === "customGraph"
        ? { ...state, source: "customGraph", filters: {} }
        : { ...state, source: "trace", customGraphId: null };
    case "SET_CUSTOM_GRAPH_ID":
      return { ...state, customGraphId: action.value };
    case "SET_FILTERS":
      return { ...state, filters: action.value };
    case "SET_MEMBERS":
      return { ...state, members: action.value };
    case "SET_SLACK_WEBHOOK":
      return { ...state, slackWebhook: action.value };
    case "SET_SLACK_TYPE":
      // Reset slackTemplate to "using default" so the new type's default
      // shows in the editor rather than a stale string-for-block_kit blob.
      return { ...state, slackTemplateType: action.value, slackTemplate: EMPTY_FIELD };
    case "SET_SLACK_TEMPLATE":
      return { ...state, slackTemplate: action.value };
    case "SET_EMAIL_SUBJECT":
      return { ...state, emailSubject: action.value };
    case "SET_EMAIL_BODY":
      return { ...state, emailBody: action.value };
    case "SET_DATASET_ID":
      return { ...state, datasetId: action.value };
    case "SET_ANNOTATORS":
      return { ...state, annotators: action.value };
  }
}

export const ACTION_LABEL: Record<TriggerAction, string> = {
  [TriggerAction.SEND_SLACK_MESSAGE]: "Slack",
  [TriggerAction.SEND_EMAIL]: "Email",
  [TriggerAction.ADD_TO_DATASET]: "Add to dataset",
  [TriggerAction.ADD_TO_ANNOTATION_QUEUE]: "Add to annotation queue",
};

export function notifyChannel(
  draft: AutomationDraft,
): "email" | "slack" | null {
  if (draft.action === TriggerAction.SEND_EMAIL) return "email";
  if (draft.action === TriggerAction.SEND_SLACK_MESSAGE) return "slack";
  return null;
}

export function templatesFromDraft(draft: AutomationDraft) {
  return {
    emailSubjectTemplate: draft.emailSubject.usingDefault
      ? null
      : draft.emailSubject.value,
    emailBodyTemplate: draft.emailBody.usingDefault
      ? null
      : draft.emailBody.value,
    slackTemplate: draft.slackTemplate.usingDefault
      ? null
      : draft.slackTemplate.value,
    slackTemplateType: draft.slackTemplate.usingDefault
      ? null
      : draft.slackTemplateType,
  };
}

export function actionParamsFromDraft(draft: AutomationDraft) {
  switch (draft.action) {
    case TriggerAction.SEND_EMAIL:
      return { members: draft.members };
    case TriggerAction.SEND_SLACK_MESSAGE:
      return { slackWebhook: draft.slackWebhook };
    case TriggerAction.ADD_TO_DATASET:
      return {
        datasetId: draft.datasetId,
        datasetMapping: draft.datasetMapping,
      };
    case TriggerAction.ADD_TO_ANNOTATION_QUEUE:
      return { annotators: draft.annotators };
    default:
      return {};
  }
}

function filtersAreSet(filters: AutomationDraft["filters"]): boolean {
  return Object.values(filters).some(
    (v) => v && (Array.isArray(v) ? v.length > 0 : Object.keys(v).length > 0),
  );
}

export function conditionsAreSet(draft: AutomationDraft): boolean {
  return draft.source === "customGraph"
    ? draft.customGraphId !== null
    : filtersAreSet(draft.filters);
}

export function configIsComplete(draft: AutomationDraft): boolean {
  if (!draft.action || draft.name.trim().length === 0) return false;
  switch (draft.action) {
    case TriggerAction.SEND_EMAIL:
      return draft.members.length > 0;
    case TriggerAction.SEND_SLACK_MESSAGE:
      return draft.slackWebhook.trim().length > 0;
    case TriggerAction.ADD_TO_DATASET:
      return draft.datasetId.length > 0;
    case TriggerAction.ADD_TO_ANNOTATION_QUEUE:
      return draft.annotators.length > 0;
  }
}

export function summariseConditions(draft: AutomationDraft): string {
  if (draft.source === "customGraph") {
    return draft.customGraphId
      ? `Custom graph alert (${draft.customGraphId.slice(0, 12)}…)`
      : "Custom graph (none selected)";
  }
  const keys = Object.keys(draft.filters);
  if (keys.length === 0) return "No conditions yet";
  return `${keys.length} condition${keys.length === 1 ? "" : "s"}: ${keys.slice(0, 3).join(", ")}${keys.length > 3 ? "…" : ""}`;
}

export function configurationSummary(draft: AutomationDraft): string {
  if (!draft.action) return "Choose a type first";
  const name = draft.name || "(unnamed)";
  switch (draft.action) {
    case TriggerAction.SEND_EMAIL:
      return `${name} → email to ${draft.members.length} recipient(s)`;
    case TriggerAction.SEND_SLACK_MESSAGE:
      return `${name} → Slack webhook${draft.slackWebhook ? " set" : " (not set)"}`;
    case TriggerAction.ADD_TO_DATASET:
      return `${name} → dataset ${draft.datasetId || "(not chosen)"}`;
    case TriggerAction.ADD_TO_ANNOTATION_QUEUE:
      return `${name} → ${draft.annotators.length} annotator(s)`;
  }
}
