// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

/**
 * Governance's workspace-view OCSF mirror outbox (ADR-202 Decided 12): a recorded view appends one
 * intent keyed by its AuditLog row, and the worker writes the OCSF row after commit, so a request
 * holds no ClickHouse write. A daily wake prunes the delivered rows.
 */
export const WORKSPACE_VIEW_MIRROR_PROCESS_NAME = "workspaceViewMirror" as const;
export const WORKSPACE_VIEW_MIRROR_INTENT = "mirrorView" as const;
export const WORKSPACE_VIEW_MIRROR_PRUNE_INTENT = "pruneMirrored" as const;
export const WORKSPACE_VIEW_MIRROR_PROCESS_KEY = "workspace-views";
/** An OCSF insert retries through a ClickHouse outage of about a day. */
export const WORKSPACE_VIEW_MIRROR_MAX_ATTEMPTS = 12;
export const WORKSPACE_VIEW_MIRROR_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;
export const WORKSPACE_VIEW_MIRROR_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const workspaceViewMirrorIntentSchema = z.object({
  auditLogId: z.string().min(1),
  occurredAt: z.number().int(),
  organizationId: z.string().min(1),
  actorUserId: z.string().min(1),
  kind: z.string().min(1),
  targetId: z.string().min(1),
  targetKind: z.string().min(1),
  label: z.string(),
});
export type WorkspaceViewMirrorIntent = z.infer<typeof workspaceViewMirrorIntentSchema>;

export const workspaceViewMirrorPruneSchema = z.object({ scheduledFor: z.number().int() });
export const workspaceViewMirrorStateSchema = z.object({ lastPruneAt: z.number().nullable() });
type WorkspaceViewMirrorState = z.infer<typeof workspaceViewMirrorStateSchema>;
export const WORKSPACE_VIEW_MIRROR_INITIAL_STATE: WorkspaceViewMirrorState = {
  lastPruneAt: null,
};

type WorkspaceViewMirrorIntents = {
  [WORKSPACE_VIEW_MIRROR_INTENT]: IntentSpec<typeof workspaceViewMirrorIntentSchema>;
  [WORKSPACE_VIEW_MIRROR_PRUNE_INTENT]: IntentSpec<typeof workspaceViewMirrorPruneSchema>;
};

/** The one key per AuditLog row: the outbox's dedup identity, as the row id is the OCSF event id. */
export function workspaceViewMirrorKey({ auditLogId }: { auditLogId: string }): string {
  return `workspace-view:${auditLogId}`;
}

export const workspaceViewMirrorPruneWake: WakeHandler<
  WorkspaceViewMirrorState,
  WorkspaceViewMirrorIntents
> = (_state, ctx) => ({
  state: { lastPruneAt: ctx.at },
  intents: [
    ctx.intent(WORKSPACE_VIEW_MIRROR_PRUNE_INTENT, `prune:${ctx.at}`, { scheduledFor: ctx.at }),
  ],
});
