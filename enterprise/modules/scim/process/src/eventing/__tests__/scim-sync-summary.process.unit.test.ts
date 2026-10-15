// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { JsonValue } from "@langwatch/eventing";
import { intentAccessorOf } from "@langwatch/eventing/testing";
import { describe, expect, it, vi } from "vitest";

import {
  SCIM_SYNC_SUMMARY_INITIAL_STATE,
  SCIM_SYNC_SUMMARY_MAX_BURST_MS,
  SCIM_SYNC_SUMMARY_QUIET_MS,
  scimSyncSummaryApplyFailed,
  scimSyncSummaryUserPushed,
  scimSyncSummaryWake,
} from "../scim-sync-summary.process.ts";

const ORGANIZATION = "organization_acme";
const T0 = 1_760_000_000_000;
const MINUTE = 60 * 1000;
const identity = { scimSyncId: "okta", connectionId: "okta", organizationId: ORGANIZATION };

function context(at: number) {
  const post = vi.fn((messageKey: string, payload: JsonValue) => ({
    messageKey,
    intentType: "post",
    payload,
  }));
  return {
    post,
    ctx: {
      at,
      now: at,
      key: ORGANIZATION,
      projectId: ORGANIZATION,
      intent: intentAccessorOf({ post }),
    },
  };
}

function pushed(op: "create" | "update" | "deactivate", userId: string, changed?: boolean) {
  return {
    ...identity,
    userId,
    externalId: `ext-${userId}`,
    op,
    ...(changed === undefined ? {} : { changed }),
  };
}

const failure = {
  ...identity,
  op: "push_user" as const,
  errorCode: "grant_failed",
  retryable: true,
  userId: "user_eve",
};

