/**
 * @vitest-environment jsdom
 * @see specs/langy/langy-guided-onboarding.feature
 */
import { useLangyStore } from "@langwatch/langy-browser-kit";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useLangyKickoffSend } from "../panel/use-langy-kickoff-send.ts";

const KICKOFF_PART = { type: "guided-onboarding-kickoff", path: "llmops", paths: ["llmops"] };
const BRIEF_PART = { type: "text", text: "Guided onboarding kickoff." };

function render(over: Partial<Parameters<typeof useLangyKickoffSend>[0]> = {}) {
  const sendMessage = vi.fn().mockResolvedValue(undefined);
  const resetEngine = vi.fn();
  const kickoffNamedRef = { current: null as ((id: string) => void) | null };
  const props = {
    projectId: "proj_1",
    isBusy: false,
    isRestoring: false,
    modelQueriesSettled: true,
    langyNeedsModel: false,
    resetEngine,
    resetRecovery: vi.fn(),
    sendMessage,
    kickoffNamedRef,
    ...over,
  };
  const hook = renderHook((p: typeof props) => useLangyKickoffSend(p), { initialProps: props });
  return { hook, props, sendMessage, resetEngine, kickoffNamedRef };
}

beforeEach(() => {
  useLangyStore.setState({ pendingKickoff: null, activeConversationId: null });
});

describe("useLangyKickoffSend", () => {
  describe("given a queued kickoff and an idle panel", () => {
    /** @scenario The panel sends the kickoff exactly once */
    it("consumes the kickoff before it sends and sends nothing on a second render", () => {
      const { hook, props, sendMessage } = render();
      useLangyStore.setState({
        pendingKickoff: { brief: "brief", parts: [KICKOFF_PART, BRIEF_PART] },
      });
      hook.rerender(props);

      expect(useLangyStore.getState().pendingKickoff).toBeNull();
      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(sendMessage).toHaveBeenCalledWith({ role: "user", parts: [KICKOFF_PART, BRIEF_PART] });

      hook.rerender({ ...props });
      expect(sendMessage).toHaveBeenCalledTimes(1);
    });

    /** @scenario The panel attaches a fresh kickoff conversation to the organization */
    it("hands the caller's callback to the transport for a fresh conversation only", () => {
      const named = vi.fn();
      const { hook, props, kickoffNamedRef, resetEngine } = render();
      useLangyStore.setState({ pendingKickoff: { brief: "brief", onConversationNamed: named } });
      hook.rerender(props);

      expect(resetEngine).toHaveBeenCalledWith({ clearMessages: true });
      expect(kickoffNamedRef.current).toBe(named);
    });

    it("keeps the attached conversation and names nothing", () => {
      const named = vi.fn();
      const { hook, props, kickoffNamedRef, resetEngine } = render();
      useLangyStore.setState({
        pendingKickoff: { brief: "brief", conversationId: "conv_1", onConversationNamed: named },
      });
      hook.rerender(props);

      expect(resetEngine).not.toHaveBeenCalled();
      expect(kickoffNamedRef.current).toBeNull();
    });

    it("sends the brief as one text part when the caller gave no parts", () => {
      const { hook, props, sendMessage } = render();
      useLangyStore.setState({ pendingKickoff: { brief: "just words" } });
      hook.rerender(props);

      expect(sendMessage).toHaveBeenCalledWith({
        role: "user",
        parts: [{ type: "text", text: "just words" }],
      });
    });
  });

  describe("given the panel cannot send yet", () => {
    it.each([
      ["busy", { isBusy: true }],
      ["restoring a conversation", { isRestoring: true }],
      ["waiting on the model reads", { modelQueriesSettled: false }],
      ["waiting for a model to be picked", { langyNeedsModel: true }],
    ])("holds the kickoff while %s", (_name, over) => {
      const { hook, props, sendMessage } = render(over);
      useLangyStore.setState({ pendingKickoff: { brief: "brief" } });
      hook.rerender(props);

      expect(sendMessage).not.toHaveBeenCalled();
      expect(useLangyStore.getState().pendingKickoff).not.toBeNull();
    });
  });
});
