/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PairwiseEvaluatorConfig } from "../../../types";
import { PairwiseConfigForm } from "../PairwiseConfigForm";

// PairwiseConfigForm's Golden Answer / Include metrics sections read their
// "source of truth" via useFormContext + useWatch (mirroring
// settings.has_golden_answer / settings.include_metrics, the fields the
// judge actually reads) — same as production, where this component only
// ever renders inside EvaluatorEditorShared's FormProvider. useWatch throws
// if there's no real form context, so tests need one too, not just an
// optional-chained stand-in.
const FormWrapper = ({
  hasGoldenAnswer,
  children,
}: {
  hasGoldenAnswer: boolean;
  children: ReactNode;
}) => {
  const methods = useForm({
    defaultValues: { settings: { has_golden_answer: hasGoldenAnswer } },
  });
  return (
    <ChakraProvider value={defaultSystem}>
      <FormProvider {...methods}>{children}</FormProvider>
    </ChakraProvider>
  );
};

const baseConfig = (
  overrides: Partial<PairwiseEvaluatorConfig> = {},
): PairwiseEvaluatorConfig => ({
  variantA: "",
  variantB: "",
  hasGoldenAnswer: true,
  goldenField: "",
  includeMetrics: [],
  ...overrides,
});

const renderForm = (
  props: Partial<
    React.ComponentProps<typeof PairwiseConfigForm> & {
      value: PairwiseEvaluatorConfig;
    }
  > = {},
) => {
  const value = props.value ?? baseConfig();
  return render(
    <FormWrapper hasGoldenAnswer={value.hasGoldenAnswer}>
      <PairwiseConfigForm
        value={value}
        onChange={vi.fn()}
        targets={[]}
        datasetColumns={[{ id: "col-1", name: "expected_output" }]}
        {...props}
      />
    </FormWrapper>,
  );
};

describe("PairwiseConfigForm", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when hasGoldenAnswer is true (default)", () => {
    it("shows the Golden field picker", () => {
      renderForm();

      expect(screen.getByTestId("pairwise-golden-field")).toBeInTheDocument();
    });
  });

  describe("when hasGoldenAnswer is false", () => {
    it("hides the Golden field picker", () => {
      renderForm({ value: baseConfig({ hasGoldenAnswer: false }) });

      expect(
        screen.queryByTestId("pairwise-golden-field"),
      ).not.toBeInTheDocument();
    });
  });

  describe("when the user toggles Has golden answer off", () => {
    it("hides the Golden field picker and reports hasGoldenAnswer=false, goldenField cleared", async () => {
      const onChange = vi.fn();
      const user = userEvent.setup();

      renderForm({
        value: baseConfig({ goldenField: "expected_output" }),
        onChange,
      });

      expect(screen.getByTestId("pairwise-golden-field")).toBeInTheDocument();

      await user.click(screen.getByTestId("pairwise-has-golden-answer"));

      expect(
        screen.queryByTestId("pairwise-golden-field"),
      ).not.toBeInTheDocument();
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ hasGoldenAnswer: false, goldenField: "" }),
      );
    });
  });

  describe("when the user toggles Has golden answer back on", () => {
    it("shows the Golden field picker again", async () => {
      const onChange = vi.fn();
      const user = userEvent.setup();

      renderForm({
        value: baseConfig({ hasGoldenAnswer: false }),
        onChange,
      });

      expect(
        screen.queryByTestId("pairwise-golden-field"),
      ).not.toBeInTheDocument();

      await user.click(screen.getByTestId("pairwise-has-golden-answer"));

      expect(screen.getByTestId("pairwise-golden-field")).toBeInTheDocument();
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ hasGoldenAnswer: true }),
      );
    });
  });
});
