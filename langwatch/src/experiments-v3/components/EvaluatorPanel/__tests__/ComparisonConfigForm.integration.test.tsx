/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
vi.mock("../../../hooks/useTargetName", () => {
  const useTargetName = (target: { id: string }) => target.id;
  return {
    useTargetName,
    // Batched variant lookup used by the comparison scoreboard.
    useTargetNames: (targets: ({ id: string } | undefined)[]) =>
      targets.map((target) => (target ? useTargetName(target) : "")),
  };
});

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

/** A plain prompt: one output field, so there is no field to choose. */
const target = (id: string): TargetConfig => ({
  id,
  type: "prompt",
  promptId: `prompt_${id}`,
  inputs: [],
  outputs: [{ identifier: "output", type: "str" }],
  mappings: {},
});

/** A prompt with a structured output schema — several fields to choose from. */
const structuredTarget = (id: string): TargetConfig => ({
  ...target(id),
  outputs: [
    { identifier: "answer", type: "str" },
    { identifier: "confidence", type: "float" },
  ],
});

const jsonSchemaTarget = (id: string): TargetConfig => ({
  ...target(id),
  outputs: [
    {
      identifier: "output",
      type: "json_schema",
      json_schema: {
        type: "object",
        properties: {
          document_type: { type: "string" },
          confidence: { type: "number" },
          reasoning: { type: "string" },
        },
      },
    },
  ],
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

  // The too-few-variants case is enforced by disabling Save and Apply in the
  // drawer footer (EvaluatorEditorShared's isValid), not by an inline warning
  // the user can scroll past. The label carries the requirement.
  describe("given fewer than 2 variants selected", () => {
    it.each([
      [[] as string[]],
      [["t1"]],
    ])("states the requirement in the label rather than warning inline (%j)", (variants) => {
      renderForm({ value: baseConfig({ variants }) });

      expect(screen.getByText(/pick 2 or more/i)).toBeInTheDocument();
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

      await user.click(screen.getByTestId("comparison-variant-chip-t1-remove"));

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

  // #5378: golden answer is opt-in. The Golden field picker is gated behind
  // the "Has golden answer" toggle (comparison.feature:175, :180). The deleted
  // PairwiseConfigForm test covered this; it must not go uncovered in the
  // merged form.
  describe("the has-golden-answer toggle", () => {
    it("shows the golden field picker when on (the default)", () => {
      renderForm({ value: baseConfig({ hasGoldenAnswer: true }) });

      expect(screen.getByTestId("comparison-golden-field")).toBeInTheDocument();
    });

    it("hides the golden field picker when the user turns it off", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      renderForm({
        value: baseConfig({ hasGoldenAnswer: true }),
        onChange,
      });

      // Picker visible before the toggle.
      expect(screen.getByTestId("comparison-golden-field")).toBeInTheDocument();

      await user.click(screen.getByTestId("comparison-has-golden-answer"));

      // Turning it off both clears goldenField and hides the picker.
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ hasGoldenAnswer: false, goldenField: "" }),
      );
      await waitFor(() => {
        expect(
          screen.queryByTestId("comparison-golden-field"),
        ).not.toBeInTheDocument();
      });
    });
  });

  // #5528: selecting an EXISTING saved comparison evaluator as a new column
  // target seeds `comparison.hasGoldenAnswer: true` regardless of what the
  // evaluator was actually saved with (EvaluationsV3Table's
  // handleSelectEvaluatorAsTarget). The toggle above reads the form's
  // settings.has_golden_answer — which IS loaded correctly from the saved
  // evaluator — so it renders correctly and gives false confidence, while
  // the store's comparison.hasGoldenAnswer silently keeps the wrong seeded
  // value until the user clicks the toggle themselves. That stale value is
  // what actually gets saved and read at execution time.
  describe("given the initial draft disagrees with the evaluator's saved setting", () => {
    it("reconciles hasGoldenAnswer from the form on mount, without any click", async () => {
      const onChange = vi.fn();
      const MismatchedFormWrapper = ({ children }: { children: ReactNode }) => {
        const methods = useForm({
          defaultValues: {
            settings: {
              has_golden_answer: false,
              include_metrics: [] as string[],
            },
          },
        });
        return (
          <ChakraProvider value={defaultSystem}>
            <FormProvider {...methods}>{children}</FormProvider>
          </ChakraProvider>
        );
      };

      render(
        <MismatchedFormWrapper>
          <ComparisonConfigForm
            value={baseConfig({
              hasGoldenAnswer: true,
              variants: ["t1", "t2"],
            })}
            onChange={onChange}
            targets={[target("t1"), target("t2")]}
            datasetColumns={[{ id: "col-1", name: "expected_output" }]}
          />
        </MismatchedFormWrapper>,
      );

      // No user interaction whatsoever — mount alone must correct the
      // mismatch so the persisted comparison config matches what the form
      // (and the saved evaluator) actually say.
      await waitFor(() => {
        expect(onChange).toHaveBeenCalledWith(
          expect.objectContaining({ hasGoldenAnswer: false, goldenField: "" }),
        );
      });

      // The corrected state also keeps the golden field picker hidden,
      // matching what the toggle already displayed.
      expect(
        screen.queryByTestId("comparison-golden-field"),
      ).not.toBeInTheDocument();
    });

    it("leaves goldenField untouched when the form says golden answer is on", async () => {
      const onChange = vi.fn();
      const AgreeingFormWrapper = ({ children }: { children: ReactNode }) => {
        const methods = useForm({
          defaultValues: {
            settings: {
              has_golden_answer: true,
              include_metrics: [] as string[],
            },
          },
        });
        return (
          <ChakraProvider value={defaultSystem}>
            <FormProvider {...methods}>{children}</FormProvider>
          </ChakraProvider>
        );
      };

      render(
        <AgreeingFormWrapper>
          <ComparisonConfigForm
            value={baseConfig({
              hasGoldenAnswer: true,
              goldenField: "expected_output",
              variants: ["t1", "t2"],
            })}
            onChange={onChange}
            targets={[target("t1"), target("t2")]}
            datasetColumns={[{ id: "col-1", name: "expected_output" }]}
          />
        </AgreeingFormWrapper>,
      );

      // hasGoldenAnswer already agrees (true === true), so reconciliation
      // must not fire and must not clobber the already-chosen golden field.
      expect(onChange).not.toHaveBeenCalled();
      expect(screen.getByTestId("comparison-golden-field")).toHaveTextContent(
        "expected_output",
      );
    });
  });

  // Restored from PairwiseConfigForm, which had a per-variant output picker
  // before the forms merged. Without it a variant emitting a structured
  // output cannot be narrowed to a field. Which field is a per-variant call:
  // two variants may name the same answer differently.
  describe("the per-variant output picker", () => {
    describe("given a variant with a single output field", () => {
      it("hides the picker, because there is nothing to choose", () => {
        renderForm({ value: baseConfig({ variants: ["t1", "t2"] }) });

        expect(
          screen.queryByTestId("comparison-variant-output-t1"),
        ).not.toBeInTheDocument();
      });
    });

    describe("given a variant with a structured output", () => {
      const structured = {
        targets: [structuredTarget("t1"), target("t2")],
      };

      it("shows the picker for that variant only", () => {
        renderForm({
          ...structured,
          value: baseConfig({ variants: ["t1", "t2"] }),
        });

        expect(
          screen.getByTestId("comparison-variant-output-t1"),
        ).toBeInTheDocument();
        expect(
          screen.queryByTestId("comparison-variant-output-t2"),
        ).not.toBeInTheDocument();
      });

      it("compares the whole output until a field is picked", () => {
        renderForm({
          ...structured,
          value: baseConfig({ variants: ["t1", "t2"] }),
        });

        expect(
          screen.getByTestId("comparison-variant-output-t1"),
        ).toHaveTextContent("Whole output");
      });

      describe("when the user picks a field", () => {
        it("stores it as that variant's output path", async () => {
          const user = userEvent.setup();
          const onChange = vi.fn();
          renderForm({
            ...structured,
            value: baseConfig({ variants: ["t1", "t2"] }),
            onChange,
          });

          await user.click(screen.getByTestId("comparison-variant-output-t1"));
          await user.click(
            screen.getByTestId("comparison-variant-output-t1-option-answer"),
          );

          expect(onChange).toHaveBeenCalledWith(
            expect.objectContaining({ variantOutputPaths: { t1: ["answer"] } }),
          );
        });

        it("leaves the other variants' fields alone", async () => {
          const user = userEvent.setup();
          const onChange = vi.fn();
          renderForm({
            targets: [structuredTarget("t1"), structuredTarget("t2")],
            value: baseConfig({
              variants: ["t1", "t2"],
              variantOutputPaths: { t2: ["confidence"] },
            }),
            onChange,
          });

          await user.click(screen.getByTestId("comparison-variant-output-t1"));
          await user.click(
            screen.getByTestId("comparison-variant-output-t1-option-answer"),
          );

          expect(onChange).toHaveBeenCalledWith(
            expect.objectContaining({
              variantOutputPaths: { t1: ["answer"], t2: ["confidence"] },
            }),
          );
        });
      });

      describe("when the user picks Whole output back", () => {
        it("drops the saved path rather than storing an empty one", async () => {
          const user = userEvent.setup();
          const onChange = vi.fn();
          renderForm({
            ...structured,
            value: baseConfig({
              variants: ["t1", "t2"],
              variantOutputPaths: { t1: ["answer"] },
            }),
            onChange,
          });

          await user.click(screen.getByTestId("comparison-variant-output-t1"));
          await user.click(
            screen.getByTestId("comparison-variant-output-t1-option-whole"),
          );

          expect(onChange).toHaveBeenCalledWith(
            expect.objectContaining({ variantOutputPaths: undefined }),
          );
        });
      });
    });

    describe("given a variant with one JSON-schema output", () => {
      it("lets the user pick a structured field inside that output", async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderForm({
          targets: [jsonSchemaTarget("t1"), target("t2")],
          value: baseConfig({ variants: ["t1", "t2"] }),
          onChange,
        });

        await user.click(screen.getByTestId("comparison-variant-output-t1"));
        await user.click(
          screen.getByTestId(
            "comparison-variant-output-t1-option-document_type",
          ),
        );

        expect(onChange).toHaveBeenCalledWith(
          expect.objectContaining({
            variantOutputPaths: { t1: ["document_type"] },
          }),
        );
      });
    });

    describe("when a variant is removed", () => {
      it("drops its saved output path along with it", async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderForm({
          value: baseConfig({
            variants: ["t1", "t2"],
            variantOutputPaths: { t1: ["answer"], t2: ["answer"] },
          }),
          onChange,
        });

        await user.click(
          screen.getByTestId("comparison-variant-chip-t1-remove"),
        );

        expect(onChange).toHaveBeenCalledWith(
          expect.objectContaining({
            variants: ["t2"],
            variantOutputPaths: { t2: ["answer"] },
          }),
        );
      });
    });
  });

  describe("the input context picker", () => {
    it("stores an explicit dataset input field for the judge prompt", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      renderForm({
        value: baseConfig({ variants: ["t1", "t2"] }),
        datasetColumns: [
          { id: "col-1", name: "question" },
          { id: "col-2", name: "expected_output" },
        ],
        onChange,
      });

      await user.click(screen.getByTestId("comparison-input-field"));
      await user.click(
        screen.getByTestId("comparison-input-field-option-question"),
      );

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ inputField: "question" }),
      );
    });
  });

  // A Wrap reflowed ragged; twelve variants used to land as 4/4/3/1.
  describe("the variants grid", () => {
    describe.each([
      { variants: 2, columns: 2 },
      { variants: 5, columns: 3 },
      { variants: 7, columns: 4 },
      { variants: 12, columns: 4 },
    ])("given $variants variants", ({ variants, columns }) => {
      it(`lays them out ${columns} to a row`, () => {
        const ids = Array.from({ length: variants }, (_, i) => `t${i}`);
        renderForm({
          value: baseConfig({ variants: ids }),
          targets: ids.map(target),
        });

        expect(screen.getByTestId("comparison-variants-grid")).toHaveAttribute(
          "data-columns",
          String(columns),
        );
      });
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

  // Pins the copy to the code, per dev/docs/best_practices/copywriting.md:
  // each setting's label stays short and the paragraph explaining it lives
  // behind an (i). A regression that inlines the paragraph back next to the
  // label, or drops the (i) entirely, fails here.
  describe("the settings explanations", () => {
    const infoTooltips = [
      {
        name: "variants",
        testId: "comparison-variants-info",
        opensWith: /those scores are passed to the judge/i,
      },
      {
        name: "has golden answer",
        testId: "comparison-has-golden-answer-info",
        opensWith: /compare each candidate against a reference answer/i,
      },
      {
        name: "shuffle candidate order",
        testId: "comparison-randomize-order-info",
        opensWith: /favour whichever candidate they read first/i,
      },
      {
        name: "include metrics",
        testId: "comparison-include-metrics-info",
        opensWith: /prefer the cheaper or faster variant/i,
      },
    ];

    // The popover keeps its body mounted-but-hidden while closed, so these
    // assert on VISIBILITY. Asserting on presence in the document would pass
    // whether or not the (i) ever opens, which is no assertion at all.
    describe("when the form is at rest", () => {
      it("keeps every explanation hidden behind its (i), not inline", () => {
        renderForm({ value: baseConfig({ hasGoldenAnswer: true }) });

        for (const { testId, opensWith } of infoTooltips) {
          expect(screen.getByTestId(testId)).toBeInTheDocument();
          expect(screen.getByText(opensWith)).not.toBeVisible();
        }
      });
    });

    describe.each(infoTooltips)("when the $name (i) is hovered", ({
      testId,
      opensWith,
    }) => {
      it("reveals the explanation", async () => {
        const user = userEvent.setup();
        renderForm({ value: baseConfig({ hasGoldenAnswer: true }) });

        await user.hover(screen.getByTestId(testId));

        await waitFor(() => expect(screen.getByText(opensWith)).toBeVisible());
      });

      // Touch and keyboard users never hover.
      it("reveals the explanation on click too", async () => {
        const user = userEvent.setup();
        renderForm({ value: baseConfig({ hasGoldenAnswer: true }) });

        await user.click(screen.getByTestId(testId));

        await waitFor(() => expect(screen.getByText(opensWith)).toBeVisible());
      });
    });
  });
});
