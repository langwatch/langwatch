/**
 * @vitest-environment jsdom
 *
 * Who is offered the annotation pass. The overflow menu is where a reviewer
 * reaches for "Edit trace", and it is the only place the action is offered
 * on a trace that is being read, so the permission and the share view are gated
 * here. The header hands the menu its own `readOnly`, which is what a public
 * share page renders with.
 * See specs/traces-v2/trace-edit-mode.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const mocks = vi.hoisted(() => ({
  canUpdateAnnotations: true,
  openDrawer: vi.fn(),
}));

vi.mock("../../../../../behavior/use-drawer", () => ({
  useDrawer: () => ({ openDrawer: mocks.openDrawer }),
}));

vi.mock("../../../../../behavior/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1", slug: "acme" },
    hasPermission: (permission: string) =>
      permission === "annotations:update" ? mocks.canUpdateAnnotations : true,
  }),
}));

vi.mock("../../../../hooks/useConversationTurns", () => ({
  useConversationTurns: () => ({ data: undefined }),
}));

vi.mock("../../../../../components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

vi.mock("../../../../../features/errors", () => ({
  showErrorToast: vi.fn(),
}));

vi.mock("../../../../../behavior/trace-api", () => ({
  api: {
    useUtils: () => ({
      pinnedTrace: { getPin: { invalidate: vi.fn() } },
    }),
    pinnedTrace: {
      getPin: { useQuery: () => ({ data: undefined }) },
      pin: { useMutation: () => ({ mutate: vi.fn(), isLoading: false }) },
      unpin: { useMutation: () => ({ mutate: vi.fn(), isLoading: false }) },
    },
  },
}));

const { useDrawerStore } = await import("../../../../../index");
const { useTraceEditStore } = await import("../../../../../index");
const { TraceOverflowMenu } = await import("../TraceOverflowMenu");

const renderMenu = ({
  readOnly = false,
  traceId = "trace-1",
  onAddToAnnotationQueue = vi.fn(),
}: {
  readOnly?: boolean;
  traceId?: string;
  onAddToAnnotationQueue?: () => void;
} = {}) => {
  render(
    <ChakraProvider value={defaultSystem}>
      <TraceOverflowMenu
        traceId={traceId}
        conversationId={null}
        onCopyTraceId={vi.fn()}
        onFindSimilar={null}
        dejaViewHref={null}
        onOpenRawJson={vi.fn()}
        onShowShortcuts={vi.fn()}
        onAddToAnnotationQueue={onAddToAnnotationQueue}
        pinned={false}
        onTogglePinned={vi.fn()}
        readOnly={readOnly}
      />
    </ChakraProvider>,
  );
  return { onAddToAnnotationQueue };
};

/**
 * Chakra v3 Menu (Ark) needs the full pointer chain to open in jsdom; a native
 * `Element.click()` leaves it `data-state="closed"`. Waiting on an item that is
 * always offered is what proves the menu opened, so that an assertion about an
 * item being absent cannot pass on a menu that never opened.
 */
const openMenu = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: /more actions/i }));
  await screen.findByText("Copy trace ID");
};

const editTraceItem = () => screen.queryByText("Edit trace");

const annotationQueueItem = () => screen.queryByText("Add to annotation queue");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canUpdateAnnotations = true;
  useTraceEditStore.getState().discard();
  useDrawerStore.getState().setIsEditing(false);
  useDrawerStore.getState().setViewModeTransient("trace");
});

afterEach(() => {
  cleanup();
});

describe("given a reviewer reading a trace in the drawer", () => {
  describe("when they open the trace actions menu", () => {
    /** @scenario "The overflow menu offers to edit the trace" */
    it("offers an action to annotate the trace", async () => {
      const user = userEvent.setup();
      renderMenu();

      await openMenu(user);

      expect(editTraceItem()).toBeInTheDocument();
    });

    /** @scenario "The overflow menu offers to edit the trace" */
    it("starts annotating that trace when the action is chosen", async () => {
      const user = userEvent.setup();
      renderMenu();
      await openMenu(user);

      await user.click(screen.getByText("Edit trace"));

      expect(useTraceEditStore.getState().editingTraceId).toBe("trace-1");
      expect(useDrawerStore.getState().isEditing).toBe(true);
    });
  });

  describe("when they are reading the conversation view", () => {
    beforeEach(() => {
      useDrawerStore.getState().setViewModeTransient("conversation");
    });

    /** @scenario "Starting to annotate from the conversation leaves the reader there" */
    it("leaves them on the conversation, where they were commenting", async () => {
      const user = userEvent.setup();
      renderMenu();
      await openMenu(user);

      await user.click(screen.getByText("Edit trace"));

      expect(useDrawerStore.getState().viewMode).toBe("conversation");
      expect(useDrawerStore.getState().isEditing).toBe(true);
    });
  });

  describe("when the trace is a sample preview trace", () => {
    /** @scenario "A sample preview trace is never offered for annotation" */
    it("offers no action to annotate the trace", async () => {
      const user = userEvent.setup();
      renderMenu({ traceId: "lw-preview-chat" });

      await openMenu(user);

      expect(editTraceItem()).not.toBeInTheDocument();
    });
  });

  describe("when they may not update annotations", () => {
    beforeEach(() => {
      mocks.canUpdateAnnotations = false;
    });

    /** @scenario "A reviewer without permission to update annotations cannot annotate" */
    it("offers no action to annotate the trace", async () => {
      const user = userEvent.setup();
      renderMenu();

      await openMenu(user);

      expect(editTraceItem()).not.toBeInTheDocument();
    });
  });

  describe("when the trace is being read on its public share page", () => {
    /** @scenario "A shared trace is never editable" */
    it("offers no action to annotate the trace, however permitted the reader is", async () => {
      const user = userEvent.setup();
      renderMenu({ readOnly: true });

      await openMenu(user);

      expect(editTraceItem()).not.toBeInTheDocument();
    });

    /** @scenario "A shared trace never offers the action" */
    it("offers no action to queue the trace for annotation", async () => {
      const user = userEvent.setup();
      renderMenu({ readOnly: true });

      await openMenu(user);

      expect(annotationQueueItem()).not.toBeInTheDocument();
    });
  });

  describe("when they pick the annotation queue action", () => {
    /** @scenario "The trace drawer offers the same action for a single trace" */
    it("hands the open trace to the header's dialog", async () => {
      const user = userEvent.setup();
      const { onAddToAnnotationQueue } = renderMenu();
      await openMenu(user);

      await user.click(screen.getByText("Add to annotation queue"));

      expect(onAddToAnnotationQueue).toHaveBeenCalledTimes(1);
    });
  });
});
