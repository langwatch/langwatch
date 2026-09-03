// @vitest-environment jsdom
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

/**
 * Restoring parity with the legacy trace list: a selection can be handed to a
 * reviewer without leaving the table.
 * Spec: specs/traces-v2/bulk-actions.feature.
 */

const mocks = vi.hoisted(() => ({
  permissions: new Set<string>(["annotations:create"]),
}));

vi.mock("../../../../../behavior/langy/use-can-ask-langy", () => ({
  useCanAskLangy: () => true,
}));
vi.mock("@langwatch/langy-web", async (importOriginal) => ({
  ...((await importOriginal()) as object),
  useLangyStore: (selector: (s: { attachContext: () => void; openPanel: () => void }) => unknown) =>
    selector({ attachContext: vi.fn(), openPanel: vi.fn() }),
}));
vi.mock("../../../../../behavior/use-drawer", () => ({
  useDrawer: () => ({ openDrawer: vi.fn() }),
}));
vi.mock("../../../../../behavior/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1", slug: "acme" },
    hasPermission: (permission: string) => mocks.permissions.has(permission),
  }),
}));
vi.mock("../../../me/use-personal-feature-gate", () => ({
  usePersonalFeatureGate: () => ({
    requestEnable: async () => true,
    dialogState: { open: false },
  }),
}));
// The dialog is covered on its own; here we only care that the bar hands it
// the right traces at the right moment.
vi.mock("../../add-to-annotation-queue-dialog", () => ({
  AddToAnnotationQueueDialog: (props: { open: boolean; traceIds: string[] }) => {
    return props.open ? (
      <div data-testid="annotation-queue-dialog">{props.traceIds.join(",")}</div>
    ) : null;
  },
}));

import { useSelectionStore } from "../../../../../index";
import { BulkActionBar } from "../bulk-action-bar";

const renderBar = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <BulkActionBar
        totalHits={100}
        pageTraceIds={["t1", "t2", "t3"]}
        traceNamesById={{}}
        onExportSelected={vi.fn()}
      />
    </ChakraProvider>,
  );

const buttonNames = () => screen.getAllByRole("button").map((b) => b.textContent ?? "");

beforeEach(() => {
  mocks.permissions = new Set<string>(["annotations:create"]);
  useSelectionStore.getState().clear();
});
afterEach(cleanup);

describe("BulkActionBar add to annotation queue", () => {
  describe("given rows are selected", () => {
    /** @scenario "Add to annotation queue sits between Add to context and Add to dataset" */
    it("offers the action between Add to context and Add to dataset", () => {
      useSelectionStore.getState().setMany(["t1", "t2", "t3"], true);
      renderBar();

      const names = buttonNames();
      const context = names.findIndex((n) => n.includes("Add to context"));
      const queue = names.findIndex((n) => n.includes("Add to annotation queue"));
      const dataset = names.findIndex((n) => n.includes("Add to dataset"));

      expect(queue).toBeGreaterThan(context);
      expect(queue).toBeLessThan(dataset);
    });

    describe("when the user clicks Add to annotation queue", () => {
      /** @scenario "Opening the dialog carries the selected trace ids" */
      it("opens the dialog for exactly the selected traces", async () => {
        useSelectionStore.getState().setMany(["t1", "t2", "t3"], true);
        renderBar();

        expect(screen.queryByTestId("annotation-queue-dialog")).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: /Add to annotation queue/ }));

        expect(await screen.findByTestId("annotation-queue-dialog")).toHaveTextContent("t1,t2,t3");
      });
    });
  });

  describe("given select-all-matching is active", () => {
    /** @scenario "Add to annotation queue is disabled in select-all-matching mode" */
    it("disables the action because the queue needs explicit rows", () => {
      useSelectionStore.getState().setMany(["t1", "t2", "t3"], true);
      useSelectionStore.getState().enableAllMatching();
      renderBar();

      expect(screen.getByRole("button", { name: /Add to annotation queue/ })).toBeDisabled();
    });
  });

  describe("given the user cannot create annotations", () => {
    /** @scenario "The action is hidden without permission to create annotations" */
    it("does not offer the action at all", () => {
      mocks.permissions = new Set<string>();
      useSelectionStore.getState().setMany(["t1"], true);
      renderBar();

      expect(
        screen.queryByRole("button", { name: /Add to annotation queue/ }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Add to dataset/ })).toBeInTheDocument();
    });
  });
});
