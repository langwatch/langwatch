import type { AlertType, TriggerAction } from "@prisma/client";
import {
  DEFAULT_TRACE_DEBOUNCE_MS,
  type NotificationCadence,
} from "~/automations/cadences";
import {
  type AllSlices,
  CLIENT_PROVIDERS,
  initialSlices,
  type SliceFor,
} from "~/automations/providers/client";
import { isNotifyEntry } from "~/automations/providers/types";
import type { FilterParam } from "~/hooks/useFilterParams";
import {
  type GraphAlertOperator,
  type GraphAlertTimePeriod,
  extractGraphAlertFromTriggerRow as parseGraphAlertRow,
} from "~/server/app-layer/triggers/graph-alert.builder";
import type { FilterField } from "~/server/filters/types";

/**
 * Pure state machine for the staged automation drawer (ADR-036). Lives
 * outside any React component so it can be unit-tested as a normal
 * function. The drawer is just a view onto this state plus a few async
 * effects (preview, test-fire, save) — every other interaction goes
 * through `reducer`.
 *
 * Provider-specific state lives in `draft.slices[action]`; everything in
 * here is provider-agnostic. To add a new action type, register a
 * provider; the reducer doesn't change.
 */

export type ConditionSource = "trace" | "customGraph" | "report";

/** The content + schedule a scheduled REPORT captures (ADR-042). Mirrors the
 *  `reportActionParams` the router persists: a source discriminated by kind
 *  plus a cron+timezone schedule. Flat here for simple form binding. */
export type ReportSourceKind = "traceQuery" | "customGraph" | "dashboard";

export interface ReportDraft {
  sourceKind: ReportSourceKind;
  customGraphId: string | null;
  dashboardId: string | null;
  topN: number;
  cron: string;
  timezone: string;
}

export const INITIAL_REPORT_DRAFT: ReportDraft = {
  sourceKind: "traceQuery",
  customGraphId: null,
  dashboardId: null,
  topN: 5,
  cron: "0 9 * * 1",
  timezone: "UTC",
};

/** The threshold rule a custom-graph alert fires on. Mirrors the fields the
 *  dashboard `AlertDrawer` collects and the dispatcher reads off the
 *  Trigger row's `actionParams`. Lives at the draft root (not in a slice)
 *  because both Email and Slack providers reuse the same rule and only
 *  differ in their destination keys. */
export interface GraphAlertDraft {
  seriesName: string;
  operator: GraphAlertOperator;
  threshold: number;
  timePeriod: GraphAlertTimePeriod;
}

export const INITIAL_GRAPH_ALERT_DRAFT: GraphAlertDraft = {
  seriesName: "",
  operator: "gt",
  threshold: 0,
  timePeriod: 60,
};

export interface AutomationDraft {
  /** The chosen action, or null while the user is still picking. */
  action: TriggerAction | null;
  /** Shared identity. */
  name: string;
  alertType: AlertType | null;
  /** Where conditions come from — trace filters or a custom graph alert. */
  source: ConditionSource;
  filters: Partial<Record<FilterField, FilterParam>>;
  /** ADR-043 Subject facet: the Traces-V2 liqe query a trace-subject
   *  automation is about. When non-empty it supersedes `filters` — the router
   *  persists `filters` as `{}` and the dispatcher matches this in-memory.
   *  `null`/empty keeps the legacy structured-`filters` path (edit of an older
   *  automation). Only meaningful when `source === "trace"`. */
  filterQuery: string | null;
  customGraphId: string | null;
  /** Threshold rule for graph alerts. Only meaningful when
   *  `source === "customGraph"`; carried around the draft so type-switching
   *  back and forth doesn't wipe the user's threshold while they're
   *  experimenting. */
  graphAlert: GraphAlertDraft;
  /** Report content + schedule. Only meaningful when `source === "report"`;
   *  carried around so type-switching doesn't wipe it. */
  report: ReportDraft;
  /** Per-trigger digest cadence (ADR-026). Ignored at storage and dispatch
   *  time for persist actions, so the draft value can sit dormant while the
   *  user is type-switching. */
  notificationCadence: NotificationCadence;
  /** Per-trigger trace-readiness debounce in ms (ADR-026). The settle stage
   *  holds the trace this long before re-evaluating filters; only meaningful
   *  for notify actions (persist actions ignore it). */
  traceDebounceMs: number;
  /** True once the user has looked at the cadence stage (opened it and hit
   *  Done, or changed either knob). New drafts start unconfirmed so the
   *  defaults can't silently ship without the author ever seeing them;
   *  hydrated rows start confirmed because the saved values were chosen. */
  cadenceConfirmed: boolean;
  /** Per-provider slice — all present, so type-switching never loses the
   *  slice the user was on. */
  slices: AllSlices;
}

