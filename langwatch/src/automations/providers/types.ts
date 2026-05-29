import type { AlertType, TriggerAction } from "@prisma/client";
import type { ComponentType } from "react";
import type { ZodTypeAny } from "zod";

/**
 * Shared interfaces for the automation provider system (Stage A of the
 * provider model — client-side only; server-side dispatcher refactor is
 * Stage B, separate ADR). A provider is one action type expressed as three
 * peer files under `definitions/<name>/`:
 *
 *   shared.ts   — the cross-cutting metadata + Zod schema for actionParams.
 *                 Pure data + Zod; no React, no server-only deps. Both
 *                 the client and the server import this.
 *
 *   client.tsx  — the UI half: `Icon`, `ConfigForm`, slice shape + helpers
 *                 (`initialSlice`, `isComplete`, `summary`,
 *                 `fromTriggerRow`, `toActionParams`). For notify
 *                 providers, also `testFireTarget` + `templatesFromSlice`.
 *
 *   server.ts   — the dispatch + test-fire hooks. In Stage A these are
 *                 stubs that re-export the existing senders so the parity
 *                 test passes and `triggerActionDispatch.ts` stays put;
 *                 Stage B will move the bodies in and kill the switch.
 *
 * The registries (`client.ts`, `server.ts` at this folder root) pair
 * each shared definition with its side-specific peer and expose them as
 * `Record<TriggerAction, ...>`. The orchestrator + drawer never know
 * which concrete action they're looking at; adding a new action type
 * is one new directory + one registry line.
 */

export type Category = "notify" | "action";

/** A saved Trigger row as the client sees it on the wire — everything a
 *  provider might want to read when hydrating its slice from a saved
 *  trigger. Templates live at the row root (not inside `actionParams`)
 *  because they are notify-only top-level columns; the row shape mirrors
 *  the Prisma `Trigger` model. */
export interface SavedTriggerRow {
  id: string;
  name: string;
  alertType: AlertType | null;
  message: string | null;
  action: TriggerAction;
  actionParams: unknown;
  emailSubjectTemplate: string | null;
  emailBodyTemplate: string | null;
  slackTemplate: string | null;
  slackTemplateType: string | null;
}

/** The four template columns notify providers contribute on save. */
export interface TemplateDraft {
  emailSubjectTemplate: string | null;
  emailBodyTemplate: string | null;
  slackTemplate: string | null;
  slackTemplateType: string | null;
}

/** The "shared" definition (`shared.ts`) — must be safe to import on both
 *  the client and the server. */
export interface SharedDef {
  /** Discriminator stored on the Trigger row. */
  readonly action: TriggerAction;
  /** Drives notify-only UI affordances (cadence, test fire, templates). */
  readonly category: Category;
  /** Human label, e.g. "Slack". */
  readonly label: string;
  /** One-line marketing-ish description shown under the icon in the picker. */
  readonly description: string;
  /** Zod schema for the `actionParams` JSON column. Used by the upsert
   *  route to validate input before persisting. */
  readonly actionParamsSchema: ZodTypeAny;
}

/** Identity passed to summary functions so they can include the user's
 *  configured automation name in the section row preview. */
export interface SummaryIdentity {
  name: string;
}

/** Context every `ConfigForm` receives from the orchestrator. */
export interface ConfigFormCtx {
  projectId: string;
  organizationId: string | undefined;
  teamSlug: string | undefined;
  /** Variables advertised to the editor (path / type / description). */
  variables: VariableInfo[];
  /** The example data the preview renders against, shown via ExampleData. */
  example: unknown;
  /** Most recent live-preview result for the active notify channel,
   *  or undefined for action providers. */
  preview?: PreviewPayload;
  previewLoading?: boolean;
}

/** Mirrors `editors/liquidMonaco#VariableInfo`. Defined here too so the
 *  context shape stays self-contained for provider authors. */
export interface VariableInfo {
  path: string;
  type: string;
  description?: string;
}

/** The render-time preview payload returned by `automation.previewTemplate`. */
export type PreviewPayload =
  | {
      channel: "email";
      subject: string;
      html: string;
      usedDefault: boolean;
      missingVariables: string[];
      errors: string[];
    }
  | {
      channel: "slack";
      payload: { text: string } | { blocks: Record<string, unknown>[] };
      usedDefault: boolean;
      missingVariables: string[];
      errors: string[];
    };

/** The "client" definition (`client.tsx`) — UI + slice helpers. */
export interface ClientDef<S = unknown> {
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
  readonly ConfigForm: ComponentType<ConfigFormProps<S>>;
}

export interface ConfigFormProps<S> {
  slice: S;
  onChange: (next: S) => void;
  ctx: ConfigFormCtx;
}

/** Notify-specific client additions. */
export interface NotifyClientDef<S = unknown> extends ClientDef<S> {
  /** The channel string the preview/testFire endpoints accept. */
  readonly channel: "email" | "slack";
  /** Recipients / webhook for the test-fire mutation. */
  testFireTarget(slice: S): { recipients: string[]; webhook: string | null };
  /** Template strings contributed to the save payload (`templates`). */
  templatesFromSlice(slice: S): TemplateDraft;
}

/** The "server" definition (`server.ts`). Stage A keeps this minimal —
 *  just the discriminator and forwarding hooks to existing senders.
 *  Stage B will move the dispatch bodies in and add `dispatch(...)` and
 *  `testFire(...)` methods here. */
export interface ServerDef {
  readonly action: TriggerAction;
}

// ---- Registry entries ---------------------------------------------------

export interface ClientEntry<S = unknown> {
  shared: SharedDef;
  client: ClientDef<S> | NotifyClientDef<S>;
}

export interface NotifyClientEntry<S = unknown> extends ClientEntry<S> {
  shared: SharedDef & { category: "notify" };
  client: NotifyClientDef<S>;
}

export interface ServerEntry {
  shared: SharedDef;
  server: ServerDef;
}

export function isNotifyEntry(entry: ClientEntry): entry is NotifyClientEntry {
  return entry.shared.category === "notify";
}