describe("the SCIM push summary process", () => {
  /** @scenario "A quiet push posts one card with its counts" */
  it("posts one summary with every count once the push goes quiet", () => {
    let state = SCIM_SYNC_SUMMARY_INITIAL_STATE;
    state = scimSyncSummaryUserPushed(state, pushed("create", "user_ada"), context(T0).ctx).state;
    state = scimSyncSummaryUserPushed(
      state,
      pushed("update", "user_bob", true),
      context(T0).ctx,
    ).state;
    state = scimSyncSummaryUserPushed(
      state,
      pushed("deactivate", "user_cy"),
      context(T0).ctx,
    ).state;
    const last = scimSyncSummaryApplyFailed(state, failure, context(T0 + 1000).ctx);
    expect(last.nextWakeAt).toBe(T0 + 1000 + SCIM_SYNC_SUMMARY_QUIET_MS);

    const { post, ctx } = context(T0 + 1000 + SCIM_SYNC_SUMMARY_QUIET_MS);
    const woken = scimSyncSummaryWake(last.state, ctx);

    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(`summary:${T0}`, {
      organizationId: ORGANIZATION,
      added: 1,
      updated: 1,
      deactivated: 1,
      failed: 1,
      addedUserIds: ["user_ada"],
    });
    expect(woken).toMatchObject({ state: SCIM_SYNC_SUMMARY_INITIAL_STATE, nextWakeAt: null });
  });

  /** @scenario "A restated person is not a change" */
  it("opens no push and arms no wake for a person restated as we hold them", () => {
    const evolved = scimSyncSummaryUserPushed(
      SCIM_SYNC_SUMMARY_INITIAL_STATE,
      pushed("update", "user_bob", false),
      context(T0).ctx,
    );

    expect(evolved).toEqual({ state: SCIM_SYNC_SUMMARY_INITIAL_STATE, nextWakeAt: null });
  });

  it("keeps an open push open while restated people still arrive, without counting them", () => {
    const opened = scimSyncSummaryUserPushed(
      SCIM_SYNC_SUMMARY_INITIAL_STATE,
      pushed("create", "user_ada"),
      context(T0).ctx,
    );
    const restated = scimSyncSummaryUserPushed(
      opened.state,
      pushed("update", "user_bob", false),
      context(T0 + MINUTE).ctx,
    );

    expect(restated.state).toMatchObject({ added: 1, updated: 0 });
    expect(restated.nextWakeAt).toBe(T0 + MINUTE + SCIM_SYNC_SUMMARY_QUIET_MS);
  });

  /** @scenario "A burst still going is not posted yet" */
  it("re-arms instead of posting when a request came after the wake was set", () => {
    const first = scimSyncSummaryUserPushed(
      SCIM_SYNC_SUMMARY_INITIAL_STATE,
      pushed("create", "user_ada"),
      context(T0).ctx,
    );
    const second = scimSyncSummaryUserPushed(
      first.state,
      pushed("create", "user_bob"),
      context(T0 + 2 * MINUTE).ctx,
    );

    const { post, ctx } = context(T0 + SCIM_SYNC_SUMMARY_QUIET_MS);
    const woken = scimSyncSummaryWake(second.state, ctx);

    expect(post).not.toHaveBeenCalled();
    expect(woken.nextWakeAt).toBe(T0 + 2 * MINUTE + SCIM_SYNC_SUMMARY_QUIET_MS);
    expect(woken.state).toEqual(second.state);
  });

  /** @scenario "A push is posted once even when woken twice" */
  it("posts nothing on a second wake after the summary went out", () => {
    const opened = scimSyncSummaryUserPushed(
      SCIM_SYNC_SUMMARY_INITIAL_STATE,
      pushed("create", "user_ada"),
      context(T0).ctx,
    );
    const firstWake = scimSyncSummaryWake(
      opened.state,
      context(T0 + SCIM_SYNC_SUMMARY_QUIET_MS).ctx,
    );

    const { post, ctx } = context(T0 + SCIM_SYNC_SUMMARY_QUIET_MS + 1);
    const secondWake = scimSyncSummaryWake(firstWake.state, ctx);

    expect(post).not.toHaveBeenCalled();
    expect(secondWake).toMatchObject({ state: SCIM_SYNC_SUMMARY_INITIAL_STATE, nextWakeAt: null });
  });

  it("reads a push recorded before the change flag existed as a change", () => {
    const evolved = scimSyncSummaryUserPushed(
      SCIM_SYNC_SUMMARY_INITIAL_STATE,
      pushed("update", "user_bob"),
      context(T0).ctx,
    );

    expect(evolved.state).toMatchObject({ updated: 1, burstStartedAt: T0 });
  });

  /** @scenario "A burst that never goes quiet is posted after 30 minutes" */
  it("posts at the cap while requests keep coming, then starts a fresh burst", () => {
    let state = SCIM_SYNC_SUMMARY_INITIAL_STATE;
    let nextWakeAt: number | null | undefined = null;
    for (let at = T0; at < T0 + SCIM_SYNC_SUMMARY_MAX_BURST_MS; at += MINUTE) {
      ({ state, nextWakeAt } = scimSyncSummaryUserPushed(
        state,
        pushed("create", `user_${at}`),
        context(at).ctx,
      ));
    }
    expect(nextWakeAt).toBe(T0 + SCIM_SYNC_SUMMARY_MAX_BURST_MS);

    const { post, ctx } = context(T0 + SCIM_SYNC_SUMMARY_MAX_BURST_MS);
    const capped = scimSyncSummaryWake(state, ctx);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]?.[1]).toMatchObject({ added: 30 });
    expect(capped).toMatchObject({ state: SCIM_SYNC_SUMMARY_INITIAL_STATE, nextWakeAt: null });

    const next = T0 + SCIM_SYNC_SUMMARY_MAX_BURST_MS + 1000;
    const fresh = scimSyncSummaryUserPushed(
      capped.state,
      pushed("create", "user_z"),
      context(next).ctx,
    );
    expect(fresh.state).toMatchObject({ added: 1, burstStartedAt: next });
  });
});
