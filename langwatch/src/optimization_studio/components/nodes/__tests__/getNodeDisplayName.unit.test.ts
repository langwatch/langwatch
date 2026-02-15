import { describe, it, expect, vi } from "vitest";

// Mock the heavy UI dependencies so we can import getNodeDisplayName in isolation
vi.mock("@xyflow/react", () => ({
  Handle: () => null,
  NodeToolbar: () => null,
  Position: { Left: "left", Right: "right", Top: "top", Bottom: "bottom" },
  useReactFlow: () => ({ getNodes: () => [], getEdges: () => [] }),
}));
vi.mock("react-dnd", () => ({ useDragLayer: () => ({}) }));
vi.mock("usehooks-ts", () => ({ useDebounceValue: (v: unknown) => [v] }));
vi.mock("zustand/react/shallow", () => ({
  useShallow: (fn: unknown) => fn,
}));
vi.mock("../../../../components/evaluations/wizard/hooks/useWizardContext", () => ({
  useWizardContext: () => ({ isInsideWizard: false }),
}));
vi.mock("../../../../components/llmPromptConfigs/LLMModelDisplay", () => ({
  LLMModelDisplay: () => null,
}));
vi.mock("../../../../components/ui/menu", () => ({ Menu: {} }));
vi.mock("../../../../components/ui/tooltip", () => ({
  Tooltip: () => null,
}));
vi.mock("../../../hooks/useComponentExecution", () => ({
  useComponentExecution: () => ({}),
}));
vi.mock("../../../hooks/useWorkflowExecution", () => ({
  useWorkflowExecution: () => ({}),
}));
vi.mock("../../../hooks/useWorkflowStore", () => ({
  useWorkflowStore: () => ({}),
}));
vi.mock("../../../utils/nodeUtils", () => ({
  checkIsEvaluator: () => false,
}));
vi.mock("../../../utils/unsavedChanges", () => ({
  hasUnsavedChanges: () => false,
}));
vi.mock("../../ColorfulBlockIcons", () => ({
  ComponentIcon: () => null,
}));

// Now import the function under test
const { getNodeDisplayName } = await import("../Nodes");

describe("getNodeDisplayName", () => {
  describe("when node has localConfig.name", () => {
    it("returns localConfig.name", () => {
      const node = {
        id: "node-1",
        data: {
          localConfig: { name: "Local Name" },
          name: "DB Name",
          cls: "SomeClass",
        },
      };
      expect(getNodeDisplayName(node as any)).toBe("Local Name");
    });
  });

  describe("when node has no localConfig but has name", () => {
    it("returns data.name", () => {
      const node = {
        id: "node-1",
        data: { name: "Node Name", cls: "SomeClass" },
      };
      expect(getNodeDisplayName(node as any)).toBe("Node Name");
    });
  });

  describe("when node has no name but has cls", () => {
    it("returns data.cls", () => {
      const node = { id: "node-1", data: { cls: "SomeClass" } };
      expect(getNodeDisplayName(node as any)).toBe("SomeClass");
    });
  });

  describe("when node has only id", () => {
    it("returns node.id", () => {
      const node = { id: "node-1", data: {} };
      expect(getNodeDisplayName(node as any)).toBe("node-1");
    });
  });
});
