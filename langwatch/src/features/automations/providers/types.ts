import type { ComponentType } from "react";
import type { NotificationCadence } from "@langwatch/automations/cadences";
import type {
  SavedTriggerRow,
  SharedDef,
  TemplateDraft,
} from "@langwatch/automations/providers/types";

/**
 * Client-side halves of the automation provider system: the UI definition
 * each provider contributes and the registry entry shapes the drawer
 * consumes. Server-only concerns (secret persistence, dispatch) never
 * appear here — see ~/server/app-layer/automations/providers.
 */

/** Identity passed to summary functions so they can include the user's
 *  configured automation name in the section row preview. */
export interface SummaryIdentity {
  name: string;
}

/** Context every `ConfigForm` receives from the orchestrator. Generic
 *  over the preview shape so each provider can declare its own. */
export interface ConfigFormCtx<TPreview = unknown> {
  projectId: string;
  organizationId: string | undefined;
  teamSlug: string | undefined;
  /** The saved automation's id when editing an existing row, undefined for a
   *  new draft. Lets a provider act against the stored (server-side) secret —
   *  e.g. the Slack channel picker loads channels from the saved bot token
   *  without the author having to retype it. */
  automationId?: string;
  /** Variables advertised to the editor (path / type / description). */
  variables: VariableInfo[];
  /** The example data the preview renders against, shown via ExampleData. */
  example: unknown;
  /** Most recent live-preview result for the active notify channel,
   *  or undefined for action providers. Shape is owned by the provider. */
  preview?: TPreview;
  previewLoading?: boolean;
  /** "immediate" vs "digest" — derived from the draft's notificationCadence.
   *  Providers use it to pick template defaults or default-render shapes. */
  cadenceMode: "immediate" | "digest";
  /** The full notification cadence value off the draft (e.g. "immediate",
   *  "5min_digest", "hourly_digest"). Providers that want to expose an
   *  inline cadence selector — because the choice affects which template
   *  variables are available — read this and call `setNotificationCadence`. */
  notificationCadence: NotificationCadence;
  /** Updates the draft's notification cadence. Wired through the store so
   *  the change is reflected everywhere (variable filter, preview, the
   *  cadence secondary drawer). */
  setNotificationCadence: (value: NotificationCadence) => void;
  /** True when the draft has any evaluations.* filter set — used by the
   *  Slack picker to surface the eval-failure template. */
  hasEvaluationFilter: boolean;
  /** What the draft is about — trace data, a custom-graph alert, or a scheduled
   *  report. Notify providers seed their template defaults from this AND filter
   *  the template gallery by it, so a report never offers the per-trace
   *  (immediate) layouts. */
  sourceKind: "trace" | "graphAlert" | "report";
  /** For a report, the content it sends — a table of matching traces, one
   *  custom graph, or a whole dashboard. Narrows which report layouts apply. */
  reportSourceKind?: "traceQuery" | "customGraph" | "dashboard";
  /** Send a test notification with the current draft, so the author can try it
   *  from inside the config section. No-op / absent when the draft isn't
   *  test-fireable yet. `testFireLoading` reflects the in-flight send. */
  onTestFire?: () => void;
  testFireLoading?: boolean;
  /** Most recent test-fire attempt this session, so a provider can render the
   *  outcome (HTTP status, failure detail) inline next to its test button.
   *  Providers filter by their own channel before rendering. */
  lastTestAttempt?: {
    at: number;
    channel: "email" | "slack" | "webhook";
    status: "success" | "failure";
    httpStatus?: number;
    errorTitle?: string;
    errorDetail?: string;
  } | null;
}

/** Mirrors `editors/liquidMonaco#VariableInfo`. Defined here too so the
 *  context shape stays self-contained for provider authors. */
export interface VariableInfo {
  path: string;
  type: string;
  description?: string;
}

/** The client definition (`client.tsx`) — UI + slice helpers. */
export interface ClientDef<S = unknown, TPreview = unknown> {
  /** Icon rendered in the type picker. Lucide / react-icons component. */
  readonly Icon: ComponentType<{ size?: number }>;

  /** Initial empty slice for this provider. */
  initialSlice(): S;

  /** True when the slice is sufficient to save / test-fire. The drawer
   *  uses this for the "completed" border on the section row. */
  isComplete(slice: S): boolean;

  /** One-line summary rendered on the Configuration section row. */
  summary(slice: S, identity: SummaryIdentity): string;

  /** Read this provider's slice out of a saved trigger row. */
  fromTriggerRow(row: SavedTriggerRow): S;

  /** Serialise this provider's slice into the JSON `actionParams` we
   *  store on the row. */
  toActionParams(slice: S): unknown;

  /** Renders the provider-specific config inside the Configuration
   *  secondary drawer. */
  readonly ConfigForm: ComponentType<ConfigFormProps<S, TPreview>>;
}

export interface ConfigFormProps<S, TPreview = unknown> {
  slice: S;
  onChange: (next: S) => void;
  ctx: ConfigFormCtx<TPreview>;
}

/** Notify-specific client additions. Generic over slice and preview. */
export interface NotifyClientDef<S = unknown, TPreview = unknown>
  extends ClientDef<S, TPreview> {
  /** The channel string the preview/testFire endpoints accept. Each
   *  provider names its own — the shared layer doesn't enumerate. */
  readonly channel: "email" | "slack" | "webhook";
  /** Webhook for the test-fire mutation. ADR-031: email test fires resolve
   *  their recipient server-side (the requester's own inbox), so no provider
   *  contributes a recipient list here — only Slack contributes its webhook. */
  testFireTarget(slice: S): {
    webhook: string | null;
    /** Slack bot connection: test-fire posts via the Web API instead of the
     *  webhook. `botToken` is the freshly-typed token, or null to reuse the
     *  saved automation's stored token. */
    botDestination?: { channelId: string; botToken: string | null } | null;
    /** Generic HTTP destination (ADR-040): the full request shape the test
     *  fire sends through the SSRF-fenced sender. */
    webhookDestination?: {
      url: string;
      method: "POST" | "PUT" | "PATCH";
      headers: Record<string, string>;
      bodyTemplate: string | null;
    } | null;
  };
  /** Template strings contributed to the save payload (`templates`). */
  templatesFromSlice(slice: S): TemplateDraft;
  /** Render options the PREVIEW must mirror so it shows what will really be
   *  delivered. Slack only renders the modern blocks (charts, tables, alert
   *  banners) over a bot connection — without this the preview would show a
   *  chart that the webhook is going to strip, or hide one the bot will send.
   *  Omit when the provider's preview needs no delivery-specific options. */
  previewOptions?(slice: S): { allowGatedBlocks?: boolean };
}

// ---- Registry entries ---------------------------------------------------

export interface ClientEntry<S = unknown, TPreview = unknown> {
  shared: SharedDef;
  client: ClientDef<S, TPreview> | NotifyClientDef<S, TPreview>;
}

export interface NotifyClientEntry<S = unknown, TPreview = unknown>
  extends ClientEntry<S, TPreview> {
  shared: SharedDef & { category: "notify" };
  client: NotifyClientDef<S, TPreview>;
}

export function isNotifyEntry(entry: ClientEntry): entry is NotifyClientEntry {
  return entry.shared.category === "notify";
}
