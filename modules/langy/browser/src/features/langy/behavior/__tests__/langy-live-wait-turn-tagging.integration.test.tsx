/**
 * @vitest-environment jsdom
 *
 * A live question card is recorded against the turn the tab is streaming.
 * @see specs/langy/langy-stop-and-resume.feature
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type TransportDeps = { onLocalWait: (entry: unknown) => void };
const captured: { deps: TransportDeps | null } = { deps: null };

vi.mock("@langwatch/browser-host/use-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@langwatch/feature-flag-client", () => ({
  useFeatureFlag: () => ({ isLoading: false, enabled: true }),
}));
vi.mock("../../../../behavior/langy-api.ts", () => ({
  api: { useUtils: () => ({ client: {}, langy: { messages: { invalidate: vi.fn() } } }) },
}));
// The transport's own wiring is the boundary: the test hands its callbacks the wire entry.
vi.mock("../logic/langy-chat-transport.ts", () => ({
  createLangyChatTransport: (deps: TransportDeps) => {
    captured.deps = deps;
    return {};
  },
}));

const { useLangyStore } = await import("../../../../behavior/langy.store.ts");
const { useLangyLocalControlStore } =
  await import("../../../../behavior/langy-local-control.store.ts");
const { useLangyPanelTransport } = await import("../panel/use-langy-panel-transport.ts");

describe("a question entry on the live stream", () => {
  beforeEach(() => {
    useLangyStore.getState().resetForScope({});
    useLangyLocalControlStore.getState().reset("conv-1");
    useLangyStore.getState().selectConversation("conv-1");
    useLangyStore.getState().beginTurn({ conversationId: "conv-1", turnId: "turn-1" });
  });

  /** @scenario A question card the stream raises is tied to the turn the tab is streaming */
  it("is stored with the turn the tab is streaming", () => {
    renderHook(() => useLangyPanelTransport({ projectId: "proj-1", organizationId: "org-1" }));

    captured.deps?.onLocalWait({
      type: "question",
      waitId: "wait-1",
      toolCallId: "call-q1",
      questions: [],
      status: "pending",
    });

    expect(useLangyLocalControlStore.getState().waits["wait-1"]?.turnId).toBe("turn-1");
  });
});
