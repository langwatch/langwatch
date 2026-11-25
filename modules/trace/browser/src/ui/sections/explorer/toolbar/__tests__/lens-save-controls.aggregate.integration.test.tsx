// @vitest-environment jsdom
/**
 * On an aggregate project (read only, ADR-177) the trace list offers no control that saves
 * a lens; unsaved changes can still be discarded. An ordinary project keeps them all.
 * @see specs/governance/aggregate-project.feature
 */
import { Tabs } from "@langwatch/design-system/primitives";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useExplorerStore } from "../../../../../behavior/explorer.store.ts";
import { type LensConfig, setLensSyncBridge } from "../../../../../behavior/view.slice.ts";
import { CreateLensButton } from "../create-lens-button.tsx";
import { LensTab } from "../lens-tab.tsx";

const { projectRef } = vi.hoisted(() => ({
  projectRef: { current: { id: "proj-1", kind: "application" } },
}));

vi.mock("../../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({
    project: projectRef.current,
    hasPermission: () => true,
  }),
}));

const USER_LENS: LensConfig = {
  id: "custom-lens-1",
  name: "Slow answers",
  isBuiltIn: false,
  columns: ["time"],
  addons: [],
  grouping: "flat",
  sort: { columnId: "time", direction: "desc" },
  filterText: "",
};

const renderToolbarBits = () =>
  renderWithDesignSystem(
    <Tabs.Root value={USER_LENS.id}>
      <Tabs.List>
        <LensTab lens={USER_LENS} isDraft={false} errorCount={0} />
      </Tabs.List>
      <CreateLensButton />
    </Tabs.Root>,
  );

const openLensMenu = async () => {
  fireEvent.contextMenu(screen.getByRole("tab", { name: USER_LENS.name }));
  await waitFor(() => expect(screen.getByText("Revert local changes")).toBeTruthy());
};

/** Renders `lens` as the active tab with an unsaved change on it. */
const renderDraftLens = () => {
  const store = useExplorerStore.getState();
  store.setUserLenses([USER_LENS]);
  store.selectLens(USER_LENS.id);
  useExplorerStore.getState().setGrouping("by-service");

  return renderWithDesignSystem(
    <Tabs.Root value={USER_LENS.id}>
      <Tabs.List>
        <LensTab lens={USER_LENS} isDraft errorCount={0} />
      </Tabs.List>
    </Tabs.Root>,
  );
};

const openDraftDot = async () => {
  fireEvent.click(
    screen.getByRole("button", {
      name: "Unsaved changes on this lens. Click for options.",
    }),
  );
  await waitFor(() => expect(screen.getByText("Discard changes")).toBeTruthy());
};

afterEach(() => {
  cleanup();
  setLensSyncBridge(null);
});

describe("Lens save controls", () => {
  describe("given an ordinary project", () => {
    describe("when ana opens a lens tab's menu", () => {
      it("offers to create, save, rename, duplicate and delete a lens", async () => {
        projectRef.current = { id: "proj-1", kind: "application" };
        useExplorerStore.getState().setUserLenses([USER_LENS]);

        renderToolbarBits();
        await openLensMenu();

        expect(screen.getByRole("button", { name: "Create new lens" })).toBeTruthy();
        expect(screen.getByText("Save as new lens…")).toBeTruthy();
        expect(screen.getByText("Rename")).toBeTruthy();
        expect(screen.getByText("Duplicate")).toBeTruthy();
        expect(screen.getByText("Delete")).toBeTruthy();
      });
    });

    describe("when ana saves a lens's unsaved changes as a new lens", () => {
      it("creates the lens and sends it to be saved", async () => {
        projectRef.current = { id: "proj-1", kind: "application" };
        const create = vi.fn();
        setLensSyncBridge({
          acceptsWrites: () => true,
          create,
          rename: vi.fn(),
          delete: vi.fn(),
        });

        renderDraftLens();
        await openDraftDot();
        fireEvent.click(screen.getByRole("button", { name: "Save as new lens" }));
        const nameInput = await screen.findByPlaceholderText("Lens name");
        fireEvent.change(nameInput, { target: { value: "Grouped answers" } });
        fireEvent.keyDown(nameInput, { key: "Enter" });

        expect(create).toHaveBeenCalledWith(expect.objectContaining({ name: "Grouped answers" }), {
          fallbackLensId: expect.any(String),
        });
        expect(
          useExplorerStore.getState().allLenses.some((lens) => lens.name === "Grouped answers"),
        ).toBe(true);
      });
    });
  });

  describe("given an aggregate project", () => {
    describe("when ana opens a lens tab's menu", () => {
      /** @scenario "The aggregate's trace list offers no control to save a view" */
      it("offers no way to create, save, rename, duplicate or delete a lens", async () => {
        projectRef.current = { id: "agg-1", kind: "aggregate" };
        useExplorerStore.getState().setUserLenses([USER_LENS]);

        renderToolbarBits();
        await openLensMenu();

        expect(screen.queryByRole("button", { name: "Create new lens" })).toBeNull();
        expect(screen.queryByText("Save as new lens…")).toBeNull();
        expect(screen.queryByText("Rename")).toBeNull();
        expect(screen.queryByText("Duplicate")).toBeNull();
        expect(screen.queryByText("Delete")).toBeNull();
      });
    });

    describe("when ana opens the unsaved-changes dot on a lens", () => {
      /** @scenario "The aggregate's trace list offers no control to save a view" */
      it("offers to discard the changes but not to save them as a new lens", async () => {
        projectRef.current = { id: "agg-1", kind: "aggregate" };

        renderDraftLens();
        await openDraftDot();

        expect(screen.queryByRole("button", { name: "Save as new lens" })).toBeNull();
        expect(screen.queryByText("Save changes as new lens")).toBeNull();
        expect(useExplorerStore.getState().isDraft(USER_LENS.id)).toBe(true);

        fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));

        expect(useExplorerStore.getState().isDraft(USER_LENS.id)).toBe(false);
      });
    });
  });
});
