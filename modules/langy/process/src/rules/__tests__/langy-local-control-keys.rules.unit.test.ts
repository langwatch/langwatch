/**
 * Redis key family for local control: every key embeds the shape version and
 * its conversation id, so stale layouts and other chats can't cross-read.
 * @see specs/langy/langy-local-control.feature
 */
import { describe, expect, it } from "vitest";

import {
  callKeepaliveKey,
  callKey,
  callResultKey,
  controlRequestClaimKey,
  controlRequestKey,
  owedConnectTurnKey,
  pendingCallsKey,
  policyKey,
  presenceKey,
  sessionKeyBindingKey,
  turnWaitsKey,
  userRequestsKey,
  waitKey,
  workspaceChannel,
} from "../langy-local-control-keys.rules.ts";

describe("given the local control key family", () => {
  describe("when a key is built", () => {
    it("carries the shape version so a later layout reads none of them", () => {
      const keys = [
        presenceKey("conv_1"),
        policyKey("conv_1"),
        controlRequestKey("lcr_1"),
        controlRequestClaimKey("lcr_1"),
        userRequestsKey("user_1"),
        owedConnectTurnKey("conv_1"),
        sessionKeyBindingKey("key_1"),
        callKey("lcall_1"),
        callResultKey("lcall_1"),
        callKeepaliveKey("lcall_1"),
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
      expect(workspaceChannel("conv_a")).not.toEqual(workspaceChannel("conv_b"));
      expect(turnWaitsKey("conv_a", "turn_1")).not.toEqual(turnWaitsKey("conv_b", "turn_1"));
    });
  });

  describe("when two users hold requests", () => {
    it("keeps each person's open requests under their own key", () => {
      expect(userRequestsKey("user_a")).not.toEqual(userRequestsKey("user_b"));
    });
  });

  describe("when a folder is owed a connect turn", () => {
    it("names the conversation, so another chat owes none of it", () => {
      expect(owedConnectTurnKey("conv_a")).not.toEqual(owedConnectTurnKey("conv_b"));
    });
  });
});