export type DraftAction =
  | { type: "SET_ACTION"; value: TriggerAction }
  | { type: "SET_NAME"; value: string }
  | { type: "SET_ALERT_TYPE"; value: AlertType | null }
  | { type: "SET_SOURCE"; value: ConditionSource }
  | { type: "SET_CUSTOM_GRAPH_ID"; value: string | null }
  | { type: "SET_FILTERS"; value: Partial<Record<FilterField, FilterParam>> }
  | { type: "SET_FILTER_QUERY"; value: string }
  | { type: "SET_GRAPH_ALERT"; value: GraphAlertDraft }
  | { type: "SET_REPORT"; value: ReportDraft }
  | { type: "SET_CADENCE"; value: NotificationCadence }
  | { type: "SET_TRACE_DEBOUNCE_MS"; value: number }
  | { type: "CONFIRM_CADENCE" }
  | SetSliceAction
  | { type: "HYDRATE"; value: AutomationDraft };

/**
 * Distributive shape: each TriggerAction maps to *its own* slice variant so
 * a SET_SLICE dispatch with action `SEND_EMAIL` can't carry a Slack slice.
 * Without the distributive `A extends TriggerAction` form, `slice` would be
 * the union of every action's slice and the discriminator would do nothing
 * at the type level.
 */
export type SetSliceAction = {
  [A in TriggerAction]: {
    type: "SET_SLICE";
    action: A;
    slice: SliceFor[A];
  };
}[TriggerAction];

export const INITIAL_DRAFT: AutomationDraft = {
  action: null,
  name: "",
  alertType: null,
  source: "trace",
  filters: {},
  filterQuery: null,
  customGraphId: null,
  graphAlert: INITIAL_GRAPH_ALERT_DRAFT,
  report: INITIAL_REPORT_DRAFT,
  // Matches the app-layer create-default for notify triggers (ADR-026).
  // Persist actions ignore this at the router boundary, so leaving it set
  // here while the user is picking an action is safe.
  notificationCadence: "5min_digest",
  // Matches the `Trigger.traceDebounceMs` column default (ADR-026). Persist
  // actions ignore this at dispatch time, so a non-zero default is harmless
  // even while the user is type-switching.
  traceDebounceMs: DEFAULT_TRACE_DEBOUNCE_MS,
  cadenceConfirmed: false,
  slices: initialSlices(),
};

