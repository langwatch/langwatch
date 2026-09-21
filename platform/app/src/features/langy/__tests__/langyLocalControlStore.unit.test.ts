/**
 * The live half of local control (ADR-129): what the stream may say about a
 * card, and what the reader's own answer says over it.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { useLangyLocalControlStore } from "../stores/langyLocalControlStore";

const live = (over: Record<string, unknown> = {}) => ({
  waitId: "wait-1",
  kind: "permission" as const,
  status: "pending" as const,
  summary: "uv sync",
  ...over,
});

beforeEach(() => {
  useLangyLocalControlStore.getState().reset("conv-1");
});

describe("settleWait", () => {
  describe("given a card this stream never carried", () => {
    /** @scenario "My answer settles the card before the record catches up" */
    it("records the answer anyway, because the record has not caught up", () => {
      useLangyLocalControlStore
        .getState()
        .settleWait({ waitId: "wait-7", status: "answered" });

      expect(
        useLangyLocalControlStore.getState().waits["wait-7"],
      ).toMatchObject({
        waitId: "wait-7",
        kind: "permission",
        status: "answered",
      });
    });
  });

  describe("given a question card", () => {
    it("keeps the kind the answer belonged to", () => {
      useLangyLocalControlStore
        .getState()
        .settleWait({ waitId: "wait-q", kind: "question", status: "answered" });

      expect(useLangyLocalControlStore.getState().waits["wait-q"]?.kind).toBe(
        "question",
      );
    });
  });
});

describe("recordWait", () => {
  describe("given the stream replays the entry that raised the card", () => {
    /** @scenario "My answer settles the card before the record catches up" */
    it("keeps the card settled", () => {
      const store = useLangyLocalControlStore.getState();
      store.recordWait({ conversationId: "conv-1", wait: live() });
      store.settleWait({ waitId: "wait-1", status: "answered" });
      store.recordWait({ conversationId: "conv-1", wait: live() });

      expect(
        useLangyLocalControlStore.getState().waits["wait-1"],
      ).toMatchObject({ status: "answered", summary: "uv sync" });
    });
  });

  describe("given an entry for another conversation", () => {
    it("drops it, because nobody is reading that one", () => {
      useLangyLocalControlStore
        .getState()
        .recordWait({ conversationId: "conv-2", wait: live() });

      expect(useLangyLocalControlStore.getState().waits).toEqual({});
    });
  });
});
