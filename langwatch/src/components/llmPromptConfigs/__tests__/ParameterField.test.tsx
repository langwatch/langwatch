/**
 * @vitest-environment jsdom
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ParameterField } from "../ParameterField";
import type {
  SelectParameterConfig,
  SliderParameterConfig,
} from "../parameterConfig";

function renderWithChakra(ui: React.ReactElement) {
  return render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);
}

afterEach(() => {
  cleanup();
});

describe("ParameterField", () => {
  describe("Select Parameters", () => {
    // Uses unified 'reasoning' field with dynamic label
    const reasoningConfig: SelectParameterConfig = {
      type: "select",
      options: ["low", "medium", "high"] as const,
      default: "medium",
      label: "Reasoning", // Default label (can be overridden by dynamic label)
      helper: "How much the model thinks",
    };

    it("calls onChange when selection changes", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();

      renderWithChakra(
        <ParameterField
          name="reasoning" // Uses unified field name
          config={reasoningConfig}
          value="medium"
          onChange={onChange}
        />,
      );

      const select = screen.getByRole("combobox");
      await user.selectOptions(select, "high");

      expect(onChange).toHaveBeenCalledWith("high");
    });
  });
});
