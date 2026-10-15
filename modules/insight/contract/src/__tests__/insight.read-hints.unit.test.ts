/**
 * The inbox follows its insights through read hints, not a poll: a renewal by a run changes
 * what a row says, so it must make the inbox read stale like a filing does.
 * @see modules/insight/specs/insight-daily-run.feature
 */

import { describe, expect, it } from "vitest";

import { INSIGHT_EVENT_TYPES } from "../insight.constants.ts";
import { insightTrpc } from "../insight.trpc.ts";

describe("given the inbox read's list of events that make it stale", () => {
  /** @scenario "A renewal refetches the person's inbox" */
  it("names the renewed event beside filed, seen, archived and kept", () => {
    expect(insightTrpc.members.getAll.invalidatedBy).toEqual([
      INSIGHT_EVENT_TYPES.FILED,
      INSIGHT_EVENT_TYPES.RENEWED,
      INSIGHT_EVENT_TYPES.SEEN,
      INSIGHT_EVENT_TYPES.ARCHIVED,
      INSIGHT_EVENT_TYPES.KEPT,
    ]);
  });
});
