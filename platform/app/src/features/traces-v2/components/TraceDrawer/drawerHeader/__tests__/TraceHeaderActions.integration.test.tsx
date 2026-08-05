// @vitest-environment jsdom
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

/**
 * The promoted header buttons: share, annotate, add to dataset.
 * Spec: specs/traces-v2/annotation-queue-actions.feature
 */

const { mockOpenDrawer, mockRequestEnable, mockHasPermission } = vi.hoisted(
  () => ({
    mockOpenDrawer: vi.fn(),
    mockRequestEnable: vi.fn(),
    mockHasPermission: vi.fn(),
  }),
);

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ openDrawer: mockOpenDrawer, drawerOpen: () => false }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", slug: "acme" },
    hasPermission: mockHasPermission,
  }),
}));

vi.mock("~/components/me/usePersonalFeatureGate", () => ({
  usePersonalFeatureGate: () => ({
    requestEnable: mockRequestEnable,
    dialogState: null,
  }),
}));

vi.mock("~/components/me/PersonalFeatureGateDialog", () => ({
  PersonalFeatureGateDialog: () => null,
}));

import { TraceHeaderActions } from "../TraceHeaderActions";

const onShare = vi.fn();
const onOpenQueueDialog = vi.fn();

const renderActions = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <TraceHeaderActions
        traceId="t1"
        onShare={onShare}
        onOpenQueueDialog={onOpenQueueDialog}
      />
    </ChakraProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  mockHasPermission.mockReturnValue(true);
  mockRequestEnable.mockResolvedValue(true);
});
afterEach(cleanup);

describe("TraceHeaderActions", () => {
  describe("given full permissions", () => {
    it("shows share, annotate and dataset as icon buttons", () => {
      renderActions();

      expect(
        screen.getByRole("button", { name: "Share trace" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Add to annotation queue" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Add trace to dataset" }),
      ).toBeInTheDocument();
    });

    it("routes the share button to the header's dialog", async () => {
      const user = userEvent.setup();
      renderActions();

      await user.click(screen.getByRole("button", { name: "Share trace" }));

      expect(onShare).toHaveBeenCalledTimes(1);
    });

    it("opens the dataset drawer for the open trace", async () => {
      const user = userEvent.setup();
      renderActions();

      await user.click(
        screen.getByRole("button", { name: "Add trace to dataset" }),
      );

      expect(mockOpenDrawer).toHaveBeenCalledWith("addDatasetRecord", {
        traceId: "t1",
      });
    });
  });

  describe("when the personal-workspace gate allows annotations", () => {
    it("opens the queue dialog", async () => {
      const user = userEvent.setup();
      renderActions();

      await user.click(
        screen.getByRole("button", { name: "Add to annotation queue" }),
      );

      await waitFor(() => expect(onOpenQueueDialog).toHaveBeenCalledTimes(1));
      expect(mockRequestEnable).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the personal-workspace gate is declined", () => {
    it("leaves the queue dialog closed", async () => {
      mockRequestEnable.mockResolvedValue(false);
      const user = userEvent.setup();
      renderActions();

      await user.click(
        screen.getByRole("button", { name: "Add to annotation queue" }),
      );

      await waitFor(() => expect(mockRequestEnable).toHaveBeenCalledTimes(1));
      expect(onOpenQueueDialog).not.toHaveBeenCalled();
    });
  });

  describe("given the user cannot manage annotations", () => {
    it("hides the annotate button, keeps the others", () => {
      mockHasPermission.mockImplementation(
        (permission: string) => permission !== "annotations:manage",
      );
      renderActions();

      expect(
        screen.queryByRole("button", { name: "Add to annotation queue" }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Share trace" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Add trace to dataset" }),
      ).toBeInTheDocument();
    });
  });

  describe("given the user cannot share traces", () => {
    it("hides the share button", () => {
      mockHasPermission.mockImplementation(
        (permission: string) => permission !== "traces:share",
      );
      renderActions();

      expect(
        screen.queryByRole("button", { name: "Share trace" }),
      ).not.toBeInTheDocument();
    });
  });
});
