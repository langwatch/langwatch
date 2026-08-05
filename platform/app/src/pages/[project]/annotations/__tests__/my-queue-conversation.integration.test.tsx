/**
 * @vitest-environment jsdom
 *
 * What the reviewer reads while walking their annotation queue: the trace's
 * whole thread as a conversation, expanded, with the reviewed turn marked, and
 * a threadless trace still read as a single-turn conversation.
 * See specs/annotations/annotation-queue-workflow.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { TraceListItem } from "~/features/traces-v2/types/trace";

interface ConversationViewProps {
  conversationId: string | null;
  currentTraceId: string;
  fallbackTurns?: TraceListItem[];
  defaultExpandAll?: boolean;
  onSelectTurn?: (turn: { traceId: string; timestamp: number }) => void;
}

const OTHER_TURN = { traceId: "trace-9", timestamp: 1_700_000_009_000 };

const mocks = vi.hoisted(() => ({
  items: [] as unknown[],
  traceDetails: undefined as unknown,
  openDrawer: vi.fn(),
  setFlowCallbacks: vi.fn(),
  conversationProps: null as unknown,
}));

const conversationProps = () =>
  mocks.conversationProps as ConversationViewProps;

vi.mock("~/hooks/useAnnotationQueues", () => ({
  useAnnotationQueues: () => ({
    assignedQueueItems: mocks.items,
    totalCount: mocks.items.length,
    scoreOptions: { data: [] },
    queuesLoading: false,
  }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1", slug: "acme" },
    hasPermission: () => true,
  }),
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ query: {}, push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: mocks.openDrawer,
    setFlowCallbacks: mocks.setFlowCallbacks,
  }),
}));

vi.mock("~/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("~/components/AnnotationsLayout", () => ({
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock("~/components/icons/TasksDone", () => ({
  TasksDone: () => <div data-testid="tasks-done" />,
}));

// Stands in for the conversation so the props the page hands it are readable,
// and so picking a turn can be triggered the way a reader would.
vi.mock("~/features/traces-v2/components/TraceDrawer/conversationView", () => ({
  ConversationView: (props: ConversationViewProps) => {
    mocks.conversationProps = props;
    return (
      <div data-testid="conversation-view">
        <button type="button" onClick={() => props.onSelectTurn?.(OTHER_TURN)}>
          pick another turn
        </button>
      </div>
    );
  },
}));

// The real adapter loads Shiki's grammars and themes, which the mocked
// conversation above never highlights with.
vi.mock(
  "~/features/traces-v2/components/TraceDrawer/markdownView/shikiAdapter",
  () => ({
    useShikiAdapter: () => ({ getHighlighter: () => () => null }),
  }),
);

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({
      annotation: {
        getOptimizedAnnotationQueues: { invalidate: vi.fn() },
        getMarkedForDatasetItems: { invalidate: vi.fn() },
        getPendingItemsCount: { invalidate: vi.fn() },
        getAssignedItemsCount: { invalidate: vi.fn() },
        getQueueItemsCounts: { invalidate: vi.fn() },
      },
    }),
    traces: {
      getById: { useQuery: () => ({ data: mocks.traceDetails }) },
    },
    annotation: {
      getMarkedForDatasetItems: {
        useQuery: () => ({ data: [], isLoading: false }),
      },
      markQueueItemDone: {
        useMutation: () => ({ mutate: vi.fn(), isLoading: false }),
      },
      markQueueItemForDataset: {
        useMutation: () => ({ mutate: vi.fn(), isLoading: false }),
      },
      clearDatasetMarks: {
        useMutation: () => ({ mutate: vi.fn(), isLoading: false }),
      },
    },
  },
}));

const { default: MyQueuePage } = await import(
  "~/pages/[project]/annotations/my-queue"
);

const TRACE_STARTED_AT = 1_700_000_000_000;

const trace = ({ threadId }: { threadId?: string }) => ({
  trace_id: "trace-1",
  project_id: "project-1",
  metadata: threadId ? { thread_id: threadId } : {},
  timestamps: {
    started_at: TRACE_STARTED_AT,
    inserted_at: TRACE_STARTED_AT,
    updated_at: TRACE_STARTED_AT,
  },
  input: { value: "what is the return policy?" },
  output: { value: "thirty days" },
  metrics: { total_time_ms: 1_200, first_token_ms: 300, total_cost: 0.02 },
  spans: [],
});

const setQueue = ({ threadId }: { threadId?: string }) => {
  const item = trace({ threadId });
  mocks.items = [
    {
      id: "item-1",
      traceId: "trace-1",
      projectId: "project-1",
      annotationQueueId: "queue-1",
      userId: null,
      doneAt: null,
      createdAt: new Date("2026-08-01T10:00:00Z"),
      trace: item,
      annotations: [],
    },
  ];
  mocks.traceDetails = item;
};

const renderPage = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <MyQueuePage />
    </ChakraProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.conversationProps = null;
  setQueue({ threadId: "thread-7" });
});

afterEach(() => {
  cleanup();
});

describe("given a reviewer walking their annotation queue", () => {
  describe("when the open item's trace belongs to a thread", () => {
    /** @scenario "A queued trace is read as the whole thread it belongs to" */
    it("reads the thread named by the queue item as the conversation", () => {
      renderPage();

      expect(screen.getByTestId("conversation-view")).toBeInTheDocument();
      expect(conversationProps().conversationId).toBe("thread-7");
    });

    /** @scenario "A queued trace is read as the whole thread it belongs to" */
    it("marks the item's own trace as the turn under review", () => {
      renderPage();

      expect(conversationProps().currentTraceId).toBe("trace-1");
    });

    /** @scenario "A queued trace is read as the whole thread it belongs to" */
    it("leaves the turns to the thread, handing over none of its own", () => {
      renderPage();

      expect(conversationProps().fallbackTurns).toBeUndefined();
    });

    /** @scenario "Messages arrive expanded so the whole output can be read" */
    it("opens the conversation with its messages already expanded", () => {
      renderPage();

      expect(conversationProps().defaultExpandAll).toBe(true);
    });

    /** @scenario "Suggesting is offered on the turn being read" */
    it("leaves correcting a turn to the conversation, holding no editor of its own", () => {
      renderPage();

      expect(screen.getByTestId("conversation-view")).toBeInTheDocument();
      expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    });

    /** @scenario "A trace with no thread is still read as a conversation" */
    it("says nothing about thread_id", () => {
      renderPage();

      expect(
        screen.queryByText(/Pass the thread_id on your integration/),
      ).not.toBeInTheDocument();
    });
  });

  describe("when the reviewer picks another turn of the thread", () => {
    /** @scenario "Picking another turn opens that turn's trace in the drawer" */
    it("opens that turn's trace in the trace drawer", async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(
        screen.getByRole("button", { name: "pick another turn" }),
      );

      expect(mocks.openDrawer).toHaveBeenCalledWith("traceV2Details", {
        traceId: OTHER_TURN.traceId,
        t: String(OTHER_TURN.timestamp),
      });
    });
  });

  describe("when the open item's trace belongs to no thread", () => {
    beforeEach(() => {
      setQueue({});
    });

    /** @scenario "A trace with no thread is still read as a conversation" */
    it("hands the trace over as the conversation's only turn", () => {
      renderPage();

      expect(conversationProps().conversationId).toBeNull();
      expect(conversationProps().fallbackTurns).toEqual([
        expect.objectContaining({
          traceId: "trace-1",
          timestamp: TRACE_STARTED_AT,
          input: "what is the return policy?",
          output: "thirty days",
        }),
      ]);
    });

    /** @scenario "A trace with no thread is still read as a conversation" */
    it("says how to capture the whole conversation, and links the docs", () => {
      renderPage();

      expect(
        screen.getByText(/Pass the thread_id on your integration/),
      ).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "docs" })).toHaveAttribute(
        "href",
        "https://docs.langwatch.ai/integration/python/guide#adding-metadata",
      );
    });
  });
});
