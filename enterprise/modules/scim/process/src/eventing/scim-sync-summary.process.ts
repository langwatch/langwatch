// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * One summary card per directory push. SCIM has no push boundary, so a push is a burst of one
 * organization's requests that has gone quiet; spec: specs/scim-sync-summary.feature.
 */
import type {
  ScimApplyFailedPayloadSchema,
  ScimUserPushedPayloadSchema,
} from "@langwatch/enterprise-scim-contract";
import type { EventHandler, IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

export const SCIM_SYNC_SUMMARY_PROCESS_NAME = "scimSyncSummary";

/**
 * Directories send a push's requests seconds apart and Entra's cycles come about 40 minutes
 * apart, so three quiet minutes ends a push without merging two, and the card is never late.
 */
export const SCIM_SYNC_SUMMARY_QUIET_MS = 3 * 60 * 1000;

/** A directory that never goes quiet still gets a card every 30 minutes; the next starts afresh. */
export const SCIM_SYNC_SUMMARY_MAX_BURST_MS = 30 * 60 * 1000;

/** The card names three; two spare cover a person whose name cannot be read. */
const ADDED_PEOPLE_KEPT = 5;

export const scimSyncSummaryStateSchema = z.object({
  added: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  deactivated: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  addedUserIds: z.array(z.string()),
  burstStartedAt: z.number().nullable(),
  lastHeardAt: z.number().nullable(),
});
type ScimSyncSummaryState = z.infer<typeof scimSyncSummaryStateSchema>;

export const SCIM_SYNC_SUMMARY_INITIAL_STATE: ScimSyncSummaryState = {
  added: 0,
  updated: 0,
  deactivated: 0,
  failed: 0,
  addedUserIds: [],
  burstStartedAt: null,
  lastHeardAt: null,
};

export const scimSyncSummaryIntentSchema = z.object({
  organizationId: z.string().min(1),
  added: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  deactivated: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  addedUserIds: z.array(z.string()),
});
export type ScimSyncSummary = z.infer<typeof scimSyncSummaryIntentSchema>;

type ScimSyncSummaryIntents = {
  post: IntentSpec<typeof scimSyncSummaryIntentSchema>;
};

/** Heard from the directory at `heardAt`: the burst stays open three more quiet minutes. */
function heard(
  state: ScimSyncSummaryState,
  heardAt: number,
): { state: ScimSyncSummaryState; nextWakeAt: number } {
  const burstStartedAt = state.burstStartedAt ?? heardAt;
  return {
    state: { ...state, burstStartedAt, lastHeardAt: heardAt },
    nextWakeAt: dueAt({ burstStartedAt, lastHeardAt: heardAt }),
  };
}

/** When the card is due: three quiet minutes, or the burst's cap, whichever comes first. */
function dueAt({
  burstStartedAt,
  lastHeardAt,
}: {
  burstStartedAt: number;
  lastHeardAt: number;
}): number {
  return Math.min(
    lastHeardAt + SCIM_SYNC_SUMMARY_QUIET_MS,
    burstStartedAt + SCIM_SYNC_SUMMARY_MAX_BURST_MS,
  );
}

/** A restated person keeps an open burst open and opens none: Entra's re-sends post nothing. */
export const scimSyncSummaryUserPushed: EventHandler<
  ScimSyncSummaryState,
  z.output<ScimUserPushedPayloadSchema>,
  ScimSyncSummaryIntents
> = (state, data, ctx) => {
  const heardAt = Math.max(ctx.at, ctx.now);
  if (data.changed === false) {
    return state.burstStartedAt === null ? { state, nextWakeAt: null } : heard(state, heardAt);
  }
  if (data.op === "update") return heard({ ...state, updated: state.updated + 1 }, heardAt);
  if (data.op === "deactivate") {
    return heard({ ...state, deactivated: state.deactivated + 1 }, heardAt);
  }
  const addedUserIds =
    state.addedUserIds.length < ADDED_PEOPLE_KEPT
      ? [...state.addedUserIds, data.userId]
      : state.addedUserIds;
  return heard({ ...state, added: state.added + 1, addedUserIds }, heardAt);
};

export const scimSyncSummaryApplyFailed: EventHandler<
  ScimSyncSummaryState,
  z.output<ScimApplyFailedPayloadSchema>,
  ScimSyncSummaryIntents
> = (state, _data, ctx) => heard({ ...state, failed: state.failed + 1 }, Math.max(ctx.at, ctx.now));

/** Posts once the burst is quiet or capped; a wake that comes early re-arms, a second finds nothing. */
export const scimSyncSummaryWake: WakeHandler<ScimSyncSummaryState, ScimSyncSummaryIntents> = (
  state,
  ctx,
) => {
  if (state.burstStartedAt === null || state.lastHeardAt === null) {
    return { state: SCIM_SYNC_SUMMARY_INITIAL_STATE, nextWakeAt: null };
  }
  const due = dueAt({ burstStartedAt: state.burstStartedAt, lastHeardAt: state.lastHeardAt });
  if (ctx.now < due) return { state, nextWakeAt: due };

  const { added, updated, deactivated, failed, addedUserIds } = state;
  return {
    state: SCIM_SYNC_SUMMARY_INITIAL_STATE,
    nextWakeAt: null,
    intents: [
      ctx.intent("post", `summary:${state.burstStartedAt}`, {
        organizationId: ctx.key,
        added,
        updated,
        deactivated,
        failed,
        addedUserIds,
      }),
    ],
  };
};
