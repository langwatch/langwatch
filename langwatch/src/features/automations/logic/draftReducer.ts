import type { AlertType, TriggerAction } from "@prisma/client";
import {
  CADENCE_LABELS,
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
import type { FilterField } from "~/server/filters/types";
import {
  extractGraphAlertFromTriggerRow as parseGraphAlertRow,
  type GraphAlertOperator,
  type GraphAlertTimePeriod,
} from "~/server/app-layer/triggers/graph-alert.builder";

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

export type ConditionSource = "trace" | "customGraph";

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
  customGraphId: string | null;
  /** Threshold rule for graph alerts. Only meaningful when
   *  `source === "customGraph"`; carried around the draft so type-switching
   *  back and forth doesn't wipe the user's threshold while they're
   *  experimenting. */
  graphAlert: GraphAlertDraft;
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
  | { type: "SET_GRAPH_ALERT"; value: GraphAlertDraft }
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
  customGraphId: null,
  graphAlert: INITIAL_GRAPH_ALERT_DRAFT,
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
      return action.value === "customGraph"
        ? { ...state, source: "customGraph", filters: {} }
        : { ...state, source: "trace", customGraphId: null };
    case "SET_CUSTOM_GRAPH_ID":
      return { ...state, customGraphId: action.value };
    case "SET_FILTERS":
      return { ...state, filters: action.value };
    case "SET_GRAPH_ALERT":
      return { ...state, graphAlert: action.value };
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

export function conditionsAreSet(draft: AutomationDraft): boolean {
  if (draft.source === "customGraph") {
    // A graph alert isn't a condition until the threshold rule is filled
    // in. Without the rule there's nothing to fire on; without the series
    // the dispatcher has no metric to evaluate.
    return (
      draft.customGraphId !== null &&
      draft.graphAlert.seriesName.length > 0 &&
      Number.isFinite(draft.graphAlert.threshold)
    );
  }
  return filtersAreSet(draft.filters);
}

export function configIsComplete(draft: AutomationDraft): boolean {
  if (!draft.action || draft.name.trim().length === 0) return false;
  const provider = CLIENT_PROVIDERS[draft.action];
  return provider.client.isComplete(draft.slices[draft.action]);
}

export function summariseConditions(draft: AutomationDraft): string {
  if (draft.source === "customGraph") {
    if (!draft.customGraphId) return "Pick a graph";
    if (!draft.graphAlert.seriesName) return "Pick a series to monitor";
    const op = OPERATOR_LABELS[draft.graphAlert.operator];
    const window = TIME_PERIOD_LABELS[draft.graphAlert.timePeriod];
    return `${draft.graphAlert.seriesName} ${op} ${draft.graphAlert.threshold} over ${window}`;
  }
  const keys = Object.keys(draft.filters);
  if (keys.length === 0) return "No conditions yet";
  return `${keys.length} condition${keys.length === 1 ? "" : "s"}: ${keys.slice(0, 3).join(", ")}${keys.length > 3 ? "…" : ""}`;
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

/** One-line summary of the cadence + settle window, shown on the cadence
 *  section row in the main drawer. Notify actions only — persist actions
 *  ignore both knobs and the row is hidden. */
export function cadenceSummary(draft: AutomationDraft): string {
  const cadence = CADENCE_LABELS[draft.notificationCadence];
  const seconds = Math.round(draft.traceDebounceMs / 1000);
  const settle = `${seconds}s settle window`;
  return `${cadence} · ${settle}`;
}
