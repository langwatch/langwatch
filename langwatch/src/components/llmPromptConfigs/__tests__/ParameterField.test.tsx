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
    const reasoningConfig: SelectParameterConfig = {
      type: "select",
      options: ["low", "medium", "high"] as const,
      default: "medium",
      label: "Reasoning Effort",
      helper: "How much the model thinks",
    };

    it("calls onChange when selection changes", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();

      renderWithChakra(
        <ParameterField
          name="reasoning_effort"
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
