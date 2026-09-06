/**
 * @vitest-environment jsdom
 * Naming a code block: its id and Python class are derived from the name.
 * @see specs/studio/rename-code-blocks.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Node } from "@xyflow/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const setNode = vi.fn();

vi.mock("../../../behavior/use-workflow-store", () => ({
  useWorkflowStore: (selector: (state: unknown) => unknown) =>
    selector({
      deselectAllNodes: vi.fn(),
      propertiesExpanded: false,
      setPropertiesExpanded: vi.fn(),
      setNode,
      nodes: [
        { id: "code1", type: "code" },
        { id: "entry", type: "entry" },
      ],
    }),
}));

vi.mock("@xyflow/react", () => ({
  useUpdateNodeInternals: () => vi.fn(),
}));

vi.mock("../../elements/studio-drawer-footer", () => ({
  useInsideDrawer: () => false,
}));

const toast = vi.fn();
vi.mock("@langwatch/ui-host/toaster", () => ({
  toaster: { create: (...args: unknown[]) => toast(...args) },
}));

import { WorkflowNodeHostProvider } from "../../elements/workflow-node.host";
import { BasePropertiesPanel } from "../optimization_studio/properties/base-properties-panel";

/** The host the node renderers read, filled with what this panel touches. */
const nodeHost = {
  ComponentIcon: () => null,
  LLMModelDisplay: () => null,
  HoverableBigText: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useColorModeValue: (light: string) => light,
  useComponentExecution: () => ({
    startComponentExecution: vi.fn(),
    stopComponentExecution: vi.fn(),
  }),
  useComponentVersion: () => ({ currentVersion: null }),
  useEntryDatasetTotal: () => null,
} as never;

const codeNode = (): Node =>
  ({
    id: "code1",
    type: "code",
    position: { x: 0, y: 0 },
    data: {
      name: "code1",
      inputs: [],
      outputs: [],
      parameters: [
        { identifier: "code", type: "code", value: "class Code1(dspy.Module):\n    pass\n" },
      ],
    },
  }) as unknown as Node;

const renderPanel = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <WorkflowNodeHostProvider value={nodeHost}>
        <BasePropertiesPanel node={codeNode()} />
      </WorkflowNodeHostProvider>
    </ChakraProvider>,
  );

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("given a code block selected in the studio", () => {
  describe("when its properties panel opens", () => {
    /** @scenario "Display editable name in code block properties panel" */
    it("shows the block's current name, and turns it into a field when clicked", async () => {
      const user = userEvent.setup();
      renderPanel();

      await user.click(screen.getByText("code1"));

      expect(screen.getByRole("textbox")).toHaveValue("code1");
    });
  });

  describe("when a new name is typed and confirmed", () => {
    /**
     * @scenario "Rename a code block via the properties panel"
     * @scenario "Rename updates the node ID and Python class name"
     */
    it("renames the block and re-addresses the node by the id the name makes", async () => {
      const user = userEvent.setup();
      renderPanel();

      await user.click(screen.getByText("code1"));
      const field = screen.getByRole("textbox");
      await user.clear(field);
      await user.type(field, "Data Processor{Enter}");

      // The name is what a person reads; the id is what the graph, the edges
      // and the generated Python class are all keyed on, so one write carries
      // both rather than letting them drift.
      expect(setNode).toHaveBeenCalledWith(
        { id: "code1", data: { name: "Data Processor" } },
        "data_processor",
      );
    });
  });

  describe("when the typed name cannot be a node id", () => {
    /** @scenario "Rename a code block via the properties panel" */
    it("keeps the block as it was rather than writing a name nothing can address", async () => {
      const user = userEvent.setup();
      render(
        <ChakraProvider value={defaultSystem}>
          <WorkflowNodeHostProvider value={nodeHost}>
            <BasePropertiesPanel node={codeNode()} />
          </WorkflowNodeHostProvider>
        </ChakraProvider>,
      );

      await user.click(screen.getByText("code1"));
      const field = screen.getByRole("textbox");
      await user.clear(field);
      await user.type(field, "123test{Enter}");

      expect(setNode).not.toHaveBeenCalled();
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Invalid name" }));
    });
  });
});
