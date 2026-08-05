// @vitest-environment jsdom
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

/**
 * The drawer's single-trace route into an annotation queue.
 * Spec: specs/traces-v2/annotation-queue-actions.feature
 */

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ openDrawer: vi.fn(), drawerOpen: () => false }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", slug: "acme" },
    hasPermission: () => true,
  }),
}));

vi.mock("../../../../hooks/useConversationTurns", () => ({
  useConversationTurns: () => ({ data: undefined }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    pinnedTrace: {
      getPin: { useQuery: () => ({ data: null }) },
      pin: { useMutation: () => ({ mutate: vi.fn(), isLoading: false }) },
      unpin: { useMutation: () => ({ mutate: vi.fn(), isLoading: false }) },
    },
    useUtils: () => ({ pinnedTrace: { getPin: { invalidate: vi.fn() } } }),
  },
}));

import { TraceOverflowMenu } from "../TraceOverflowMenu";

const onAddToAnnotationQueue = vi.fn();

const renderMenu = (queueCallback: (() => void) | null) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <TraceOverflowMenu
        traceId="t1"
        conversationId={null}
        onCopyTraceId={vi.fn()}
        onFindSimilar={null}
        dejaViewHref={null}
        onOpenRawJson={vi.fn()}
        onShowShortcuts={vi.fn()}
        onShare={vi.fn()}
        onAddToAnnotationQueue={queueCallback}
        pinned={false}
        onTogglePinned={vi.fn()}
      />
    </ChakraProvider>,
  );

const openMenu = async () => {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "More actions" }));
  return user;
};

beforeEach(() => {
  onAddToAnnotationQueue.mockClear();
});
afterEach(cleanup);

describe("TraceOverflowMenu annotation queue item", () => {
  describe("given the user can manage annotations", () => {
    describe("when the menu is opened", () => {
      it("lists the action alongside the add-to-dataset item", async () => {
        renderMenu(onAddToAnnotationQueue);
        await openMenu();

        expect(
          await screen.findByText("Add to annotation queue"),
        ).toBeInTheDocument();
        expect(screen.getByText("Add trace to dataset")).toBeInTheDocument();
      });
    });

    describe("when the action is picked", () => {
      it("hands off to the header, which owns the dialog", async () => {
        renderMenu(onAddToAnnotationQueue);
        const user = await openMenu();

        await user.click(await screen.findByText("Add to annotation queue"));

        expect(onAddToAnnotationQueue).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("given the user cannot manage annotations", () => {
    it("does not list the action", async () => {
      renderMenu(null);
      await openMenu();

      expect(
        await screen.findByText("Add trace to dataset"),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("Add to annotation queue"),
      ).not.toBeInTheDocument();
    });
  });
});
