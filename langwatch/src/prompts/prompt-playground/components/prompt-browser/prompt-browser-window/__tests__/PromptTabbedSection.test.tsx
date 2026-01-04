/**
 * @vitest-environment jsdom
 *
 * Integration tests for PromptTabbedSection features:
 * - Locked input variable handling
 * - Demonstrations tab visibility
 * - Variable values persistence
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VariablesSection, type Variable } from "~/components/variables";
import {
  clearStoreInstances,
  getStoreForTesting,
  type TabData,
} from "../../../../prompt-playground-store/DraggableTabsBrowserStore";

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

global.localStorage = localStorageMock as Storage;

const TEST_PROJECT_ID = "test-project";

// Mock useOrganizationTeamProject
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: TEST_PROJECT_ID },
    projectId: TEST_PROJECT_ID,
  }),
}));

// The locked variables configuration from PromptTabbedSection
const LOCKED_VARIABLES = new Set(["input"]);
const VARIABLE_INFO: Record<string, string> = {
  input: "This value comes from the Conversation tab input",
};

const renderVariablesSection = (props: {
  variables: Variable[];
  onChange?: (variables: Variable[]) => void;
  values?: Record<string, string>;
  onValueChange?: (identifier: string, value: string) => void;
}) => {
  const onChange = props.onChange ?? vi.fn();
  const onValueChange = props.onValueChange ?? vi.fn();

  return render(
    <ChakraProvider value={defaultSystem}>
      <VariablesSection
        variables={props.variables}
        onChange={onChange}
        values={props.values ?? {}}
        onValueChange={onValueChange}
        showMappings={false}
        canAddRemove={true}
        readOnly={false}
        title="Variables"
        lockedVariables={LOCKED_VARIABLES}
        variableInfo={VARIABLE_INFO}
      />
    </ChakraProvider>
  );
};

describe("Playground Variables Section Integration", () => {
  afterEach(() => {
    cleanup();
  });

  describe("locked input variable", () => {
    it("shows input variable with info icon", () => {
      renderVariablesSection({
        variables: [{ identifier: "input", type: "str" }],
      });

      expect(screen.getByText("input")).toBeInTheDocument();
      expect(screen.getByTestId("variable-info-input")).toBeInTheDocument();
    });

    it("does not show delete button for input variable", () => {
      renderVariablesSection({
        variables: [{ identifier: "input", type: "str" }],
      });

      expect(screen.queryByTestId("remove-variable-input")).not.toBeInTheDocument();
    });

    it("shows delete button for non-locked variables", () => {
      renderVariablesSection({
        variables: [
          { identifier: "input", type: "str" },
          { identifier: "context", type: "str" },
        ],
      });

      // Input should not have delete button
      expect(screen.queryByTestId("remove-variable-input")).not.toBeInTheDocument();
      // Context should have delete button
      expect(screen.getByTestId("remove-variable-context")).toBeInTheDocument();
    });

    it("prevents editing locked variable name by making it read-only", () => {
      renderVariablesSection({
        variables: [{ identifier: "input", type: "str" }],
      });

      // The variable name should have cursor: default (not pointer) since it's locked
      const nameElement = screen.getByTestId("variable-name-input");
      expect(nameElement).toHaveStyle({ cursor: "default" });
    });
  });

  describe("adding and removing variables", () => {
    it("can add a new variable", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();

      renderVariablesSection({
        variables: [{ identifier: "input", type: "str" }],
        onChange,
      });

      await user.click(screen.getByTestId("add-variable-button"));

      // onChange should be called with the new variable added
      expect(onChange).toHaveBeenCalledWith([
        { identifier: "input", type: "str" },
        { identifier: "input_1", type: "str" },
      ]);
    });

    it("can remove a non-locked variable", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();

      renderVariablesSection({
        variables: [
          { identifier: "input", type: "str" },
          { identifier: "context", type: "str" },
        ],
        onChange,
      });

      await user.click(screen.getByTestId("remove-variable-context"));

      // onChange should be called with only input remaining
      expect(onChange).toHaveBeenCalledWith([{ identifier: "input", type: "str" }]);
    });

    it("cannot remove the locked input variable", () => {
      renderVariablesSection({
        variables: [
          { identifier: "input", type: "str" },
          { identifier: "context", type: "str" },
        ],
      });

      // Input delete button should not exist
      expect(screen.queryByTestId("remove-variable-input")).not.toBeInTheDocument();
      // But we can still see the variable
      expect(screen.getByText("input")).toBeInTheDocument();
    });
  });

  describe("variable values", () => {
    it("displays values for variables", () => {
      renderVariablesSection({
        variables: [
          { identifier: "input", type: "str" },
          { identifier: "context", type: "str" },
        ],
        values: {
          input: "Hello world",
          context: "Some context",
        },
      });

      // Values should be shown in inputs
      const inputs = screen.getAllByRole("textbox");
      expect(inputs.some((input) => (input as HTMLInputElement).value === "Hello world")).toBe(true);
      expect(inputs.some((input) => (input as HTMLInputElement).value === "Some context")).toBe(true);
    });

    it("calls onValueChange when value is edited", async () => {
      const user = userEvent.setup();
      const onValueChange = vi.fn();

      renderVariablesSection({
        variables: [{ identifier: "input", type: "str" }],
        values: { input: "" },
        onValueChange,
      });

      const inputs = screen.getAllByRole("textbox");
      const valueInput = inputs.find((input) => (input as HTMLInputElement).value === "");

      if (valueInput) {
        await user.type(valueInput, "test");
        expect(onValueChange).toHaveBeenCalled();
      }
    });
  });
});

/**
 * Helper to create a minimal TabData object for testing
 */