export function reducer(
  state: AutomationDraft,
  action: DraftAction,
): AutomationDraft {
  switch (action.type) {
    case "HYDRATE":
      return action.value;
    case "SET_ACTION":
      // Slices stay — switching type doesn't wipe the other provider's slice.
      return { ...state, action: action.value };
    case "SET_NAME":
      return { ...state, name: action.value };
    case "SET_ALERT_TYPE":
      return { ...state, alertType: action.value };
    case "SET_SOURCE":
      // Switching source clears the conditions tied to the other source so
      // we never persist stale filters next to a customGraphId or vice versa.
      // Graph alerts only support notify actions (email / Slack) — a
      // previously picked persist action would be rejected at save time, so
      // switching to customGraph resets it and the user re-picks.
      if (action.value === "customGraph") {
        return {
          ...state,
          source: "customGraph",
          filters: {},
          filterQuery: null,
          action:
            state.action === "SEND_EMAIL" ||
            state.action === "SEND_SLACK_MESSAGE"
              ? state.action
              : null,
        };
      }
      if (action.value === "report") {
        // Reports send a rendered notification on a schedule — notify only.
        return {
          ...state,
          source: "report",
          filters: {},
          filterQuery: null,
          customGraphId: null,
          action:
            state.action === "SEND_EMAIL" ||
            state.action === "SEND_SLACK_MESSAGE"
              ? state.action
              : null,
        };
      }
      return { ...state, source: "trace", customGraphId: null };
    case "SET_CUSTOM_GRAPH_ID":
      return { ...state, customGraphId: action.value };
    case "SET_FILTERS":
      return { ...state, filters: action.value };
    case "SET_FILTER_QUERY":
      return { ...state, filterQuery: action.value };
    case "SET_GRAPH_ALERT":
      return { ...state, graphAlert: action.value };
    case "SET_REPORT":
      return { ...state, report: action.value };
    case "SET_CADENCE":
      return {
        ...state,
        notificationCadence: action.value,
        cadenceConfirmed: true,
      };
    case "SET_TRACE_DEBOUNCE_MS":
      return {
        ...state,
        traceDebounceMs: action.value,
        cadenceConfirmed: true,
      };
    case "CONFIRM_CADENCE":
      return state.cadenceConfirmed
        ? state
        : { ...state, cadenceConfirmed: true };
    case "SET_SLICE":
      return {
        ...state,
        slices: { ...state.slices, [action.action]: action.slice },
      };
  }
}

/** The Automation / Alert / Report noun set for one preset. */
export interface PresetLabels {
  /** Drawer heading. */
  title: string;
  /** Footer save button. */
  saveButton: string;
  /** Toast title after a successful create. */
  createdToast: string;
  /** Toast title after a successful update. */
  updatedToast: string;
  /** Lowercase singular noun for inline copy ("this report has changes…"). */
  noun: string;
}

/**
 * The single source of truth for the Automation / Alert / Report nouns,
 * keyed on the preset (`draft.source`) so every heading, button, and toast
 * stays in step with the chosen type. Replaces the scattered
 * `source === "customGraph" ? … : …` two-way branches that classified a
 * REPORT as trace data — the visible bug where the drawer said "New report"
 * yet the save button read "Create automation" (field-5015).
 */
export function presetLabels(
  source: ConditionSource,
  isEdit: boolean,
): PresetLabels {
  switch (source) {
    case "customGraph":
      return {
        title: isEdit ? "Edit alert" : "New alert",
        saveButton: isEdit ? "Save alert" : "Create alert",
        createdToast: "Alert created",
        updatedToast: "Alert updated",
        noun: "alert",
      };
    case "report":
      return {
        title: isEdit ? "Edit report" : "New report",
        saveButton: isEdit ? "Save report" : "Create report",
        createdToast: "Report created",
        updatedToast: "Report updated",
        noun: "report",
      };
    case "trace":
      return {
        title: isEdit ? "Edit automation" : "Add automation",
        saveButton: isEdit ? "Save changes" : "Create automation",
        createdToast: "Automation created",
        updatedToast: "Automation updated",
        noun: "automation",
      };
  }
}

// ---- Helpers, all delegating via the provider registry ------------------

export function notifyChannel(
  draft: AutomationDraft,
): "email" | "slack" | null {
  if (!draft.action) return null;
  const provider = CLIENT_PROVIDERS[draft.action];
  return isNotifyEntry(provider) ? provider.client.channel : null;
}

const EMPTY_TEMPLATES = {
  emailSubjectTemplate: null,
  emailBodyTemplate: null,
  slackTemplate: null,
  slackTemplateType: null,
} as const;

export function templatesFromDraft(draft: AutomationDraft) {
  if (!draft.action) return EMPTY_TEMPLATES;
  const provider = CLIENT_PROVIDERS[draft.action];
  if (!isNotifyEntry(provider)) return EMPTY_TEMPLATES;
  return provider.client.templatesFromSlice(draft.slices[draft.action]);
}

