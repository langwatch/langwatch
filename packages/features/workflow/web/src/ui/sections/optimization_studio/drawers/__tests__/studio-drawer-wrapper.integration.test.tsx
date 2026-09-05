/**
 * @vitest-environment jsdom
 *
 * The node drawer header's "..." menu (Duplicate/Delete) for regular component nodes; structural entry/end nodes cannot be duplicated or deleted, so it's hidden for them. See specs/optimization-studio/node-duplicate-delete-menu.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Node } from "@xyflow/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Component } from "@langwatch/workflow-contract";

const mockDuplicateNode = vi.fn();
const mockDeleteNode = vi.fn();
const mockDeselectAllNodes = vi.fn();
const mockSetPropertiesExpanded = vi.fn();

vi.mock("../../../../../behavior/use-workflow-store", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkflowStore: (selector: (state: unknown) => unknown) =>
    selector({
      deselectAllNodes: mockDeselectAllNodes,
      propertiesExpanded: false,
      setPropertiesExpanded: mockSetPropertiesExpanded,
      duplicateNode: mockDuplicateNode,
      deleteNode: mockDeleteNode,
    }),
}));
vi.mock("../../../../elements/workflow-icons", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ComponentIcon: () => <div data-testid="component-icon" />,
}));
vi.mock("../../../workflow-node-execution", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ComponentExecutionButton: () => <div data-testid="exec-button" />,
}));
vi.mock("../../../workflow-nodes", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getNodeDisplayName: (node: Node<Component>) => node.data.name ?? node.id,
}));

vi.mock("zustand/react/shallow", () => ({
  useShallow: (fn: unknown) => fn,
}));

vi.mock("usehooks-ts", () => ({
  useWindowSize: () => ({ width: 1200, height: 800 }),
}));

vi.mock("../../component_execution/input-panel", () => ({
  InputPanel: () => <div data-testid="input-panel" />,
}));

vi.mock("../../component_execution/output-panel", () => ({
  OutputPanel: () => <div data-testid="output-panel" />,
}));

const { StudioDrawerWrapper } = await import("../studio-drawer-wrapper");

function makeNode(type: string): Node<Component> {
  return {
    id: `${type}-1`,
    type,
    position: { x: 0, y: 0 },
    data: { name: `${type} node` } as Component,
  } as Node<Component>;
}

function renderDrawer(node: Node<Component>) {
  const onClose = vi.fn();
  render(
    <ChakraProvider value={defaultSystem}>
      <StudioDrawerWrapper node={node} onClose={onClose}>
        <div>body</div>
      </StudioDrawerWrapper>
    </ChakraProvider>,
  );
  return { onClose };
}

describe("StudioDrawerWrapper node action menu", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  describe("when a regular component node is selected", () => {
    /** @scenario "The node drawer offers a duplicate action" */
    it("duplicates the node when Duplicate is chosen from the action menu", async () => {
      const user = userEvent.setup();
      const node = makeNode("signature");
      renderDrawer(node);

      await user.click(screen.getByLabelText("Node actions"));
      await user.click(await screen.findByRole("menuitem", { name: "Duplicate" }));

      expect(mockDuplicateNode).toHaveBeenCalledWith(node.id);
    });

    /** @scenario "The node drawer offers a delete action" */
    it("deletes the node and closes the drawer when Delete is chosen", async () => {
      const user = userEvent.setup();
      const node = makeNode("signature");
      const { onClose } = renderDrawer(node);

      await user.click(screen.getByLabelText("Node actions"));
      await user.click(await screen.findByRole("menuitem", { name: "Delete" }));

      expect(mockDeleteNode).toHaveBeenCalledWith(node.id);
      expect(mockDeselectAllNodes).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe("when a structural entry node is selected", () => {
    /** @scenario "Structural nodes do not expose the action menu" */
    it("does not show the node action menu", () => {
      renderDrawer(makeNode("entry"));
      expect(screen.queryByLabelText("Node actions")).toBeNull();
    });
  });
});
