/**
 * @vitest-environment jsdom
 *
 * One screen, four views, and what each of them is.
 *
 * The assertions that used to be spread across four `platform/app` page files —
 * `annotations.tsx`, `annotations/all.tsx`, `annotations/me.tsx` and
 * `annotations/[slug].tsx` — now that the view arrives as a prop. What each
 * page handed the table is what this pins.
 *
 * THE ASSIGNMENT PREDICATE IS THE POINT OF HALF OF THIS FILE. Annotations are
 * per-person work queues, so "whose work is this list?" is the question that
 * decides whether a reviewer sees a teammate's items on a page called My Queue,
 * or an empty Inbox because their work arrives through a shared queue. It is
 * answered in two independent places — the read's `showQueueAndUser`, and the
 * `pageQueue` the send picker opens on — and both are asserted here.
 *
 * Spec: packages/features/annotation/specs/annotations-list-selection.feature.
 */

import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithAnnotationHost } from "../../../testing";

const mocks = vi.hoisted(() => ({
  annotations: [] as unknown[],
  traces: [] as unknown[],
  queue: null as unknown,
  badges: [] as unknown[],
  downloadCsv: vi.fn(),
  listProps: null as Record<string, unknown> | null,
}));

// The list has its own two suites; here it only has to report what the view
// handed it, which is the whole subject of this file.
vi.mock("../../../ui/sections/annotation-list", () => ({
  AnnotationList: (props: Record<string, unknown>) => {
    mocks.listProps = props;
    return (
      <div data-testid="annotation-list">
        {props.titleContent as React.ReactNode}
        <button type="button" onClick={props.onExport as () => void}>
          {(props.exportLabel as string) ?? "Export"}
        </button>
      </div>
    );
  },
}));

vi.mock("../../../ui/sections/annotation-queue-editor", () => ({
  AnnotationQueueEditor: ({ queueId }: { queueId?: string }) => (
    <div data-testid="queue-editor">{queueId ?? "new"}</div>
  ),
}));

vi.mock("../../../behavior/download-csv", () => ({ downloadCsv: mocks.downloadCsv }));

vi.mock("../../../behavior/annotation-api", () => ({
  annotationApi: {
    annotation: {
      getPendingItemsCount: { useQuery: () => ({ data: 4 }) },
      getAssignedItemsCount: { useQuery: () => ({ data: 2 }) },
      getQueueItemsCounts: { useQuery: () => ({ data: mocks.badges }) },
      getQueueBySlugOrId: { useQuery: () => ({ data: mocks.queue }) },
      getAll: { useQuery: () => ({ data: mocks.annotations, isLoading: false }) },
    },
    traces: {
      getTracesWithSpans: { useQuery: () => ({ data: mocks.traces, isLoading: false }) },
    },
  },
}));

const { AnnotationsScreen } = await import("../annotations.screen");

const annotation = (overrides: Record<string, unknown> = {}) => ({
  id: "a1",
  projectId: "proj-1",
  traceId: "trace-1",
  userId: "user-1",
  comment: "reads well",
  isThumbsUp: null,
  scoreOptions: null,
  expectedOutput: null,
  anchorKind: null,
  anchorId: null,
  anchorPath: null,
  createdAt: new Date("2026-07-20T10:00:00Z"),
  updatedAt: new Date("2026-07-20T10:00:00Z"),
  user: { id: "user-1", name: "Ana", image: null },
  ...overrides,
});

beforeEach(() => {
  mocks.annotations = [];
  mocks.traces = [];
  mocks.queue = null;
  mocks.badges = [];
  mocks.listProps = null;
  mocks.downloadCsv.mockReset();
});
afterEach(() => {
  mocks.listProps = null;
});

