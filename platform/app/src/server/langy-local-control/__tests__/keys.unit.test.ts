/**
 * The Redis key family of local control.
 *
 * Two properties are worth a test rather than a reading: every key carries the
 * shape version, so a later layout cannot read this one's keys, and every key
 * that belongs to one conversation names it, so a folder shared with one chat
 * can never be reached through another.
 *
 * @see specs/langy/langy-local-control.feature
 */
import { describe, expect, it } from "vitest";
import {
  callKey,
  callResultKey,
  controlRequestClaimKey,
  controlRequestKey,
  pendingCallsKey,
  policyKey,
  presenceKey,
  sessionKeyBindingKey,
  turnWaitsKey,
  userRequestsKey,
  waitKey,
  workspaceChannel,
} from "../keys";

describe("given the local control key family", () => {
  describe("when a key is built", () => {
    it("carries the shape version so a later layout reads none of them", () => {
      const keys = [
        presenceKey("conv_1"),
        policyKey("conv_1"),
        controlRequestKey("lcr_1"),
        controlRequestClaimKey("lcr_1"),
        userRequestsKey("proj_1", "user_1"),
        sessionKeyBindingKey("key_1"),
        callKey("lcall_1"),
        callResultKey("lcall_1"),
        pendingCallsKey("conv_1"),
        waitKey("lwait_1"),
        turnWaitsKey("conv_1", "turn_1"),
        workspaceChannel("conv_1"),
      ];

      for (const key of keys) expect(key).toMatch(/^langy_local:v1:/);
    });
  });

  describe("when the key belongs to one conversation", () => {
    it("names that conversation, so another chat addresses another key", () => {
      expect(presenceKey("conv_a")).not.toEqual(presenceKey("conv_b"));
      expect(policyKey("conv_a")).not.toEqual(policyKey("conv_b"));
      expect(pendingCallsKey("conv_a")).not.toEqual(pendingCallsKey("conv_b"));
      expect(workspaceChannel("conv_a")).not.toEqual(
        workspaceChannel("conv_b"),
      );
      expect(turnWaitsKey("conv_a", "turn_1")).not.toEqual(
        turnWaitsKey("conv_b", "turn_1"),
      );
    });
  });

  describe("when two users hold requests in one project", () => {
    it("keeps each person's open requests under their own key", () => {
      expect(userRequestsKey("proj_1", "user_a")).not.toEqual(
        userRequestsKey("proj_1", "user_b"),
      );
    });
  });
});
