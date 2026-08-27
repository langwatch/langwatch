/**
 * @vitest-environment jsdom
 *
 * What the reviewer reads while walking their annotation queue: the trace's
 * whole thread as a conversation, expanded, with the reviewed turn marked, and
 * a threadless trace still read as a single-turn conversation.
 * See packages/features/annotation/specs/annotation-queue-workflow.feature.
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
  focusTraceId?: string;
  showSessionCheckboxes?: boolean;
  fallbackTurns?: TraceListItem[];
  defaultExpandAll?: boolean;
  onSelectTurn?: (turn: { traceId: string; timestamp: number }) => void;
}

const OTHER_TURN = { traceId: "trace-9", timestamp: 1_700_000_009_000 };

const mocks = vi.hoisted(() => ({
  items: [] as unknown[],
  traceDetails: undefined as unknown,
  query: {} as Record<string, string>,
  openDrawer: vi.fn(),
  conversationProps: null as unknown,
  // What the conversation read answers with. `undefined` is "not answered yet".
  conversationTurns: undefined as { items: unknown[] } | undefined,
  conversationTurnsLoading: false,
}));

const conversationProps = () => mocks.conversationProps as ConversationViewProps;

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
  useRouter: () => ({ query: mocks.query, push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: mocks.openDrawer,
    drawerOpen: () => false,
  }),
}));

vi.mock("~/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
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
vi.mock("@langwatch/trace-web", () => ({
  useShikiAdapter: () => ({ getHighlighter: () => () => null }),
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      annotation: {
        getOptimizedAnnotationQueues: { invalidate: vi.fn() },
        getPendingItemsCount: { invalidate: vi.fn() },
        getAssignedItemsCount: { invalidate: vi.fn() },
        getQueueItemsCounts: { invalidate: vi.fn() },
      },
    }),
    traces: {
      getById: { useQuery: () => ({ data: mocks.traceDetails }) },
    },
    tracesV2: {
      list: {
        useQuery: () => ({
          data: mocks.conversationTurns,
          isLoading: mocks.conversationTurnsLoading,
        }),
      },
    },
    annotation: {
      markQueueItemDone: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      deleteQueueItems: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
  },
}));

const { default: MyQueuePage } = await import("~/pages/[project]/annotations/my-queue");

const TRACE_STARTED_AT = 1_700_000_000_000;

const trace = ({
  threadId,
  traceId = "trace-1",
}: {
  threadId?: string;
  traceId?: string;
}) => ({
  trace_id: traceId,
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

const queueItem = ({
  id,
  traceId,
  threadId,
}: {
  id: string;
  traceId: string;
  threadId?: string;
}) => ({
  id,
  traceId,
  projectId: "project-1",
  annotationQueueId: "queue-1",
  userId: null,
  doneAt: null,
  createdAt: new Date("2026-08-01T10:00:00Z"),
  trace: trace({ threadId, traceId }),
  annotations: [],
});

const setQueue = ({ threadId }: { threadId?: string }) => {
  mocks.items = [queueItem({ id: "item-1", traceId: "trace-1", threadId })];
  mocks.traceDetails = trace({ threadId });
};

/** Two items of the same thread, so the walk moves between its turns. */
const setThreadQueue = ({ threadId }: { threadId: string }) => {
  mocks.items = [
    queueItem({ id: "item-1", traceId: "trace-1", threadId }),
    queueItem({ id: "item-2", traceId: "trace-2", threadId }),
  ];
  mocks.traceDetails = trace({ threadId });
};

const page = () => (
  <ChakraProvider value={defaultSystem}>
    <MyQueuePage />
  </ChakraProvider>
);

const renderPage = () => render(page());

beforeEach(() => {
  vi.clearAllMocks();
  mocks.conversationProps = null;
  mocks.query = {};
  // The thread reads back inside the conversation's window unless a test says
  // otherwise, so the turns are the thread's own.
  mocks.conversationTurns = { items: [{ traceId: "trace-1" }] };
  mocks.conversationTurnsLoading = false;
  setQueue({ threadId: "thread-7" });
});

afterEach(() => {
  cleanup();
});

describe("given a reviewer walking their annotation queue", () => {
  describe("given the open item's trace belongs to a thread", () => {
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
  });

  describe("given the item's own turn is the one under review", () => {
    // Scrolling to it, blinking it once and keeping a tint on it are the
    // conversation's own doing. The page's part is naming which turn, which is
    // what these bind.

    /** @scenario "Opening a queue item scrolls its turn into view" */
    it("names the item's own turn as the one to land on", () => {
      renderPage();

      expect(conversationProps().focusTraceId).toBe("trace-1");
    });

    /** @scenario "Moving to the next item moves the focus" */
    it("moves the focus to the next item's turn", () => {
      setThreadQueue({ threadId: "thread-7" });
      const view = renderPage();
      expect(conversationProps().focusTraceId).toBe("trace-1");

      mocks.query = { "queue-item": "item-2" };
      view.rerender(page());

      expect(conversationProps().focusTraceId).toBe("trace-2");
    });
  });

  describe("given the walk collects traces for a dataset", () => {
    /** @scenario "A turn is counted in or out by hand" */
    it("gives every turn its own way in and out of the sitting's set", () => {
      renderPage();

      expect(conversationProps().showSessionCheckboxes).toBe(true);
    });
  });

  describe("given the thread is older than the window the conversation reads", () => {
    /** @scenario "A trace whose thread is older than the conversation window is read on its own" */
    it("renders the item's own trace as the turn under review", () => {
      mocks.conversationTurns = { items: [] };
      renderPage();

      expect(conversationProps().conversationId).toBeNull();
      expect(conversationProps().fallbackTurns).toEqual([
        expect.objectContaining({ traceId: "trace-1" }),
      ]);
    });

    /** @scenario "A trace whose thread is older than the conversation window is read on its own" */
    it("waits for the conversation to answer before standing in for it", () => {
      mocks.conversationTurns = undefined;
      mocks.conversationTurnsLoading = true;
      renderPage();

      expect(conversationProps().conversationId).toBe("thread-7");
      expect(conversationProps().fallbackTurns).toBeUndefined();
    });
  });

  describe("when the reviewer picks another turn of the thread", () => {
    /** @scenario "Picking another turn opens that turn's trace in the drawer" */
    it("opens that turn's trace in the trace drawer", async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(screen.getByRole("button", { name: "pick another turn" }));

      expect(mocks.openDrawer).toHaveBeenCalledWith("traceV2Details", {
        traceId: OTHER_TURN.traceId,
        t: String(OTHER_TURN.timestamp),
      });
    });
  });

  describe("given the open item's trace belongs to no thread", () => {
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
    it("interrupts the reading with no integration hint about thread ids", () => {
      renderPage();

      expect(
        screen.queryByText(/Pass the thread_id on your integration/),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "docs" })).not.toBeInTheDocument();
    });
  });
});
