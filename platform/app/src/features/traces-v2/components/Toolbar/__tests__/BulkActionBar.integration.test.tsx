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
  useDrawer: () => ({ openDrawer: vi.fn() }),
}));
vi.mock("~/components/me/usePersonalFeatureGate", () => ({
  usePersonalFeatureGate: () => ({
    requestEnable: async () => true,
    dialogState: { open: false },
  }),
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
