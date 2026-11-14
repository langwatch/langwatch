/**
 * An assistant reply with nothing visible renders a quiet empty state.
 * @vitest-environment jsdom
 * Spec: specs/langy/langy-stop-and-resume.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { LANGY_CALL_STOPPED_PREFIX } from "@langwatch/langy-contract";
import { cleanup, render, screen } from "@testing-library/react";
import type { UIMessage } from "ai";
import { cloneElement, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/browser-host/use-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@langwatch/browser-host/use-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("../../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "p_demo", slug: "demo" },
  }),
}));

vi.mock("../../../../../behavior/langy-api.ts", () => ({
  api: {
    useUtils: () => ({}),
    dashboards: {
      getAll: { useQuery: () => ({ data: [] }) },
      create: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
    graphs: { create: { useMutation: () => ({ mutateAsync: vi.fn() }) } },
  },
}));

vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof rechartsModule>();
  return {
    ...actual,
    ResponsiveContainer: ({
      children,
    }: {
      children: ReactElement<{ width?: number; height?: number }>;
    }) => cloneElement(children, { width: 640, height: 200 }),
  };
});

import type * as rechartsModule from "recharts";

import { useLangyStore } from "../../../../../behavior/langy.store.ts";
import type { LangyQuestionCardData } from "../../../../../model/langy-local-waits.ts";
import { langyChoicesTimeline } from "../../../../transcript/model/langy-choices-timeline.ts";
import { MessageContent } from "../message-content.tsx";

afterEach(cleanup);

const emptyAssistantMessage: UIMessage = {
  id: "m-assistant",
  role: "assistant",
  parts: [],
};

const partialAssistantMessage: UIMessage = {
  id: "m-assistant-partial",
  role: "assistant",
  parts: [{ type: "text", text: "The slowest traces are" }],
};

function renderMessage({
  interrupted,
  message = emptyAssistantMessage,
  isLatest,
  questionWaits,
  answerable = false,
}: {
  interrupted: boolean;
  message?: UIMessage;
  isLatest?: boolean;
  questionWaits?: ReadonlyMap<string, LangyQuestionCardData>;
  /** The card is on the timeline with a handler, so its recorded state reads open. */
  answerable?: boolean;
}) {
  const open = answerable
    ? { choicesTimeline: langyChoicesTimeline([message]), onChoiceSelect: () => {} }
    : {};
  return render(
    <DesignSystemProvider forcedTheme="light">
      <MessageContent
        message={message}
        appliedOutcomes={{}}
        discardedProposals={new Set()}
        applyingProposals={new Set()}
        onApply={async () => {}}
        onDiscard={() => {}}
        interrupted={interrupted}
        {...(questionWaits ? { questionWaits } : {})}
        {...(isLatest === undefined ? {} : { isLatest })}
        {...open}
      />
    </DesignSystemProvider>,
  );
}

describe("given a settled assistant reply with nothing visible", () => {
  describe("when this browser stopped the turn", () => {
    /** @scenario A stop before any words arrive reads as interrupted, not as missing content */
    it("says Interrupted instead of No content", () => {
      renderMessage({ interrupted: true });

      expect(screen.getByText("Interrupted")).toBeInTheDocument();
      expect(screen.queryByText("No content")).toBeNull();
    });
  });

  describe("when the emptiness has another cause", () => {
    /** @scenario An empty reply at the end of the conversation still says so */
    it("keeps the plain empty state", () => {
      renderMessage({ interrupted: false });

      expect(screen.getByText("No content")).toBeInTheDocument();
    });
  });
});

describe("given a settled assistant reply that had started to answer", () => {
  describe("when this browser stopped the turn", () => {
    /** @scenario A stopped reply says so, whatever it managed to say first */
    it("keeps what arrived and marks the reply interrupted", () => {
      renderMessage({ interrupted: true, message: partialAssistantMessage });

      expect(screen.getByText(/The slowest traces are/)).toBeInTheDocument();
      expect(screen.getByText("Interrupted")).toBeInTheDocument();
    });
  });

  describe("when the reply finished on its own", () => {
    it("marks nothing", () => {
      renderMessage({ interrupted: false, message: partialAssistantMessage });

      expect(screen.queryByText("Interrupted")).toBeNull();
    });
  });
});

