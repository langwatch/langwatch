// @vitest-environment jsdom
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

/**
 * The trace list adds context to Langy through the selection bar, not a per-row
 * hover. Spec: specs/langy/langy-context-attach.feature.
 */

const langyMock = { showLangy: true, attach: vi.fn(), open: vi.fn() };
// "Add to context" primes a question, so the bar gates on `useCanAskLangy`
// (`langy:create`) rather than `useShowLangy` (`langy:view`). Both read the one
// fixture flag: which grant gates which affordance is decided in the hooks, and
// restating it here would only give the fixture a second opinion.
vi.mock("~/features/langy/hooks/useCanAskLangy", () => ({
  useCanAskLangy: () => langyMock.showLangy,
}));
vi.mock("~/features/langy/hooks/useShowLangy", () => ({
  useShowLangy: () => langyMock.showLangy,
}));
vi.mock("~/features/langy/stores/langyStore", () => ({
  useLangyStore: (
    selector: (s: {
      attachContext: typeof langyMock.attach;
      openPanel: typeof langyMock.open;
    }) => unknown,
  ) => selector({ attachContext: langyMock.attach, openPanel: langyMock.open }),
}));
vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ openDrawer: vi.fn(), drawerOpen: () => false }),
}));
const gateMock = { allow: true };
vi.mock("~/components/me/usePersonalFeatureGate", () => ({
  usePersonalFeatureGate: (feature: string) => ({
    requestEnable: async () => gateMock.allow,
    dialogState: { open: false, feature },
  }),
}));
const permissionMock = { canManageAnnotations: true };
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", slug: "proj" },
    hasPermission: (permission: string) =>
      permission === "annotations:manage"
        ? permissionMock.canManageAnnotations
        : true,
  }),
}));
// The queue dialog is exercised in its own test; here it only needs to report
// whether the bar decided to open it.
vi.mock("../../annotationQueue/AddToAnnotationQueueDialog", () => ({
  AddToAnnotationQueueDialog: ({
    open,
    traceIds,
  }: {
    open: boolean;
    traceIds: string[];
  }) =>
    open ? <div data-testid="queue-dialog">{traceIds.join(",")}</div> : null,
}));

import { useSelectionStore } from "../../../stores/selectionStore";
import { BulkActionBar } from "../BulkActionBar";

const renderBar = (namesById: Record<string, string | undefined> = {}) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <BulkActionBar
        totalHits={100}
        pageTraceIds={["t1", "t2"]}
        traceNamesById={namesById}
        onExportSelected={vi.fn()}
      />
    </ChakraProvider>,
  );

beforeEach(() => {
  langyMock.showLangy = true;
  langyMock.attach.mockClear();
  langyMock.open.mockClear();
  gateMock.allow = true;
  permissionMock.canManageAnnotations = true;
  useSelectionStore.getState().clear();
});
afterEach(cleanup);

describe("BulkActionBar Add to context", () => {
  describe("given trace rows are selected and Langy is available", () => {
    describe("when Add to context is clicked", () => {
      it("attaches every selected trace by human name and opens Langy", () => {
        useSelectionStore.getState().setMany(["t1", "t2"], true);
        renderBar({ t1: "Checkout agent", t2: undefined });

        fireEvent.click(screen.getByRole("button", { name: /Add to context/ }));

        expect(langyMock.attach).toHaveBeenCalledTimes(2);
        expect(langyMock.attach).toHaveBeenCalledWith({
          type: "trace",
          id: "t1",
          label: "Trace · Checkout agent",
        });
        // No name falls back to a shortened id, never a raw blank.
        expect(langyMock.attach).toHaveBeenCalledWith(
          expect.objectContaining({ type: "trace", id: "t2" }),
        );
        expect(langyMock.open).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("given Langy is not available", () => {
    it("does not offer the Add to context action", () => {
      langyMock.showLangy = false;
      useSelectionStore.getState().setMany(["t1"], true);
      renderBar();

      expect(
        screen.queryByRole("button", { name: /Add to context/ }),
      ).not.toBeInTheDocument();
      // The other bulk actions still render.
      expect(
        screen.getByRole("button", { name: /Export selected/ }),
      ).toBeInTheDocument();
    });
  });

  describe("given all-matching selection mode", () => {
    it("disables Add to context (too many to attach as chips)", () => {
      useSelectionStore.getState().setMany(["t1", "t2"], true);
      useSelectionStore.getState().enableAllMatching();
      renderBar();

      expect(
        screen.getByRole("button", { name: /Add to context/ }),
      ).toBeDisabled();
    });
  });
});

/**
 * Spec: specs/traces-v2/annotation-queue-actions.feature — bulk entry.
 */
describe("BulkActionBar Add to annotation queue", () => {
  const queueButton = () =>
    screen.queryByRole("button", { name: /Add to annotation queue/ });

  describe("given the user can manage annotations", () => {
    describe("when rows are selected", () => {
      it("offers the action alongside Add to dataset", () => {
        useSelectionStore.getState().setMany(["t1", "t2"], true);
        renderBar();

        expect(queueButton()).toBeInTheDocument();
        expect(
          screen.getByRole("button", { name: /Add to dataset/ }),
        ).toBeInTheDocument();
      });
    });

    describe("when the action is clicked", () => {
      it("opens the dialog with the selected traces", async () => {
        useSelectionStore.getState().setMany(["t1", "t2"], true);
        renderBar();

        fireEvent.click(queueButton()!);

        const dialog = await screen.findByTestId("queue-dialog");
        expect(dialog).toHaveTextContent("t1,t2");
      });
    });

    describe("when the personal-workspace gate is declined", () => {
      it("leaves the dialog closed", async () => {
        gateMock.allow = false;
        useSelectionStore.getState().setMany(["t1"], true);
        renderBar();

        fireEvent.click(queueButton()!);
        await Promise.resolve();

        expect(screen.queryByTestId("queue-dialog")).not.toBeInTheDocument();
      });
    });
  });

  describe("given all-matching selection mode", () => {
    it("disables the action, which needs rows picked one by one", () => {
      useSelectionStore.getState().setMany(["t1", "t2"], true);
      useSelectionStore.getState().enableAllMatching();
      renderBar();

      expect(queueButton()).toBeDisabled();
    });
  });

  describe("given the user cannot manage annotations", () => {
    it("hides the action but keeps the other bulk actions", () => {
      permissionMock.canManageAnnotations = false;
      useSelectionStore.getState().setMany(["t1"], true);
      renderBar();

      expect(queueButton()).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Add to dataset/ }),
      ).toBeInTheDocument();
    });
  });
});
