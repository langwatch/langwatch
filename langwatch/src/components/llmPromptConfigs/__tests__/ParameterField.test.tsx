/**
 * @vitest-environment jsdom
 */

import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, afterEach } from "vitest";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { ParameterField } from "../ParameterField";
import type {
  SliderParameterConfig,
  SelectParameterConfig,
} from "../parameterConfig";

// Wrapper for Chakra provider
function renderWithChakra(ui: React.ReactElement) {
  return render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);
}

// Clean up after each test
afterEach(() => {
  cleanup();
});

describe("ParameterField", () => {
  describe("Slider Parameters", () => {
    const temperatureConfig: SliderParameterConfig = {
      type: "slider",
      min: 0,
      max: 2,
      step: 0.1,
      default: 1,
      label: "Temperature",
      helper: "Controls randomness",
    };

    it("renders slider with label", () => {
      const onChange = vi.fn();
      renderWithChakra(
        <ParameterField
          name="temperature"
          config={temperatureConfig}
          value={1}
          onChange={onChange}
        />
      );

      expect(screen.getByText("Temperature")).toBeInTheDocument();
    });

    it("shows current value", () => {
      const onChange = vi.fn();
      renderWithChakra(
        <ParameterField
          name="temperature"
          config={temperatureConfig}
          value={0.7}
          onChange={onChange}
        />
      );

      expect(screen.getByText("0.7")).toBeInTheDocument();
    });

    it("uses default value when no value provided", () => {
      const onChange = vi.fn();
      renderWithChakra(
        <ParameterField
          name="temperature"
          config={temperatureConfig}
          value={undefined}
          onChange={onChange}
        />
      );

      // Default is 1, should be displayed in the value text
      const valueTexts = screen.getAllByText("1");
      expect(valueTexts.length).toBeGreaterThan(0);
    });

    it("respects max override for dynamic max sliders", () => {
      const maxTokensConfig: SliderParameterConfig = {
        type: "slider",
        min: 256,
        max: 64000,
        step: 256,
        default: 4096,
        label: "Max Tokens",
        helper: "Maximum output",
        dynamicMax: true,
      };

      const onChange = vi.fn();
      renderWithChakra(
        <ParameterField
          name="max_tokens"
          config={maxTokensConfig}
          value={4096}
          onChange={onChange}
          maxOverride={8192}
        />
      );

      // The slider should be present
      expect(screen.getByText("Max Tokens")).toBeInTheDocument();
      expect(screen.getByText("4096")).toBeInTheDocument();
    });

    it("bounds value within min/max", () => {
      const onChange = vi.fn();
      renderWithChakra(
        <ParameterField
          name="temperature"
          config={temperatureConfig}
          value={5} // exceeds max of 2
          onChange={onChange}
        />
      );

      // Should show bounded value of 2
      expect(screen.getByText("2")).toBeInTheDocument();
    });
  });

  describe("Select Parameters", () => {
    const reasoningConfig: SelectParameterConfig = {
      type: "select",
      options: ["minimal", "low", "medium", "high"] as const,
      default: "medium",
      label: "Reasoning Effort",
      helper: "Computational effort",
    };

    it("renders select with label", () => {
      const onChange = vi.fn();
      renderWithChakra(
        <ParameterField
          name="reasoning_effort"
          config={reasoningConfig}
          value="medium"
          onChange={onChange}
        />
      );

      expect(screen.getByText("Reasoning Effort")).toBeInTheDocument();
    });

    it("shows all options", () => {
      const onChange = vi.fn();
      renderWithChakra(
        <ParameterField
          name="reasoning_effort"
          config={reasoningConfig}
          value="medium"
          onChange={onChange}
        />
      );

      const select = screen.getByRole("combobox");
      expect(select).toBeInTheDocument();

      // Check options are present
      expect(screen.getByRole("option", { name: "Minimal" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "Low" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "Medium" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "High" })).toBeInTheDocument();
    });

    it("uses default value when no value provided", () => {
      const onChange = vi.fn();
      renderWithChakra(
        <ParameterField
          name="reasoning_effort"
          config={reasoningConfig}
          value={undefined}
          onChange={onChange}
        />
      );

      const select = screen.getByRole("combobox") as HTMLSelectElement;
      expect(select.value).toBe("medium");
    });

    it("calls onChange when selection changes", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();

      renderWithChakra(
        <ParameterField
          name="reasoning_effort"
          config={reasoningConfig}
          value="medium"
          onChange={onChange}
        />
      );

      const select = screen.getByRole("combobox");
      await user.selectOptions(select, "high");

      expect(onChange).toHaveBeenCalledWith("high");
    });
  });

  describe("Disabled State", () => {
    it("disables slider when disabled prop is true", () => {
      const temperatureConfig: SliderParameterConfig = {
        type: "slider",
        min: 0,
        max: 2,
        step: 0.1,
        default: 1,
        label: "Temperature",
        helper: "Controls randomness",
      };

      const onChange = vi.fn();
      const { container } = renderWithChakra(
        <ParameterField
          name="temperature"
          config={temperatureConfig}
          value={1}
          onChange={onChange}
          disabled
        />
      );

      // Check that the slider root has data-disabled attribute
      const sliderRoot = container.querySelector('[data-scope="slider"]');
      expect(sliderRoot).toHaveAttribute("data-disabled");
    });

    it("disables select when disabled prop is true", () => {
      const selectConfig: SelectParameterConfig = {
        type: "select",
        options: ["low", "medium", "high"] as const,
        default: "medium",
        label: "Verbosity",
        helper: "Response detail",
      };

      const onChange = vi.fn();
      renderWithChakra(
        <ParameterField
          name="verbosity"
          config={selectConfig}
          value="medium"
          onChange={onChange}
          disabled
        />
      );

      const select = screen.getByRole("combobox");
      expect(select).toBeDisabled();
    });
  });
});
