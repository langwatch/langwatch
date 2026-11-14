import { describe, expect, it } from "vitest";

import { dataRetentionTrpc } from "../data-retention.trpc.ts";
import {
  RETROACTIVE_APPLY_REQUESTED_EVENT_TYPE,
  RETROACTIVE_CANCEL_REQUESTED_EVENT_TYPE,
  RETROACTIVE_PROGRESS_RECORDED_EVENT_TYPE,
} from "../retroactive-retention.events.ts";

describe("getMutationProgress", () => {
  /** @scenario "The progress read is refreshed by read hints" */
  it("names the apply, cancel and progress facts as what makes it stale", () => {
    expect(dataRetentionTrpc.members.getMutationProgress.invalidatedBy).toEqual([
      RETROACTIVE_APPLY_REQUESTED_EVENT_TYPE,
      RETROACTIVE_CANCEL_REQUESTED_EVENT_TYPE,
      RETROACTIVE_PROGRESS_RECORDED_EVENT_TYPE,
    ]);
  });
});
