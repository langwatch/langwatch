/**
 * @vitest-environment jsdom
 */
import { AnnotationTestHarness, StubAnnotationHost } from "@langwatch/annotation-web/testing";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { TraceListItem } from "@langwatch/trace-web/surfaces/explorer-trace-types";

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
  /**
   * Whether the step being served is the item the reviewer has left, with the
   * one the URL names still being read.
   */
  stepIsStale: false,
  query: {} as Record<string, string>,
  annotateClicked: vi.fn(),
  openDrawer: vi.fn(),
  conversationProps: null as unknown,
  // What the conversation read answers with. `undefined` is "not answered yet".
  conversationTurns: undefined as { items: unknown[] } | undefined,
  conversationTurnsLoading: false,
}));

const conversationProps = () => mocks.conversationProps as ConversationViewProps;

vi.mock("@langwatch/ui-host/session", () => ({
  useActiveScope: () => ({ status: "ready", project: { id: "project-1", slug: "acme" } }),
  usePermissions: () => ({ can: () => true }),
}));

vi.mock("@langwatch/ui-host/use-router", () => ({
  useRouter: () => ({ query: mocks.query, push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@langwatch/ui-drawer", () => ({
  useDrawer: () => ({
    openDrawer: mocks.openDrawer,
    drawerOpen: () => false,
  }),
}));

// Stands in for the conversation so the props the page hands it are readable,
// and so picking a turn can be triggered the way a reader would.
vi.mock("@langwatch/trace-web/surfaces/conversation-view", () => ({
  ConversationView: (props: ConversationViewProps) => {
    mocks.conversationProps = props;

    return (
      <div data-testid="conversation-view">
        <button type="button" onClick={() => props.onSelectTurn?.(OTHER_TURN)}>
          pick another turn
        </button>
        {/*
          Stands in for the per-message Annotate the real conversation renders,
          which writes an annotation against the trace it was rendered with.
          The page cannot disable it — it belongs to the conversation — so the
          only thing a test can ask is whether the press reaches it at all.
        */}
        <button type="button" onClick={() => mocks.annotateClicked()}>
          annotate this turn
        </button>
      </div>
    );
  },
}));

// The real adapter loads Shiki's grammars and themes, which the mocked
// conversation above never highlights with.
vi.mock("@langwatch/trace-web", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useShikiAdapter: () => ({ getHighlighter: () => () => null }),
}));

/**
 * The thread's turns, as the walker reads them. `platform/app` mocked `~/utils/api` and got
 * this for free: the page and the conversation hook were on ONE tRPC client, so a mocked
 * `tracesV2.list` answered both.
 */
vi.mock("@langwatch/trace-web/surfaces/conversation-turns", () => ({
  useConversationTurns: () => ({
    data: mocks.conversationTurns,
    isLoading: mocks.conversationTurnsLoading,
    isPlaceholderData: false,
  }),
}));

