/**
 * @vitest-environment jsdom
 *
 * The node drawer header exposes a "..." action menu (Duplicate / Delete) for
 * regular component nodes, giving users a discoverable way to manage a node
 * without keyboard shortcuts. Structural entry/end nodes cannot be duplicated
 * or deleted, so the menu is not shown for them.
 *
 * Specs: specs/optimization-studio/node-duplicate-delete-menu.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { Node } from "@xyflow/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Component } from "../../../types/dsl";

const mockDuplicateNode = vi.fn();
const mockDeleteNode = vi.fn();
const mockDeselectAllNodes = vi.fn();
const mockSetPropertiesExpanded = vi.fn();

vi.mock("../../../hooks/useWorkflowStore", () => ({
  useWorkflowStore: (selector: (state: unknown) => unknown) =>
    selector({
      deselectAllNodes: mockDeselectAllNodes,
      propertiesExpanded: false,
      setPropertiesExpanded: mockSetPropertiesExpanded,
      duplicateNode: mockDuplicateNode,
      deleteNode: mockDeleteNode,
    }),
}));

vi.mock("zustand/react/shallow", () => ({
  useShallow: (fn: unknown) => fn,
}));

vi.mock("usehooks-ts", () => ({
  useWindowSize: () => ({ width: 1200, height: 800 }),
}));

vi.mock("../../ColorfulBlockIcons", () => ({
  ComponentIcon: () => <div data-testid="component-icon" />,
}));

vi.mock("../../nodes/Nodes", () => ({
  ComponentExecutionButton: () => <div data-testid="exec-button" />,
  getNodeDisplayName: (node: Node<Component>) => node.data.name ?? node.id,
}));

vi.mock("../../component_execution/InputPanel", () => ({
  InputPanel: () => <div data-testid="input-panel" />,
}));

vi.mock("../../component_execution/OutputPanel", () => ({
  OutputPanel: () => <div data-testid="output-panel" />,
}));

const { StudioDrawerWrapper } = await import("../StudioDrawerWrapper");

function makeNode(type: string): Node<Component> {
  return {
    id: `${type}-1`,
    type,
    position: { x: 0, y: 0 },
    data: { name: `${type} node` } as Component,
  } as Node<Component>;
}

function renderDrawer(node: Node<Component>) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <StudioDrawerWrapper node={node} onClose={vi.fn()}>
        <div>body</div>
      </StudioDrawerWrapper>
    </ChakraProvider>,
  );
}

describe("StudioDrawerWrapper node action menu", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  describe("when a regular component node is selected", () => {
    /** @scenario "The node drawer offers a duplicate action" */
    /** @scenario "The node drawer offers a delete action" */
    it("shows the node action menu trigger in the drawer header", () => {
      renderDrawer(makeNode("signature"));
      expect(screen.getByLabelText("Node actions")).toBeTruthy();
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
