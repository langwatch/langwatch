/**
 * Langy's ids are KSUIDs with a resource prefix. Ids minted before that, under the old
 * nanoid and UUID schemes, still name the same things everywhere an id is read back.
 */
import { generate } from "@langwatch/ksuid";
import {
  cancelFrameSchema,
  langyAnswerLocalPermissionInputSchema,
  langyClaimUiActionInputSchema,
  langyInternalTurnParamsSchema,
  langyLocalCallIdParamsSchema,
} from "@langwatch/langy-contract";
import { describe, expect, it } from "vitest";

import { LANGY_ID_RESOURCES } from "../eventing/langy-conversation-process.schemas.ts";
import { blankUserWait } from "../rules/langy-local-user-wait-record.rules.ts";

const minted = (resource: keyof typeof LANGY_ID_RESOURCES) =>
  generate(LANGY_ID_RESOURCES[resource]).toString();

const LEGACY = {
  call: "lcall_V1StGXR8_Z5jdHi6B-myT",
  wait: "lwait_V1StGXR8_Z5jdHi6B-myT",
  turn: "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
  uiAction: "V1StGXR8_Z5jdHi6B-myT",
};

describe("langy ids", () => {
  describe("when a new id is minted", () => {
    it("names its resource in the prefix", () => {
      expect(minted("call")).toMatch(/(^|_)langycall_[A-Za-z0-9]{29}$/);
      expect(minted("wait")).toMatch(/(^|_)langywait_[A-Za-z0-9]{29}$/);
      expect(minted("turn")).toMatch(/(^|_)langyturn_[A-Za-z0-9]{29}$/);
    });
  });

  describe("when an id minted under the old schemes is read back", () => {
    it.each([
      ["legacy", LEGACY.call],
      ["ksuid", minted("call")],
    ])("accepts a %s call id in the poll path and the cancel frame", (_, callId) => {
      expect(langyLocalCallIdParamsSchema.parse({ callId }).callId).toBe(callId);
      expect(cancelFrameSchema.shape.callId.parse(callId)).toBe(callId);
    });

    it.each([
      ["legacy", LEGACY.wait],
      ["ksuid", minted("wait")],
    ])("accepts a %s wait id when a permission is answered", (_, waitId) => {
      expect(langyAnswerLocalPermissionInputSchema.shape.waitId.parse(waitId)).toBe(waitId);
      expect(
        blankUserWait({
          waitId,
          now: 0,
          projectId: "project_1",
          conversationId: "conversation_1",
          turnId: LEGACY.turn,
          kind: "permission",
          budgetMs: 1_000,
        }).waitId,
      ).toBe(waitId);
    });

    it.each([
      ["legacy", LEGACY.turn],
      ["ksuid", minted("turn")],
    ])("accepts a %s turn id in the internal turn path", (_, turnId) => {
      expect(langyInternalTurnParamsSchema.parse({ turnId }).turnId).toBe(turnId);
    });

    it.each([
      ["legacy", LEGACY.uiAction],
      ["ksuid", minted("uiAction")],
    ])("accepts a %s ui action id when a page claims it", (_, actionId) => {
      expect(langyClaimUiActionInputSchema.shape.actionId.parse(actionId)).toBe(actionId);
    });
  });
});