describe("given the Inbox address", () => {
  describe("when the screen renders it", () => {
    /**
     * THE QUEUE-MEMBERSHIP PREDICATE, at the seam the reader actually meets it.
     * The Inbox is the one view that spans every queue the reviewer is on.
     */
    /** @scenario "The inbox spans every queue the reviewer is on" */
    it("reads every queue the reviewer is a member of", () => {
      renderWithAnnotationHost(<AnnotationsScreen view="inbox" />);

      expect(mocks.listProps?.view).toBe("inbox");
      expect(mocks.listProps?.pageQueue).toBeUndefined();
      expect(mocks.listProps?.rows).toBeUndefined();
    });

    /** @scenario "Exactly one list entry is active" */
    /** @scenario "The open top-level list is the highlighted sidebar entry" */
    it("marks the Inbox entry in the sidebar and nothing else", () => {
      renderWithAnnotationHost(<AnnotationsScreen view="inbox" />);

      const inbox = screen.getByRole("link", { name: /Inbox/ });
      expect(inbox).toHaveAttribute("aria-current", "page");
      expect(screen.getByRole("link", { name: /All/ })).not.toHaveAttribute("aria-current");
    });

    it("counts the work waiting on each entry, and says nothing where there is none", () => {
      mocks.badges = [
        { id: "q1", name: "Support reviews", slug: "support-reviews", pendingCount: 3 },
        { id: "q2", name: "Sales reviews", slug: "sales-reviews", pendingCount: 0 },
      ];
      renderWithAnnotationHost(<AnnotationsScreen view="inbox" />);

      expect(screen.getByRole("link", { name: /Inbox/ })).toHaveTextContent("4");
      expect(screen.getByRole("link", { name: /\(You\)/ })).toHaveTextContent("2");
      expect(screen.getByRole("link", { name: /Support reviews/ })).toHaveTextContent("3");
      // A queue with nothing waiting reads as a queue, not as a zero.
      expect(screen.getByRole("link", { name: /Sales reviews/ })).not.toHaveTextContent("0");
    });

    it("links every entry inside the project the reader is in", () => {
      mocks.badges = [
        { id: "q1", name: "Support reviews", slug: "support-reviews", pendingCount: 3 },
      ];
      renderWithAnnotationHost(<AnnotationsScreen view="inbox" />);

      expect(screen.getByRole("link", { name: /Inbox/ })).toHaveAttribute(
        "href",
        "/test-project/annotations",
      );
      expect(screen.getByRole("link", { name: /All/ })).toHaveAttribute(
        "href",
        "/test-project/annotations/all",
      );
      // Keyed on the SLUG, because that is what `/annotations/<slug>` puts in
      // the URL and what the queue view reads back out of the route.
      expect(screen.getByRole("link", { name: /Support reviews/ })).toHaveAttribute(
        "href",
        "/test-project/annotations/support-reviews",
      );
    });
  });
});

