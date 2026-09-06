import { describe, expect, it } from "vitest";
import {
  canUserSeeLangyConversationUpdate,
  isLangyConversationUpdateVisibleToUser,
} from "../langyConversationUpdateVisibility";

/** Build a raw freshness broadcast payload string as the subscriber emits it. */
function makePayload(fields: {
  ownerUserId?: unknown;
  isShared?: unknown;
  conversationId?: string;
}): string {
  return JSON.stringify({
    event: "langy_conversation_updated",
    conversationId: fields.conversationId ?? "conv-1",
    status: "running",
    messageCount: 3,
    lastActivityAtMs: 1_700_000_000_000,
    isRunning: true,
    ownerUserId: fields.ownerUserId,
    isShared: fields.isShared,
  });
}

describe("langy conversation update visibility gate", () => {
  describe("given a private conversation (not shared)", () => {
    describe("when the subscribing user is the owner", () => {
      it("allows the signal through", () => {
        const payload = makePayload({
          ownerUserId: "user-owner",
          isShared: false,
        });
        expect(
          isLangyConversationUpdateVisibleToUser({
            eventPayload: payload,
            userId: "user-owner",
          }),
        ).toBe(true);
      });
    });

    describe("when the subscribing user is NOT the owner", () => {
      it("refuses the signal", () => {
        const payload = makePayload({
          ownerUserId: "user-owner",
          isShared: false,
        });
        expect(
          isLangyConversationUpdateVisibleToUser({
            eventPayload: payload,
            userId: "user-intruder",
          }),
        ).toBe(false);
      });
    });
  });

  describe("given a shared conversation", () => {
    describe("when the subscribing user is a non-owner project member", () => {
      it("allows the signal through (shared with the project)", () => {
        const payload = makePayload({
          ownerUserId: "user-owner",
          isShared: true,
        });
        expect(
          isLangyConversationUpdateVisibleToUser({
            eventPayload: payload,
            userId: "user-recipient",
          }),
        ).toBe(true);
      });
    });
  });

  describe("given a malformed or under-specified payload", () => {
    describe("when the payload is not valid JSON", () => {
      it("fails closed and refuses", () => {
        expect(
          isLangyConversationUpdateVisibleToUser({
            eventPayload: "not-json{",
            userId: "user-1",
          }),
        ).toBe(false);
      });
    });

    describe("when the payload is not a string", () => {
      it("fails closed and refuses", () => {
        expect(
          isLangyConversationUpdateVisibleToUser({
            eventPayload: { ownerUserId: "user-1" },
            userId: "user-1",
          }),
        ).toBe(false);
      });
    });

    describe("when the owner identity is missing and it is not shared", () => {
      it("fails closed and refuses", () => {
        const payload = makePayload({
          ownerUserId: undefined,
          isShared: false,
        });
        expect(
          isLangyConversationUpdateVisibleToUser({
            eventPayload: payload,
            userId: "user-1",
          }),
        ).toBe(false);
      });
    });
  });

  describe("canUserSeeLangyConversationUpdate (parsed predicate)", () => {
    describe("when owner matches", () => {
      it("allows", () => {
        expect(
          canUserSeeLangyConversationUpdate({
            ownerUserId: "u1",
            isShared: false,
            userId: "u1",
          }),
        ).toBe(true);
      });
    });

    describe("when owner differs and not shared", () => {
      it("refuses", () => {
        expect(
          canUserSeeLangyConversationUpdate({
            ownerUserId: "u1",
            isShared: false,
            userId: "u2",
          }),
        ).toBe(false);
      });
    });
  });
});
