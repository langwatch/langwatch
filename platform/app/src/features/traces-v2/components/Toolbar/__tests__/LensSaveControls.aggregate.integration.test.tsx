/**
 * @vitest-environment jsdom
 *
 * A lens is a saved view written under the project. On an aggregate project,
 * which is read only (ADR-144), the server refuses that write, so the trace
 * list offers no control that makes one: no "+" lens button and no save,
 * rename, duplicate or delete in a lens tab's menu. An ordinary project keeps
 * them all.
 *
 * @see specs/governance/aggregate-project.feature
 */
import { ChakraProvider, defaultSystem, Tabs } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useExplorerStore } from "../../../stores/explorerStore";
import type { LensConfig } from "../../../stores/viewSlice";
import { CreateLensButton } from "../CreateLensButton";
import { LensTab } from "../LensTab";

const { projectRef } = vi.hoisted(() => ({
  projectRef: { current: { id: "proj-1", kind: "application" } },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
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
  render(
    <ChakraProvider value={defaultSystem}>
      <Tabs.Root value={USER_LENS.id}>
        <Tabs.List>
          <LensTab lens={USER_LENS} isDraft={false} errorCount={0} />
        </Tabs.List>
        <CreateLensButton />
      </Tabs.Root>
    </ChakraProvider>,
  );

const openLensMenu = async () => {
  fireEvent.contextMenu(screen.getByRole("tab", { name: USER_LENS.name }));
  await waitFor(() =>
    expect(screen.getByText("Revert local changes")).toBeTruthy(),
  );
};

afterEach(() => {
  cleanup();
});

describe("Lens save controls", () => {
  describe("given an ordinary project", () => {
    describe("when ana opens a lens tab's menu", () => {
      it("offers to create, save, rename, duplicate and delete a lens", async () => {
        projectRef.current = { id: "proj-1", kind: "application" };
        useExplorerStore.getState().setUserLenses([USER_LENS]);

        renderToolbarBits();
        await openLensMenu();

        expect(
          screen.getByRole("button", { name: "Create new lens" }),
        ).toBeTruthy();
        expect(screen.getByText("Save as new lens…")).toBeTruthy();
        expect(screen.getByText("Rename")).toBeTruthy();
        expect(screen.getByText("Duplicate")).toBeTruthy();
        expect(screen.getByText("Delete")).toBeTruthy();
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

        expect(
          screen.queryByRole("button", { name: "Create new lens" }),
        ).toBeNull();
        expect(screen.queryByText("Save as new lens…")).toBeNull();
        expect(screen.queryByText("Rename")).toBeNull();
        expect(screen.queryByText("Duplicate")).toBeNull();
        expect(screen.queryByText("Delete")).toBeNull();
      });
    });
  });
});