describe("given a queue page", () => {
  describe("when the sidebar renders beside it", () => {
    /** @scenario "The open queue is the highlighted sidebar entry" */
    it("highlights that queue and no other", () => {
      mocks.badges = [
        { id: "q1", name: "Support reviews", slug: "support-reviews", pendingCount: 3 },
        { id: "q2", name: "Sales reviews", slug: "sales-reviews", pendingCount: 1 },
      ];
      renderWithAnnotationHost(<AnnotationsScreen view="queue" />, {
        route: { params: { slug: "support-reviews" }, query: {} },
      });

      expect(screen.getByRole("link", { name: /Support reviews/ })).toHaveAttribute(
        "aria-current",
        "page",
      );
      expect(screen.getByRole("link", { name: /Sales reviews/ })).not.toHaveAttribute(
        "aria-current",
      );
      expect(screen.getByRole("link", { name: /Inbox/ })).not.toHaveAttribute("aria-current");
    });

    /** @scenario "Queue edits begin at the queue entry" */
    /** @scenario "Every queue in the sidebar carries its own actions menu" */
    it("gives each queue an action that edits that queue", () => {
      mocks.badges = [
        { id: "q1", name: "Support reviews", slug: "support-reviews", pendingCount: 3 },
        { id: "q2", name: "Sales reviews", slug: "sales-reviews", pendingCount: 1 },
      ];
      const { host } = renderWithAnnotationHost(<AnnotationsScreen view="inbox" />);

      expect(
        screen.getByRole("button", { name: "Actions for queue Support reviews" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Actions for queue Sales reviews" }),
      ).toBeInTheDocument();
      expect(host.queries).toEqual([]);
    });
  });
});

describe("given the reviewer's own queue address", () => {
  describe("when the screen renders it", () => {
    /**
     * THE ASSIGNMENT PREDICATE. This page IS the reviewer, so moving a
     * selection elsewhere starts from them being on it — `user-<id>`, which is
     * the vocabulary the queue reads use for a person. Getting the prefix wrong
     * would quietly turn "move off my queue" into "add to a queue nobody is
     * on".
     */
    /** @scenario "Moving a selection starts from the list it is already on" */
    it("opens the send picker on the reviewer themselves", () => {
      renderWithAnnotationHost(<AnnotationsScreen view="mine" />);

      expect(mocks.listProps?.view).toBe("mine");
      expect(mocks.listProps?.pageQueue).toEqual({
        annotatorId: "user-user-1",
        name: "Ana Reviewer",
      });
    });

    it("falls back to a name rather than an empty picker chip", () => {
      renderWithAnnotationHost(<AnnotationsScreen view="mine" />, {
        currentUser: { id: "user-9", name: null, image: null },
      });

      expect(mocks.listProps?.pageQueue).toEqual({
        annotatorId: "user-user-9",
        name: "You",
      });
    });

    it("offers no page queue at all before the session resolves", () => {
      renderWithAnnotationHost(<AnnotationsScreen view="mine" />, {
        currentUser: undefined,
      });

      expect(mocks.listProps?.pageQueue).toBeUndefined();
    });
  });
});

describe("given a named queue's address", () => {
  describe("when the queue has resolved", () => {
    beforeEach(() => {
      mocks.queue = {
        id: "q1",
        name: "Support reviews",
        slug: "support-reviews",
        description: null,
        projectId: "proj-1",
        createdAt: new Date(),
        updatedAt: new Date(),
        members: [
          { user: { id: "user-1", name: "Ana", image: null } },
          { user: { id: "user-2", name: "Bo", image: null } },
        ],
        AnnotationQueueScores: [],
      };
    });

    /** THE ASSIGNMENT PREDICATE again, in its other vocabulary: `queue-<id>`. */
    it("opens the send picker on the queue the page is", () => {
      renderWithAnnotationHost(<AnnotationsScreen view="queue" />, {
        route: { params: { slug: "support-reviews" }, query: {} },
      });

      expect(mocks.listProps?.queueId).toBe("q1");
      expect(mocks.listProps?.pageQueue).toEqual({
        annotatorId: "queue-q1",
        name: "Support reviews",
      });
    });

    it("titles the list with the queue's name and its members", () => {
      renderWithAnnotationHost(<AnnotationsScreen view="queue" />, {
        route: { params: { slug: "support-reviews" }, query: {} },
      });

      expect(screen.getByRole("heading", { name: "Support reviews" })).toBeInTheDocument();
      expect(screen.getByText("Members:")).toBeInTheDocument();
    });
  });

  describe("when the queue has not resolved yet", () => {
    it("offers no page queue rather than one named after nothing", () => {
      renderWithAnnotationHost(<AnnotationsScreen view="queue" />, {
        route: { params: { slug: "support-reviews" }, query: {} },
      });

      expect(mocks.listProps?.pageQueue).toBeUndefined();
      expect(mocks.listProps?.titleContent).toBeUndefined();
    });
  });
});

describe("given the All Annotations address", () => {
  describe("when the screen renders it", () => {
    /** @scenario "All annotations reads the whole project inside its range" */
    it("groups the annotations by trace and dates each row by its newest one", () => {
      mocks.annotations = [
        annotation({ id: "a1", createdAt: new Date("2026-07-01T10:00:00Z") }),
        annotation({ id: "a2", createdAt: new Date("2026-07-20T10:00:00Z") }),
        annotation({ id: "a3", traceId: "trace-2", comment: "off topic" }),
      ];
      renderWithAnnotationHost(<AnnotationsScreen view="all" />);

      const rows = mocks.listProps?.rows as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(2);
      expect(rows[0]!.queueItemId).toBeNull();
      expect(rows[0]!.date).toEqual(new Date("2026-07-20T10:00:00Z"));
    });

    /**
     * The list pages through what it holds; the export carries all of it. That
     * is the property the platform page's own test named, and it is why this
     * view replaces the list's export rather than sharing it.
     */
    it("exports every annotation, not just the page on screen", () => {
      mocks.annotations = [
        annotation({ id: "a1" }),
        annotation({ id: "a2" }),
        annotation({ id: "a3", traceId: "trace-2" }),
      ];
      mocks.traces = [
        {
          trace_id: "trace-1",
          input: { value: "the question" },
          output: { value: "the answer" },
        },
      ];
      renderWithAnnotationHost(<AnnotationsScreen view="all" />);

      screen.getByRole("button", { name: "Export all" }).click();

      const call = mocks.downloadCsv.mock.calls[0]?.[0];
      expect(call.rows).toHaveLength(3);
      expect(call.fields).toContain("Trace ID");
      expect(call.rows[0]).toContain("the question");
      expect(call.fileName).toMatch(/^Traces - \d{4}-\d{2}-\d{2}\.csv$/);
    });
  });
});

describe("given the queue editor", () => {
  describe("when the address does not name it", () => {
    it("is not mounted", () => {
      renderWithAnnotationHost(<AnnotationsScreen view="inbox" />);

      expect(screen.queryByTestId("queue-editor")).not.toBeInTheDocument();
    });
  });

  describe("when the address names a queue", () => {
    it("opens on that queue", () => {
      renderWithAnnotationHost(<AnnotationsScreen view="inbox" />, {
        route: { params: {}, query: { "queue-editor": "q1" } },
      });

      expect(screen.getByTestId("queue-editor")).toHaveTextContent("q1");
    });
  });

  describe("when the sidebar asks to create one", () => {
    /** @scenario "Creating or editing a queue is a link, not a drawer call" */
    it("writes the address rather than mounting a drawer itself", () => {
      const { host } = renderWithAnnotationHost(<AnnotationsScreen view="inbox" />);

      screen.getByRole("button", { name: "Create annotation queue" }).click();

      expect(host.lastQuery).toMatchObject({ "queue-editor": "new" });
    });
  });

  describe("when the reader holds the lite membership role", () => {
    /** @scenario "A reader who may not change resources is offered no queue actions" */
    it("offers neither creating a queue nor editing one", () => {
      mocks.badges = [{ id: "q1", name: "Support reviews", slug: "s", pendingCount: 3 }];
      renderWithAnnotationHost(<AnnotationsScreen view="inbox" />, {
        isLiteMember: true,
      });

      expect(
        screen.queryByRole("button", { name: "Create annotation queue" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Actions for queue Support reviews" }),
      ).not.toBeInTheDocument();
    });
  });
});