describe("the store's interruption record", () => {
  afterEach(() =>
    useLangyStore.setState({
      turnPhase: "idle",
      activeTurnId: null,
      activeConversationId: null,
      interruptedConversationId: null,
    }),
  );

  describe("when a stop is dispatched on an active turn", () => {
    it("remembers which conversation was interrupted until the next send", () => {
      useLangyStore.setState({
        activeConversationId: "conv-1",
        turnPhase: "active",
        activeTurnId: "turn-1",
      });

      useLangyStore.getState().requestStop();
      expect(useLangyStore.getState().interruptedConversationId).toBe("conv-1");

      useLangyStore.getState().beginTurn({ conversationId: "conv-1", turnId: "turn-2" });
      expect(useLangyStore.getState().interruptedConversationId).toBeNull();
    });
  });

  describe("when the stop request fails to go out", () => {
    it("forgets the interruption", () => {
      useLangyStore.setState({
        activeConversationId: "conv-1",
        turnPhase: "active",
        activeTurnId: "turn-1",
      });

      useLangyStore.getState().requestStop();
      useLangyStore.getState().abandonStop();

      expect(useLangyStore.getState().interruptedConversationId).toBeNull();
    });
  });

  describe("when no turn is active", () => {
    it("records nothing", () => {
      useLangyStore.setState({
        activeConversationId: "conv-1",
        turnPhase: "idle",
      });

      useLangyStore.getState().requestStop();

      expect(useLangyStore.getState().interruptedConversationId).toBeNull();
    });
  });
});

describe("given a settled empty reply with a later message after it", () => {
  /** @scenario An empty reply with messages after it draws nothing */
  it("draws no empty reply row for a message that is not the latest", () => {
    renderMessage({ interrupted: false, isLatest: false });

    expect(screen.queryByText("No content")).toBeNull();
    expect(screen.queryByText("Interrupted")).toBeNull();
  });
});

describe("given a question the user's Stop ended", () => {
  /** @scenario A question card I stopped reads as closed, not as failed */
  it("keeps its options from being chosen", () => {
    const message: UIMessage = {
      id: "m-stopped-question",
      role: "assistant",
      parts: [
        {
          type: "tool-question",
          toolCallId: "call-q",
          state: "output-error",
          input: {
            questions: [
              {
                question: "Which colour do you prefer?",
                header: "Pick a colour",
                options: [{ label: "Red" }, { label: "Blue" }],
              },
            ],
          },
          errorText: `${LANGY_CALL_STOPPED_PREFIX}, so the call on the user's machine was stopped too`,
        } as never,
      ],
    };

    renderMessage({ interrupted: true, message });

    const red = screen.getByRole("button", { name: /Red/ });
    expect(
      (red as HTMLButtonElement).disabled || red.getAttribute("aria-disabled") === "true",
    ).toBe(true);
  });

  /** @scenario A question I answered keeps my choice when the stop text lands after it */
  it("keeps the choice of a question answered before the stop", () => {
    const message: UIMessage = {
      id: "m-answered-then-stopped",
      role: "assistant",
      parts: [
        {
          type: "tool-question",
          toolCallId: "call-q",
          state: "output-error",
          input: {
            questions: [
              {
                question: "Which colour do you prefer?",
                header: "Pick a colour",
                options: [{ label: "Red" }, { label: "Blue" }],
              },
            ],
          },
          errorText: `${LANGY_CALL_STOPPED_PREFIX}, so the call on the user's machine was stopped too`,
        } as never,
      ],
    };
    const questionWaits = new Map<string, LangyQuestionCardData>([
      [
        "call-q",
        {
          waitId: "w1",
          toolCallId: "call-q",
          status: "answered",
          questions: [],
          answers: [{ selected: ["Red"] }],
        },
      ],
    ]);

    renderMessage({ interrupted: true, message, questionWaits });

    expect(screen.getByRole("button", { name: /Red/ }).getAttribute("aria-pressed")).toBe("true");
  });

  describe("given its recorded state is still open", () => {
    /** @scenario A question card I stopped reads as closed, not as failed */
    it("closes it because of the stop text alone", () => {
      renderMessage({
        interrupted: true,
        message: questionEndedWith(
          `${LANGY_CALL_STOPPED_PREFIX}, so the call on the user's machine was stopped too`,
        ),
        answerable: true,
      });

      expect(isRedLocked()).toBe(true);
    });

    it("leaves it open when the call ended for another reason", () => {
      renderMessage({
        interrupted: true,
        message: questionEndedWith("The question could not be shown. Ask the user in words."),
        answerable: true,
      });

      expect(isRedLocked()).toBe(false);
    });
  });
});

function questionEndedWith(errorText: string): UIMessage {
  return {
    id: "m-question",
    role: "assistant",
    parts: [
      {
        type: "tool-question",
        toolCallId: "call-q",
        state: "output-error",
        input: {
          questions: [
            {
              question: "Which colour do you prefer?",
              header: "Pick a colour",
              options: [{ label: "Red" }, { label: "Blue" }],
            },
          ],
        },
        errorText,
      } as never,
    ],
  };
}

function isRedLocked(): boolean {
  const red = screen.getByRole("button", { name: /Red/ });
  return (red as HTMLButtonElement).disabled || red.getAttribute("aria-disabled") === "true";
}
