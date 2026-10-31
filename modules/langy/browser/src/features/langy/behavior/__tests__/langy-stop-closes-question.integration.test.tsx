/**
 * @vitest-environment jsdom
 *
 * The stop's own answer closes the stopped turn's question card, since Stop aborted the stream.
 * @see specs/langy/langy-stop-and-resume.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { act, cleanup, render, renderHook, screen, within } from "@testing-library/react";
import type { UIMessage } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stopAnswer: { resolve: () => void } = { resolve: () => undefined };

vi.mock("@langwatch/browser-host/use-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "proj-1", slug: "demo" } }),
}));

vi.mock("../../../../behavior/langy-api.ts", () => ({
  api: {
    useUtils: () => ({ langy: { messages: { invalidate: vi.fn() } } }),
    langy: {
      stopTurn: {
        useMutation: () => ({
          mutateAsync: () =>
            new Promise<{ stopped: boolean }>((resolve) => {
              stopAnswer.resolve = () => resolve({ stopped: true });
            }),
        }),
      },
    },
    dashboards: {
      getAll: { useQuery: () => ({ data: [] }) },
      create: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
    graphs: { create: { useMutation: () => ({ mutateAsync: vi.fn() }) } },
  },
}));

const { useLangyStore } = await import("../../../../behavior/langy.store.ts");
const { useLangyLocalControlStore } =
  await import("../../../../behavior/langy-local-control.store.ts");
const { langyQuestionCards } = await import("../../../../model/langy-local-waits.ts");
const { useLangyPanelStop } = await import("../panel/use-langy-panel-stop.ts");
const { MessageContent } = await import("../../ui/sections/message-content.tsx");
const { langyChoicesTimeline } =
  await import("../../../transcript/model/langy-choices-timeline.ts");

/** A question part still waiting on the live stream: no error text, no output. */
function waitingQuestion({ messageId, toolCallId }: { messageId: string; toolCallId: string }) {
  return {
    id: messageId,
    role: "assistant",
    parts: [
      {
        type: "tool-question",
        toolCallId,
        state: "input-available",
        input: {
          questions: [
            {
              question: "Which colour do you prefer?",
              header: "Pick a colour",
              options: [{ label: "Red" }, { label: "Blue" }],
            },
          ],
        },
      } as never,
    ],
  } satisfies UIMessage;
}

/** The live wait the stream put up for a question, as the transport records it. */
function recordLiveQuestion({ turnId, toolCallId }: { turnId: string; toolCallId: string }) {
  useLangyLocalControlStore.getState().recordWait({
    conversationId: "conv-1",
    wait: { waitId: `wait-${toolCallId}`, kind: "question", status: "pending", toolCallId, turnId },
  });
}

/** The panel's own derivations: the cards by the tool call that asked, and the timeline. */
function LiveMessage({ message, messages }: { message: UIMessage; messages: UIMessage[] }) {
  const live = useLangyLocalControlStore((s) => s.waits);
  const questionWaits = new Map(
    langyQuestionCards({ live }).flatMap((card) =>
      card.toolCallId ? [[card.toolCallId, card] as const] : [],
    ),
  );
  return (
    <div data-testid={message.id}>
      <MessageContent
        message={message}
        appliedOutcomes={{}}
        discardedProposals={new Set()}
        applyingProposals={new Set()}
        onApply={async () => {}}
        onDiscard={() => {}}
        questionWaits={questionWaits}
        choicesTimeline={langyChoicesTimeline(messages)}
        onChoiceSelect={() => {}}
      />
    </div>
  );
}

function renderLive(messages: UIMessage[]) {
  return render(
    <DesignSystemProvider forcedTheme="light">
      {messages.map((message) => (
        <LiveMessage key={message.id} message={message} messages={messages} />
      ))}
    </DesignSystemProvider>,
  );
}

function isLocked(messageId: string): boolean {
  const red = within(screen.getByTestId(messageId)).getByRole("button", { name: /Red/ });
  return (red as HTMLButtonElement).disabled || red.getAttribute("aria-disabled") === "true";
}

async function answerStop(): Promise<void> {
  await act(async () => {
    stopAnswer.resolve();
    await Promise.resolve();
  });
}

describe("a live question card when Stop is answered", () => {
  beforeEach(() => {
    useLangyStore.getState().resetForScope({});
    useLangyLocalControlStore.getState().reset("conv-1");
    const store = useLangyStore.getState();
    store.selectConversation("conv-1");
    store.beginTurn({ conversationId: "conv-1", turnId: "turn-1" });
  });
  afterEach(() => {
    cleanup();
    useLangyStore.getState().resetForScope({});
    useLangyLocalControlStore.getState().reset(null);
  });

  describe("given the stopped turn's question still waits", () => {
    /** @scenario The question card closes as soon as Stop is answered, without a reload */
    it("closes its options without a reload", async () => {
      recordLiveQuestion({ turnId: "turn-1", toolCallId: "call-q1" });
      renderLive([waitingQuestion({ messageId: "m-1", toolCallId: "call-q1" })]);
      const { result } = renderHook(() =>
        useLangyPanelStop({ projectId: "proj-1", foldInFlightTurnId: null, stop: async () => {} }),
      );
      expect(isLocked("m-1")).toBe(false);

      act(() => result.current());
      await answerStop();

      expect(isLocked("m-1")).toBe(true);
    });
  });

  describe("given the tab moved on to a newer turn that asked its own question", () => {
    /** @scenario The question card closes as soon as Stop is answered, without a reload */
    it("closes only the stopped turn's card", async () => {
      recordLiveQuestion({ turnId: "turn-1", toolCallId: "call-q1" });
      renderLive([
        waitingQuestion({ messageId: "m-1", toolCallId: "call-q1" }),
        waitingQuestion({ messageId: "m-2", toolCallId: "call-q2" }),
      ]);
      const { result } = renderHook(() =>
        useLangyPanelStop({ projectId: "proj-1", foldInFlightTurnId: null, stop: async () => {} }),
      );

      act(() => result.current());
      act(() => {
        const store = useLangyStore.getState();
        store.settleTurn("turn-1");
        store.beginTurn({ conversationId: "conv-1", turnId: "turn-2" });
        recordLiveQuestion({ turnId: "turn-2", toolCallId: "call-q2" });
      });
      await answerStop();

      expect(isLocked("m-1")).toBe(true);
      expect(isLocked("m-2")).toBe(false);
    });
  });

  describe("given the turn also raised a platform confirmation card", () => {
    /** @scenario A confirmation card raised during the turn stays answerable after Stop */
    it("closes the tool question but leaves the confirmation answerable", async () => {
      recordLiveQuestion({ turnId: "turn-1", toolCallId: "call-q1" });
      useLangyLocalControlStore.getState().recordWait({
        conversationId: "conv-1",
        wait: { waitId: "wait-confirm", kind: "question", status: "pending", turnId: "turn-1" },
      });
      const { result } = renderHook(() =>
        useLangyPanelStop({ projectId: "proj-1", foldInFlightTurnId: null, stop: async () => {} }),
      );

      act(() => result.current());
      await answerStop();

      const { waits } = useLangyLocalControlStore.getState();
      expect(waits["wait-call-q1"]?.status).toBe("cancelled");
      expect(waits["wait-confirm"]?.status).toBe("pending");
    });
  });
});