vi.mock("@langwatch/annotation-web/annotations", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAnnotationQueues: () => ({
    assignedQueueItems: mocks.items,
    totalCount: mocks.items.length,
    scoreOptions: { data: [] },
    queuesLoading: false,
    queuesReady: true,
    queuesError: undefined,
  }),
  useShowErrorToast: () => vi.fn(),
  AnnotationQueueLayout: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TasksDone: () => <div data-testid="tasks-done" />,
  annotationApi: {
    useUtils: () => ({
      annotation: {
        getQueueWalkStep: { invalidate: vi.fn() },
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

const { default: MyQueuePage } = await import("../annotation-queue-walker");

const TRACE_STARTED_AT = 1_700_000_000_000;

const trace = ({ threadId, traceId = "trace-1" }: { threadId?: string; traceId?: string }) => ({
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

/**
 * The walker mounts the TRACE host as well as its own — the conversation view and its turn hook
 * read `@langwatch/trace-web`'s port — and the bridge that answers it reads the annotation host
 * above it, so the harness is what puts both in place.
 */
const page = () => (
  <AnnotationTestHarness
    host={
      new StubAnnotationHost({
        project: { id: "project-1", slug: "acme", name: "Acme" },
        currentUser: { id: "user-1", name: "Ada", image: null },
        permissions: ["annotations:update", "annotations:manage"],
      })
    }
  >
    <MyQueuePage />
  </AnnotationTestHarness>
);

const renderPage = () => render(page());

beforeEach(() => {
  vi.clearAllMocks();
  mocks.conversationProps = null;
  mocks.query = {};
  mocks.stepIsStale = false;
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
    /** @scenario "The current turn is focused in its conversation" */
    it("reads the thread named by the queue item as the conversation", () => {
      renderPage();

      expect(screen.getByTestId("conversation-view")).toBeInTheDocument();
      expect(conversationProps().conversationId).toBe("thread-7");
    });

    /** @scenario "The current turn is focused in its conversation" */
    it("marks the item's own trace as the turn under review", () => {
      renderPage();

      expect(conversationProps().currentTraceId).toBe("trace-1");
    });

    /** @scenario "The current turn is focused in its conversation" */
    it("leaves the turns to the thread, handing over none of its own", () => {
      renderPage();

      expect(conversationProps().fallbackTurns).toBeUndefined();
    });

    /** @scenario "Messages arrive expanded so the whole output can be read" */
    it("opens the conversation with its messages already expanded", () => {
      renderPage();

      expect(conversationProps().defaultExpandAll).toBe(true);
    });

    /** @scenario "Annotation suggestions use the conversation correction editor" */
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

    /** @scenario "The current turn is focused in its conversation" */
    it("names the item's own turn as the one to land on", () => {
      renderPage();

      expect(conversationProps().focusTraceId).toBe("trace-1");
    });

    /** @scenario "The current turn is focused in its conversation" */
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
    /** @scenario "Reviewing and explicitly selecting traces builds the dataset set" */
    it("gives every turn its own way in and out of the sitting's set", () => {
      renderPage();

      expect(conversationProps().showSessionCheckboxes).toBe(true);
    });
  });

  describe("given the thread is older than the window the conversation reads", () => {
    /** @scenario "A single or unavailable conversation still shows the queued trace" */
    it("renders the item's own trace as the turn under review", () => {
      mocks.conversationTurns = { items: [] };
      renderPage();

      expect(conversationProps().conversationId).toBeNull();

      expect(conversationProps().fallbackTurns).toEqual([
        expect.objectContaining({ traceId: "trace-1" }),
      ]);
    });

    /** @scenario "A single or unavailable conversation still shows the queued trace" */
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

    describe("given they have stepped on and the new item is still being read", () => {
      /** @scenario "Nothing acts on the item I have just stepped off" */
      it("does not let the press reach the thread they left", async () => {
        const user = userEvent.setup();
        mocks.query = { "queue-item": "item-2" };
        mocks.stepIsStale = true;
        renderPage();

        // The thread on screen is still the one being left, so a press aimed
        // at it would annotate, or open, the wrong item. Nothing here is
        // disabled — the conversation owns these controls — so what is being
        // asked is whether the press lands at all.
        const annotate = screen.getByRole("button", {
          name: "annotate this turn",
        });
        const openTurn = screen.getByRole("button", {
          name: "pick another turn",
        });

        await expect(user.click(annotate)).rejects.toThrow(/pointer-events/);
        await expect(user.click(openTurn)).rejects.toThrow(/pointer-events/);

        expect(mocks.annotateClicked).not.toHaveBeenCalled();
        expect(mocks.openDrawer).not.toHaveBeenCalled();
      });
    });
  });

  describe("given the open item's trace belongs to no thread", () => {
    beforeEach(() => {
      setQueue({});
    });

    /** @scenario "A single or unavailable conversation still shows the queued trace" */
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

    /** @scenario "A single or unavailable conversation still shows the queued trace" */
    it("interrupts the reading with no integration hint about thread ids", () => {
      renderPage();

      expect(screen.queryByText(/Pass the thread_id on your integration/)).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "docs" })).not.toBeInTheDocument();
    });
  });
});
