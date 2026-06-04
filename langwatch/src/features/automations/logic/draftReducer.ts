import { AlertType, type TriggerAction } from "@prisma/client";
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
  DEFAULT_TRACE_DEBOUNCE_MS,
  type NotificationCadence,
} from "~/automations/cadences";

/**
 * Pure state machine for the staged automation drawer (ADR-028). Lives
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
  /** Per-trigger digest cadence (ADR-025). Ignored at storage and dispatch
   *  time for persist actions, so the draft value can sit dormant while the
   *  user is type-switching. */
  notificationCadence: NotificationCadence;
  /** Per-trigger trace-readiness debounce in ms (ADR-030). The settle stage
   *  holds the trace this long before re-evaluating filters; only meaningful
   *  for notify actions (persist actions ignore it). */
  traceDebounceMs: number;
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
  | { type: "SET_CADENCE"; value: NotificationCadence }
  | { type: "SET_TRACE_DEBOUNCE_MS"; value: number }
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
  // Matches the app-layer create-default for notify triggers (ADR-026).
  // Persist actions ignore this at the router boundary, so leaving it set
  // here while the user is picking an action is safe.
  notificationCadence: "5min_digest",
  // Matches the `Trigger.traceDebounceMs` column default (ADR-026). Persist
  // actions ignore this at dispatch time, so a non-zero default is harmless
  // even while the user is type-switching.
  traceDebounceMs: DEFAULT_TRACE_DEBOUNCE_MS,
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
    case "SET_CADENCE":
      return { ...state, notificationCadence: action.value };
    case "SET_TRACE_DEBOUNCE_MS":
      return { ...state, traceDebounceMs: action.value };
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
  return draft.source === "customGraph"
    ? draft.customGraphId !== null
    : filtersAreSet(draft.filters);
}

export function configIsComplete(draft: AutomationDraft): boolean {
  if (!draft.action || draft.name.trim().length === 0) return false;
  const provider = CLIENT_PROVIDERS[draft.action];
  return provider.client.isComplete(draft.slices[draft.action]);
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

const CADENCE_LABELS: Record<NotificationCadence, string> = {
  immediate: "Immediate",
  "5min_digest": "Every 5 minutes",
  "15min_digest": "Every 15 minutes",
  hourly_digest: "Every hour",
};

/** One-line summary of the cadence + settle window, shown on the cadence
 *  section row in the main drawer. Notify actions only — persist actions
 *  ignore both knobs and the row is hidden. */
export function cadenceSummary(draft: AutomationDraft): string {
  const cadence = CADENCE_LABELS[draft.notificationCadence];
  const seconds = Math.round(draft.traceDebounceMs / 1000);
  const settle = `${seconds}s settle window`;
  return `${cadence} · ${settle}`;
}
