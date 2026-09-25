/**
 * @vitest-environment jsdom
 * The conversation trace lends annotation's queue walker: the item's thread,
 * or its own trace as the only turn when there is no thread to read.
 * @see specs/annotations/annotation-queue-workflow.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnnotationQueueConversation } from "../annotation-queue-conversation.tsx";

type ViewProps = {
  conversationId: string | null;
  currentTraceId: string;
  focusTraceId?: string;
  showSessionCheckboxes?: boolean;
  fallbackTurns?: { traceId: string }[];
  defaultExpandAll?: boolean;
  onSelectTurn?: (turn: { traceId: string; timestamp: number }) => void;
};

const OTHER_TURN = { traceId: "trace-9", timestamp: 1_700_000_009_000 };

const mocks = vi.hoisted(() => {
  const state: {
    viewProps?: ViewProps;
    trace?: unknown;
    turns?: { items: unknown[] };
    turnsLoading: boolean;
  } = { turnsLoading: false };
  return { state, openDrawer: vi.fn() };
});

function viewProps(): ViewProps {
  if (!mocks.state.viewProps) throw new Error("the conversation was never rendered");
  return mocks.state.viewProps;
}

vi.mock("../../explorer/trace-drawer/conversation-view/conversation-view.tsx", () => ({
  ConversationView: (props: ViewProps) => {
    mocks.state.viewProps = props;
    return (
      <button type="button" onClick={() => props.onSelectTurn?.(OTHER_TURN)}>
        pick another turn
      </button>
    );
  },
}));

vi.mock("../../explorer/hooks/use-conversation-turns.ts", () => ({
  useConversationTurns: () => ({
    data: mocks.state.turns,
    isLoading: mocks.state.turnsLoading,
    isPlaceholderData: false,
  }),
}));

vi.mock("../../explorer/hooks/use-drawer-project-id.ts", () => ({
  useDrawerProjectId: () => "project-1",
}));

vi.mock("../../../../behavior/trace-api.ts", () => ({
  api: { traces: { getById: { useQuery: () => ({ data: mocks.state.trace }) } } },
}));

vi.mock("../../../../behavior/use-drawer.ts", () => ({
  useDrawer: () => ({ openDrawer: mocks.openDrawer }),
}));

vi.mock("@langwatch/design-system/shiki", () => ({
  useShikiAdapter: () => ({ getHighlighter: () => () => null }),
}));

vi.mock("@langwatch/design-system/color-mode", () => ({
  useColorMode: () => ({ colorMode: "light" }),
}));

const TRACE = {
  trace_id: "trace-1",
  project_id: "project-1",
  metadata: { thread_id: "thread-1" },
  timestamps: { started_at: 1_700_000_000_000, inserted_at: 1, updated_at: 1 },
  input: { value: "hi" },
  output: { value: "hello" },
  spans: [],
};

function renderConversation(conversationId: string | null) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <AnnotationQueueConversation traceId="trace-1" conversationId={conversationId} />
    </ChakraProvider>,
  );
}

beforeEach(() => {
  mocks.state.trace = TRACE;
  mocks.state.turns = undefined;
  mocks.state.turnsLoading = false;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("given the queued trace belongs to a thread", () => {
  describe("when the conversation renders", () => {
    it("reads the thread, focused on the trace under review", () => {
      mocks.state.turns = { items: [{ traceId: "trace-1" }] };
      renderConversation("thread-1");

      expect(viewProps().conversationId).toBe("thread-1");
      expect(viewProps().focusTraceId).toBe("trace-1");
      expect(viewProps().fallbackTurns).toBeUndefined();
      expect(viewProps().showSessionCheckboxes).toBe(true);
    });

    /** @scenario "Messages arrive expanded so the whole output can be read" */
    it("opens with every message expanded", () => {
      renderConversation("thread-1");

      expect(viewProps().defaultExpandAll).toBe(true);
    });
  });

  describe("given the thread is older than the window the conversation reads", () => {
    /** @scenario "A trace whose thread is older than the conversation window is read on its own" */
    it("hands the trace over as the only turn once the thread answers empty", () => {
      mocks.state.turns = { items: [] };
      renderConversation("thread-1");

      expect(viewProps().conversationId).toBeNull();
      expect(viewProps().fallbackTurns?.map((turn) => turn.traceId)).toEqual(["trace-1"]);
    });

    it("waits for the thread to answer before standing in for it", () => {
      mocks.state.turnsLoading = true;
      renderConversation("thread-1");

      expect(viewProps().conversationId).toBe("thread-1");
      expect(viewProps().fallbackTurns).toBeUndefined();
    });
  });
});

describe("given the queued trace belongs to no thread", () => {
  /** @scenario "A trace with no thread is still read as a conversation" */
  it("hands the trace over as the conversation's only turn", () => {
    renderConversation(null);

    expect(viewProps().conversationId).toBeNull();
    expect(viewProps().fallbackTurns?.map((turn) => turn.traceId)).toEqual(["trace-1"]);
  });
});

describe("when the reviewer picks another turn", () => {
  /** @scenario "Picking another turn opens that turn's trace in the drawer" */
  it("opens that turn's trace in the trace drawer at its partition", async () => {
    renderConversation("thread-1");

    await userEvent.click(screen.getByRole("button", { name: "pick another turn" }));

    expect(mocks.openDrawer).toHaveBeenCalledWith("traceV2Details", {
      traceId: "trace-9",
      t: String(OTHER_TURN.timestamp),
    });
  });
});