const createTabData = (overrides?: Partial<TabData>): TabData => ({
  chat: {
    initialMessagesFromSpanData: [],
  },
  form: {
    currentValues: {},
  },
  meta: {
    title: null,
    versionNumber: undefined,
    scope: undefined,
  },
  variableValues: {},
  ...overrides,
});

describe("PromptTabbedSection Store Integration", () => {
  let store: ReturnType<typeof getStoreForTesting>;

  beforeEach(() => {
    localStorage.clear();
    clearStoreInstances();
    store = getStoreForTesting(TEST_PROJECT_ID);
  });

  afterEach(() => {
    cleanup();
    clearStoreInstances();
    localStorage.clear();
  });

  describe("variable values persistence", () => {
    it("stores variable values in tab data", () => {
      // Create tab with initial variable values
      store.getState().addTab({
        data: createTabData({
          variableValues: {
            name: "John",
            context: "Some context",
          },
        }),
      });

      const tabId = store.getState().windows[0]?.tabs[0]?.id;
      const tabData = store.getState().getByTabId(tabId!);

      expect(tabData?.variableValues).toEqual({
        name: "John",
        context: "Some context",
      });
    });

    it("updates variable values via updateTabData", () => {
      store.getState().addTab({ data: createTabData() });

      const tabId = store.getState().windows[0]?.tabs[0]?.id;
      expect(tabId).toBeDefined();

      // Simulate what handleValueChange does in PromptTabbedSection
      store.getState().updateTabData({
        tabId: tabId!,
        updater: (data) => ({
          ...data,
          variableValues: {
            ...data.variableValues,
            name: "Updated value",
          },
        }),
      });

      const tabData = store.getState().getByTabId(tabId!);
      expect(tabData?.variableValues.name).toBe("Updated value");
    });

    it("persists variable values to localStorage", () => {
      store.getState().addTab({
        data: createTabData({
          variableValues: { name: "Persisted" },
        }),
      });

      // Check localStorage contains the value
      const storageKey = `${TEST_PROJECT_ID}:draggable-tabs-browser-store`;
      const storedData = localStorage.getItem(storageKey);
      expect(storedData).toBeDefined();
      expect(storedData).toContain("Persisted");
    });

    it("each tab maintains separate variable values", () => {
      store.getState().addTab({
        data: createTabData({ variableValues: { name: "Tab1Value" } }),
      });
      store.getState().addTab({
        data: createTabData({ variableValues: { name: "Tab2Value" } }),
      });

      const tab1Id = store.getState().windows[0]?.tabs[0]?.id;
      const tab2Id = store.getState().windows[0]?.tabs[1]?.id;

      const tab1Data = store.getState().getByTabId(tab1Id!);
      const tab2Data = store.getState().getByTabId(tab2Id!);

      expect(tab1Data?.variableValues.name).toBe("Tab1Value");
      expect(tab2Data?.variableValues.name).toBe("Tab2Value");

      // Update tab1, tab2 should remain unchanged
      store.getState().updateTabData({
        tabId: tab1Id!,
        updater: (data) => ({
          ...data,
          variableValues: { name: "Tab1Updated" },
        }),
      });

      expect(store.getState().getByTabId(tab1Id!)?.variableValues.name).toBe(
        "Tab1Updated"
      );
      expect(store.getState().getByTabId(tab2Id!)?.variableValues.name).toBe(
        "Tab2Value"
      );
    });
  });

  describe("demonstrations tab logic", () => {
    it("demonstrates transposeColumnsFirstToRowsFirstWithId returns empty for no data", async () => {
      const { transposeColumnsFirstToRowsFirstWithId } = await import(
        "~/optimization_studio/utils/datasetUtils"
      );

      const result = transposeColumnsFirstToRowsFirstWithId({});
      expect(result).toEqual([]);
    });

    it("demonstrates transposeColumnsFirstToRowsFirstWithId returns rows for data", async () => {
      const { transposeColumnsFirstToRowsFirstWithId } = await import(
        "~/optimization_studio/utils/datasetUtils"
      );

      const records = {
        input: ["hello", "world"],
        output: ["hi", "earth"],
      };

      const result = transposeColumnsFirstToRowsFirstWithId(records);
      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty("input", "hello");
      expect(result[0]).toHaveProperty("output", "hi");
    });
  });
});
