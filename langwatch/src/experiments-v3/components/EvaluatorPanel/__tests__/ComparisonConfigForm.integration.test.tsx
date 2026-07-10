/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ComparisonEvaluatorConfig, TargetConfig } from "../../../types";
import { ComparisonConfigForm } from "../ComparisonConfigForm";

// The variant multiselect's menu items resolve display names via
// useTargetName, which reaches through useOrganizationTeamProject to
// tRPC — the full tRPC context is out of scope for a component
// integration test. Mock the hook to return the target's id so the
// dropdown still renders with a stable label.
vi.mock("../../../hooks/useTargetName", () => ({
  useTargetName: (target: { id: string }) => target.id,
}));

// Same rationale as PairwiseConfigForm's integration test: the metrics
// section reads its "source of truth" via useFormContext + useWatch
// (mirroring settings.include_metrics — the field the Python judge
// actually reads), so a real form context is required.
const FormWrapper = ({ children }: { children: ReactNode }) => {
  const methods = useForm({
    defaultValues: { settings: { include_metrics: [] as string[] } },
  });
  return (
    <ChakraProvider value={defaultSystem}>
      <FormProvider {...methods}>{children}</FormProvider>
    </ChakraProvider>
  );
};

const baseConfig = (
  overrides: Partial<ComparisonEvaluatorConfig> = {},
): ComparisonEvaluatorConfig => ({
  variants: [],
  hasGoldenAnswer: true,
  goldenField: "",
  includeMetrics: [],
  randomizeOrder: true,
  ...overrides,
});

const target = (id: string): TargetConfig => ({
  id,
  type: "prompt",
  promptId: `prompt_${id}`,
  inputs: [],
  outputs: [],
  mappings: {},
});

const renderForm = (
  props: Partial<React.ComponentProps<typeof ComparisonConfigForm>> = {},
) => {
  const value = props.value ?? baseConfig();
  return render(
    <FormWrapper>
      <ComparisonConfigForm
        value={value}
        onChange={vi.fn()}
        targets={props.targets ?? [target("t1"), target("t2"), target("t3")]}
        datasetColumns={
          props.datasetColumns ?? [{ id: "col-1", name: "expected_output" }]
        }
        {...props}
      />
    </FormWrapper>,
  );
};

describe("ComparisonConfigForm", () => {
  afterEach(() => {
    cleanup();
  });

  describe("given fewer than 2 variants selected", () => {
    it("shows an insufficient-variants warning", () => {
      renderForm({ value: baseConfig({ variants: [] }) });
      expect(
        screen.getByTestId("comparison-variants-insufficient"),
      ).toBeInTheDocument();
    });

    it("still shows the warning when exactly 1 variant is selected", () => {
      renderForm({ value: baseConfig({ variants: ["t1"] }) });
      expect(
        screen.getByTestId("comparison-variants-insufficient"),
      ).toBeInTheDocument();
    });
  });

  describe("given 2 or more variants selected", () => {
    it("hides the insufficient-variants warning", () => {
      renderForm({ value: baseConfig({ variants: ["t1", "t2"] }) });
      expect(
        screen.queryByTestId("comparison-variants-insufficient"),
      ).not.toBeInTheDocument();
    });
  });

  describe("when the user picks a variant", () => {
    it("adds it to variants and calls onChange with the new list", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      renderForm({ value: baseConfig({ variants: [] }), onChange });

      await user.click(screen.getByTestId("comparison-add-variant"));
      await user.click(screen.getByTestId("comparison-variant-option-t1"));

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ variants: ["t1"] }),
      );
    });

    it("removes a previously-picked variant when its chip's ✕ is clicked", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      renderForm({ value: baseConfig({ variants: ["t1", "t2"] }), onChange });

      await user.click(
        screen.getByTestId("comparison-variant-chip-t1-remove"),
      );

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ variants: ["t2"] }),
      );
    });
  });

  describe("when the user picks a golden field", () => {
    it("writes it into goldenField and calls onChange", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      renderForm({ onChange });

      await user.click(screen.getByTestId("comparison-golden-field"));
      await user.click(
        screen.getByTestId("comparison-golden-field-option-expected_output"),
      );

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ goldenField: "expected_output" }),
      );
    });
  });

  describe("the include-metrics section", () => {
    it("renders the two toggles", () => {
      renderForm();
      expect(screen.getByTestId("comparison-include-cost")).toBeInTheDocument();
      expect(
        screen.getByTestId("comparison-include-duration"),
      ).toBeInTheDocument();
    });
  });
});
