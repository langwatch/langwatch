/**
 * @vitest-environment jsdom
 *
 * The shared studio field editor (Results / Inputs / Outputs on every node
 * panel) picks a field's type through the same outline FieldTypeSelect used
 * across the app - an icon plus the type NAME (Text, Number, ...) that reads
 * as clickable - rather than a bare decorative type label over a hidden
 * native select. Picking a type writes it back through the node.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Node } from "@xyflow/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Component } from "@langwatch/workflow-contract";
import { FieldsDefinition } from "@langwatch/workflow-web";
import { _useWorkflowStore } from "../src/hooks/use-workflow-store";

vi.mock("@xyflow/react", () => ({
  useUpdateNodeInternals: () => vi.fn(),
}));

const node = (inputs: Component["inputs"]): Node<Component> => ({
  id: "node1",
  type: "code",
  position: { x: 0, y: 0 },
  data: { name: "Node", inputs },
});

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const renderFields = ({
  inputs,
  readOnly = false,
}: {
  inputs: Component["inputs"];
  readOnly?: boolean;
}) => {
  const workflowNode = node(inputs);
  _useWorkflowStore.getState().setNodes([workflowNode]);

  return render(
    <ChakraProvider value={defaultSystem}>
      <FieldsDefinition node={workflowNode} field="inputs" title="Results" readOnly={readOnly} />
    </ChakraProvider>,
  );
};

describe("FieldsDefinition type selector", () => {
  beforeEach(() => {
    _useWorkflowStore.getState().reset();
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  describe("when the fields are editable", () => {
    /** @scenario The field type selector reads as a clickable outline button */
    it("shows the type name in an outline button, not a bare native select", () => {
      renderFields({ inputs: [{ identifier: "result", type: "str" }] });

      const select = screen.getByTestId("field-type-select-inputs-0");
      expect(select).not.toBeNull();
      expect(within(select).getByText("Text")).not.toBeNull();
      // The old hidden <option>/<select> picker is gone.
      expect(screen.queryByRole("combobox")).toBeNull();
    });

    /** @scenario Picking a type from the menu writes it back to the node */
    it("updates the field type through the node when a menu option is picked", async () => {
      renderFields({ inputs: [{ identifier: "result", type: "str" }] });

      const user = userEvent.setup();
      await user.click(screen.getByTestId("field-type-select-inputs-0"));
      await user.click(screen.getByTestId("field-type-option-float"));

      await waitFor(() => {
        expect(_useWorkflowStore.getState().nodes[0]?.data.inputs).toEqual([
          { identifier: "result", type: "float" },
        ]);
      });
    });
  });

  describe("when the fields are read-only", () => {
    /** @scenario Read-only field types render as a static icon and label */
    it("shows the type label without a clickable trigger", () => {
      renderFields({
        inputs: [{ identifier: "score", type: "float" }],
        readOnly: true,
      });

      const select = screen.getByTestId("field-type-select-inputs-0");
      expect(within(select).getByText("Number")).not.toBeNull();
      expect(screen.queryByRole("button")).toBeNull();
    });
  });
});
