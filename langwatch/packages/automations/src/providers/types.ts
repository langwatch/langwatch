import type { AlertType, TriggerAction } from "../enums";
import type { ZodTypeAny } from "zod";

/**
 * Cross-side vocabulary for the automation provider system. A provider is
 * one action type expressed as three peers, one per runtime:
 *
 *   @langwatch/automations/providers/<name> — metadata + Zod schema for
 *     actionParams. Pure data + Zod; no React, no server-only deps.
 *
 *   ~/features/automations/providers/<name>/client.tsx — the UI half.
 *
 *   ~/server/app-layer/automations/providers/<name>/server.ts — persistence
 *     and dispatch hooks (secret handling lives here, never on the client).
 *
 * The per-side registries pair each shared definition with its side-specific
 * peer as `Record<TriggerAction, ...>`. The orchestrator + drawer never know
 * which concrete action they're looking at; adding a new action type is one
 * file per side + one registry line per side.
 */

export type Category = "notify" | "action";

/** A saved Trigger row as it crosses the wire — everything a provider might
 *  want to read when hydrating from a saved trigger. Templates live at the
 *  row root (not inside `actionParams`) because they are notify-only
 *  top-level columns; the row shape mirrors the Prisma `Trigger` model. */
export interface SavedTriggerRow {
  id: string;
  name: string;
  alertType: AlertType | null;
  action: TriggerAction;
  actionParams: unknown;
  emailSubjectTemplate: string | null;
  emailBodyTemplate: string | null;
  slackTemplate: string | null;
  // Raw persisted column (Prisma `String?`); `fromTriggerRow` narrows it to
  // SlackTemplateTypeColumn when building the draft.
  slackTemplateType: string | null;
}

/** The persisted shape of the Trigger row's `slackTemplateType` column —
 *  plain text, a Block Kit JSON layout, or null for non-Slack rows / legacy
 *  rows that predate the toggle. Declared inline so this shared types layer
 *  stays channel-agnostic (it never imports a concrete channel provider);
 *  the Slack provider derives the same union from its Zod enum. */
export type SlackTemplateTypeColumn = "string" | "block_kit" | null;

/** The four template columns notify providers contribute on save. */
export interface TemplateDraft {
  emailSubjectTemplate: string | null;
  emailBodyTemplate: string | null;
  slackTemplate: string | null;
  slackTemplateType: SlackTemplateTypeColumn;
}

/** The shared definition — must be safe to import on both the client and
 *  the server. */
export interface SharedDef {
  /** Discriminator stored on the Trigger row. */
  readonly action: TriggerAction;
  /** Drives notify-only UI affordances (cadence, test fire, templates). */
  readonly category: Category;
  /** Human label, e.g. "Slack". */
  readonly label: string;
  /** One-line marketing-ish description shown under the icon in the picker. */
  readonly description: string;
  /** Alert-flavoured variant of `description`, shown when the draft is a
   *  graph alert (which fires once when a metric crosses a threshold, not
   *  per trace). Omit when the trace description reads fine for both. */
  readonly alertDescription?: string;
  /** Zod schema for the `actionParams` JSON column. Used by the upsert
   *  route to validate input before persisting. */
  readonly actionParamsSchema: ZodTypeAny;
}

/** Channel-agnostic envelope every render-time preview carries. Provider
 *  shared files extend this with their own body (subject/html, payload, …).
 *  The shared types layer never names a concrete channel. */
export interface PreviewEnvelope {
  usedDefault: boolean;
  missingVariables: string[];
  errors: string[];
}
