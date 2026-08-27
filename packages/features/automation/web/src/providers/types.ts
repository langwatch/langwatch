import type { NotificationCadence } from "@langwatch/automation-contract";
import type {
  SavedTriggerRow,
  SharedDef,
  TemplateDraft,
  VariableInfo,
} from "@langwatch/automation-contract";
import type { ComponentType } from "react";

/** Browser definitions for automation providers. Delivery and secrets remain server-owned. */

/** Identity passed to summary functions so they can include the user's
 *  configured automation name in the section row preview. */
export interface SummaryIdentity {
  name: string;
}

/** Controlled authoring state and actions supplied to a provider form. */
export interface ConfigFormCtx<TPreview = unknown> {
  projectId: string;
  organizationId: string | undefined;
  teamSlug: string | undefined;
  /** Present while editing, allowing the transport to reuse a stored secret. */
  automationId?: string;
  /** Variables advertised to the editor (path / type / description). */
  variables: VariableInfo[];
  /** The example data the preview renders against, shown via ExampleData. */
  example: unknown;
  /** Most recent live-preview result for the active notify channel,
   *  or undefined for action providers. Shape is owned by the provider. */
  preview?: TPreview;
  previewLoading?: boolean;
  /** Derived cadence class used to select template defaults. */
  cadenceMode: "immediate" | "digest";
  /** Full draft cadence for providers that expose cadence controls. */
  notificationCadence: NotificationCadence;
  /** Updates cadence through the owning draft store. */
  setNotificationCadence: (value: NotificationCadence) => void;
  /** True when the draft has any evaluations.* filter set — used by the
   *  Slack picker to surface the eval-failure template. */
  hasEvaluationFilter: boolean;
  /** Subject used to choose compatible templates. */
  sourceKind: "trace" | "graphAlert" | "report";
  /** For a report, the content it sends — a table of matching traces, one
   *  custom graph, or a whole dashboard. Narrows which report layouts apply. */
  reportSourceKind?: "traceQuery" | "customGraph" | "dashboard";
  /** Sends the current draft when it is test-fireable. */
  onTestFire?: () => void;
  testFireLoading?: boolean;
  /** Most recent test-fire result for inline provider feedback. */
  lastTestAttempt?: {
    at: number;
    channel: "email" | "slack" | "webhook";
    status: "success" | "failure";
    httpStatus?: number;
    errorTitle?: string;
    errorDetail?: string;
  } | null;
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

  /** Reads this provider's state from a saved trigger. */
  fromTriggerRow(row: SavedTriggerRow): S;

  /** Serialises this provider's state into action parameters. */
  toActionParams(slice: S): unknown;

  /** Renders provider configuration in the controlled host surface. */
  readonly ConfigForm: ComponentType<ConfigFormProps<S, TPreview>>;
}

export interface ConfigFormProps<S, TPreview = unknown> {
  slice: S;
  onChange: (next: S) => void;
  ctx: ConfigFormCtx<TPreview>;
}

/** Notify-specific client additions. Generic over slice and preview. */
export interface NotifyClientDef<S = unknown, TPreview = unknown> extends ClientDef<S, TPreview> {
  /** Channel accepted by preview and test-fire transports. */
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
  /** Delivery-specific preview options needed for payload parity. */
  previewOptions?(slice: S): { allowGatedBlocks?: boolean };
}

export interface ClientEntry<S = unknown, TPreview = unknown> {
  shared: SharedDef;
  client: ClientDef<S, TPreview> | NotifyClientDef<S, TPreview>;
}