/**
 * Build the `automation.testFireTemplate` mutation input from a draft.
 * Extracted from the drawer so the graph-alert discriminator is unit-testable:
 * a `customGraph` draft MUST carry a non-null `graphAlert` or the server
 * renders the alert template against the trace context, producing the blank
 * "Metric / Condition / <|Open dashboard>" message (the field-5015 bug).
 */
export function buildTestFirePayload({
  draft,
  projectId,
  channel,
  webhook,
  graphName,
  seriesLabel,
}: {
  draft: AutomationDraft;
  projectId: string;
  channel: "email" | "slack";
  webhook: string | null;
  graphName?: string | null;
  seriesLabel?: string | null;
}) {
  const isGraphAlert = draft.source === "customGraph";
  return {
    projectId,
    channel,
    trigger: {
      name: draft.name || "Your automation",
      alertType: draft.alertType,
    },
    draft: templatesFromDraft(draft),
    webhook,
    graphAlert: isGraphAlert
      ? {
          graphName: graphName ?? undefined,
          metricLabel: seriesLabel ?? undefined,
          operator: draft.graphAlert.operator,
          threshold: draft.graphAlert.threshold,
          timePeriodMinutes: draft.graphAlert.timePeriod,
        }
      : null,
  };
}

export function actionParamsFromDraft(draft: AutomationDraft) {
  if (!draft.action) return {};
  const provider = CLIENT_PROVIDERS[draft.action];
  return provider.client.toActionParams(draft.slices[draft.action]);
}

export function filtersAreSet(filters: AutomationDraft["filters"]): boolean {
  return Object.values(filters).some(
    (v) => v && (Array.isArray(v) ? v.length > 0 : Object.keys(v).length > 0),
  );
}

/**
 * The "what" facet (ADR-043 Subject): is the thing it's about chosen?
 * - Automation: a trace filter query, or (legacy edit) at least one structured
 *   trace filter.
 * - Alert: a custom graph plus a series to watch.
 * - Report: a valid content source — a trace table, a picked graph, or a
 *   picked dashboard.
 */
export function subjectIsSet(draft: AutomationDraft): boolean {
  if (draft.source === "customGraph") {
    return (
      draft.customGraphId !== null && draft.graphAlert.seriesName.length > 0
    );
  }
  if (draft.source === "report") {
    const r = draft.report;
    return (
      r.sourceKind === "traceQuery" ||
      (r.sourceKind === "customGraph" && r.customGraphId !== null) ||
      (r.sourceKind === "dashboard" && r.dashboardId !== null)
    );
  }
  return filterQueryIsSet(draft.filterQuery) || filtersAreSet(draft.filters);
}

/** A trace-subject query is set when it has non-whitespace content. */
export function filterQueryIsSet(filterQuery: string | null): boolean {
  return (filterQuery ?? "").trim().length > 0;
}

/**
 * The "when" facet (ADR-043 Cadence): is the run-trigger timing set?
 * - Automation: always — the digest cadence and settle window carry valid
 *   defaults, so there is nothing to block on.
 * - Alert: a finite threshold to compare the metric against.
 * - Report: a cron schedule.
 */
export function cadenceIsSet(draft: AutomationDraft): boolean {
  if (draft.source === "customGraph") {
    return Number.isFinite(draft.graphAlert.threshold);
  }
  if (draft.source === "report") {
    return draft.report.cron.trim().length > 0;
  }
  return true;
}

export function conditionsAreSet(draft: AutomationDraft): boolean {
  if (!subjectIsSet(draft) || !cadenceIsSet(draft)) return false;
  // Alerts additionally require a severity (ADR-043 facet 5) — without the
  // series the dispatcher has no metric, and the router rejects a graph
  // alert with no severity, so gating it here keeps Save honest instead of
  // surfacing a server 400.
  if (draft.source === "customGraph") return draft.alertType !== null;
  return true;
}

