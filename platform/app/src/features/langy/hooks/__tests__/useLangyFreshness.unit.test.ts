/**
 * @vitest-environment jsdom
 *
 * The freshness coordinator's contract: the broadcast signal is ID-ONLY, so a
 * signal naming the OPEN conversation must invalidate its `langy.messages`
 * query (the durable fold the panel re-hydrates from) — the only wake-up a tab
 * with no live turn stream gets for a turn it did not initiate. The recents
 * list always refetches through the server visibility gate.
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LangyConversationUpdateSignal } from "../../data/langy.dtos";

const PROJECT_ID = "project_test";

const messagesInvalidate = vi.fn(() => Promise.resolve());
const listInvalidate = vi.fn(() => Promise.resolve());
const listCancel = vi.fn(() => Promise.resolve());

// Capture the callback the hook hands to the SSE listener so a test can drive a
// signal batch through the real hook logic.
let capturedOnUpdate:
  | ((signals: LangyConversationUpdateSignal[]) => void)
  | null = null;

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: PROJECT_ID } }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({
      langy: {
        messages: { invalidate: messagesInvalidate },
        list: { cancel: listCancel, invalidate: listInvalidate },
      },
    }),
  },
}));

vi.mock("../useLangyConversationUpdateListener", () => ({
  useLangyConversationUpdateListener: (opts: {
    onConversationUpdated: (s: LangyConversationUpdateSignal[]) => void;
  }) => {
    capturedOnUpdate = opts.onConversationUpdated;
  },
}));

import { useLangyFreshness } from "../useLangyFreshness";

const signal = (conversationId: string): LangyConversationUpdateSignal =>
  ({ conversationId }) as LangyConversationUpdateSignal;

describe("useLangyFreshness", () => {
  beforeEach(() => {
    messagesInvalidate.mockClear();
    listInvalidate.mockClear();
    listCancel.mockClear();
    capturedOnUpdate = null;
  });

  describe("given a conversation is open", () => {
    describe("when a signal names the open conversation", () => {
      it("invalidates that conversation's messages", () => {
        renderHook(() => useLangyFreshness("conv_open"));
        capturedOnUpdate?.([signal("conv_open")]);

        expect(messagesInvalidate).toHaveBeenCalledWith({
          projectId: PROJECT_ID,
          conversationId: "conv_open",
        });
      });

      it("also refetches the recents list", () => {
        renderHook(() => useLangyFreshness("conv_open"));
        capturedOnUpdate?.([signal("conv_open")]);

        expect(listCancel).toHaveBeenCalledTimes(1);
        expect(listInvalidate).toHaveBeenCalledTimes(1);
      });
    });

    describe("when a signal names a different conversation", () => {
      it("does not invalidate the open conversation's messages", () => {
        renderHook(() => useLangyFreshness("conv_open"));
        capturedOnUpdate?.([signal("conv_other")]);

        expect(messagesInvalidate).not.toHaveBeenCalled();
      });

      it("still refetches the recents list", () => {
        renderHook(() => useLangyFreshness("conv_open"));
        capturedOnUpdate?.([signal("conv_other")]);

        expect(listCancel).toHaveBeenCalledTimes(1);
        expect(listInvalidate).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("given no conversation is open", () => {
    describe("when a signal arrives", () => {
      it("refetches the list without invalidating any messages", () => {
        renderHook(() => useLangyFreshness(null));
        capturedOnUpdate?.([signal("conv_any")]);

        expect(messagesInvalidate).not.toHaveBeenCalled();
        expect(listCancel).toHaveBeenCalledTimes(1);
        expect(listInvalidate).toHaveBeenCalledTimes(1);
      });
    });
  });
});
