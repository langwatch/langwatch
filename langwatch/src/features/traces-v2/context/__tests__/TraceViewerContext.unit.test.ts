import { describe, expect, it } from "vitest";
import { canViewConversation } from "../TraceViewerContext";

describe("canViewConversation", () => {
  describe("when the live drawer requests a conversation", () => {
    it("allows it without a share capability", () => {
      expect(
        canViewConversation({
          conversationId: "thread-1",
          isReadOnly: false,
          sharedThreadId: undefined,
        }),
      ).toBe(true);
    });
  });

  describe("when a read-only share requests a conversation", () => {
    it("allows only the exact granted thread", () => {
      expect(
        canViewConversation({
          conversationId: "thread-1",
          isReadOnly: true,
          sharedThreadId: "thread-1",
        }),
      ).toBe(true);
      expect(
        canViewConversation({
          conversationId: "thread-2",
          isReadOnly: true,
          sharedThreadId: "thread-1",
        }),
      ).toBe(false);
      expect(
        canViewConversation({
          conversationId: "thread-1",
          isReadOnly: true,
          sharedThreadId: null,
        }),
      ).toBe(false);
    });
  });

  describe("when the caller requires a read-only share", () => {
    it("rejects the live drawer and accepts an exact shared thread", () => {
      expect(
        canViewConversation({
          conversationId: "thread-1",
          isReadOnly: false,
          sharedThreadId: undefined,
          shouldRequireReadOnly: true,
        }),
      ).toBe(false);
      expect(
        canViewConversation({
          conversationId: "thread-1",
          isReadOnly: true,
          sharedThreadId: "thread-1",
          shouldRequireReadOnly: true,
        }),
      ).toBe(true);
    });
  });
});