/**
 * Channel-setup completeness ONLY — deliberately excludes the name. A
 * fully-configured Slack/email section goes green even while the name is
 * empty; the missing name is surfaced on the name field itself and gates
 * the Save button, not the section indicator.
 */
export function configIsComplete(draft: AutomationDraft): boolean {
  if (!draft.action) return false;
  const provider = CLIENT_PROVIDERS[draft.action];
  return provider.client.isComplete(draft.slices[draft.action]);
}

/** Operator labels matching the dashboard "Configure Alert" copy verbatim
 *  so the experience is identical between the two creation paths. */
export const OPERATOR_LABELS: Record<GraphAlertOperator, string> = {
  gt: "greater than",
  lt: "less than",
  gte: "greater than or equal",
  lte: "less than or equal",
  eq: "equal to",
};

/** Time-period labels mirroring the dashboard "Time Period" select. */
export const TIME_PERIOD_LABELS: Record<GraphAlertTimePeriod, string> = {
  1: "1 minute",
  5: "5 minutes",
  15: "15 minutes",
  30: "30 minutes",
  60: "1 hour",
  1440: "1 day",
};

export function configurationSummary(draft: AutomationDraft): string {
  if (!draft.action) return "Choose a type first";
  const provider = CLIENT_PROVIDERS[draft.action];
  return provider.client.summary(draft.slices[draft.action], {
    name: draft.name,
  });
}

/** True when the active action is a notify provider — used to gate the
 *  preview pane, cadence stage, and test-fire UI. */
export function isNotifyAction(draft: AutomationDraft): boolean {
  if (!draft.action) return false;
  return isNotifyEntry(CLIENT_PROVIDERS[draft.action]);
}

/** Pull the graph-alert threshold rule out of a saved Trigger row's
 *  `actionParams` JSON. Returns the seeded defaults when the row isn't a
 *  graph alert or the JSON shape is unexpected (legacy / hand-edited rows).
 *  The drawer relies on this on edit hydration so the threshold fields
 *  pre-populate. */
export function extractGraphAlertFromTriggerRow(
  actionParams: unknown,
): GraphAlertDraft {
  // Delegate to the SSOT parser on the server side. `parseGraphAlertRow`
  // uses the same Zod schema the writer produces (`graphAlertActionParamsSchema`),
  // so the drawer's edit-hydration path can never drift from the row shape.
  // Falls back to the seeded defaults on any parse failure (legacy /
  // hand-edited rows) — the drawer's contract needs a filled draft, never
  // a null.
  const parsed = parseGraphAlertRow(actionParams);
  if (!parsed) return INITIAL_GRAPH_ALERT_DRAFT;
  return {
    operator: parsed.operator,
    timePeriod: parsed.timePeriod,
    threshold: parsed.threshold,
    seriesName: parsed.seriesName,
  };
}

/**
 * Map the flat `ReportDraft` to the `report` upsert input (source discriminated
 * union + schedule) the automations router validates.
 */
export function reportInputFromDraft(report: ReportDraft): {
  source:
    | { kind: "traceQuery"; filters: Record<string, unknown>; topN: number }
    | { kind: "customGraph"; customGraphId: string }
    | { kind: "dashboard"; dashboardId: string };
  schedule: { cron: string; timezone: string };
  compareToPrevious: boolean;
} {
  const schedule = { cron: report.cron, timezone: report.timezone };
  if (report.sourceKind === "customGraph") {
    return {
      source: { kind: "customGraph", customGraphId: report.customGraphId ?? "" },
      schedule,
      compareToPrevious: false,
    };
  }
  if (report.sourceKind === "dashboard") {
    return {
      source: { kind: "dashboard", dashboardId: report.dashboardId ?? "" },
      schedule,
      compareToPrevious: false,
    };
  }
  return {
    source: { kind: "traceQuery", filters: {}, topN: report.topN },
    schedule,
    compareToPrevious: false,
  };
}
