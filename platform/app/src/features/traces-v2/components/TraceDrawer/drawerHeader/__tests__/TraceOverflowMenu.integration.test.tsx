// @vitest-environment jsdom
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

/**
 * The overflow menu keeps only low-frequency actions. Share, annotate and
 * add-trace-to-dataset are icon buttons in the header (TraceHeaderActions).
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

const renderMenu = () =>
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

afterEach(cleanup);

describe("TraceOverflowMenu", () => {
  describe("when the menu is opened", () => {
    it("keeps its low-frequency actions", async () => {
      renderMenu();
      await openMenu();

      expect(await screen.findByText("Copy trace ID")).toBeInTheDocument();
      expect(screen.getByText("View raw JSON")).toBeInTheDocument();
      expect(screen.getByText("Pin trace")).toBeInTheDocument();
    });

    it("no longer lists the actions promoted to header buttons", async () => {
      renderMenu();
      await openMenu();

      await screen.findByText("Copy trace ID");
      expect(
        screen.queryByText("Add to annotation queue"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText("Add trace to dataset"),
      ).not.toBeInTheDocument();
      expect(screen.queryByText("Share")).not.toBeInTheDocument();
    });

    it("keeps the conversation-to-dataset item out without a conversation", async () => {
      renderMenu();
      await openMenu();

      await screen.findByText("Copy trace ID");
      expect(
        screen.queryByText("Add conversation to dataset"),
      ).not.toBeInTheDocument();
    });
  });
});
