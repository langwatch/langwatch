/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ComparisonEvaluatorConfig, TargetConfig } from "../../../types";
import {
  ComparisonConfigForm,
  pickDefaultJudgePrompt,
} from "../ComparisonConfigForm";

// The variant multiselect's menu items resolve display names via
// useTargetName, which reaches through useOrganizationTeamProject to
// tRPC — the full tRPC context is out of scope for a component
// integration test. Mock the hook to return the target's id so the
// dropdown still renders with a stable label.
const { useTargetNameMock, useTargetNamesMock } = vi.hoisted(() => {
  const useTargetNameMock = vi.fn((target: { id: string }) => target.id);
  const useTargetNamesMock = vi.fn(
    (targets: ({ id: string } | undefined)[]) =>
      targets.map((target) => (target ? useTargetNameMock(target) : "")),
  );
  return { useTargetNameMock, useTargetNamesMock };
});
// Resolves a variant's outputs through to its prompt via tRPC. These tests
// hand the form fully-formed targets, so the target's own outputs are the
// answer and no fetch is needed.
vi.mock("../../../hooks/useTargetOutputs", () => ({
  useTargetOutputs: (targets: ({ outputs?: unknown } | undefined)[]) =>
    targets.map((target) => target?.outputs),
}));
vi.mock("../../../hooks/useTargetName", () => ({
  useTargetName: useTargetNameMock,
  // Batched variant lookup used by the comparison scoreboard AND the config
  // picker; the picker disambiguates the returned set with disambiguateNames.
  useTargetNames: useTargetNamesMock,
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
    // Reset to the default id-as-name behavior so a disambiguation override
    // in one test cannot leak into the next.
    useTargetNameMock.mockImplementation((target) => target.id);
    useTargetNamesMock.mockImplementation((targets) =>
      targets.map((target) => (target ? useTargetNameMock(target) : "")),
    );
  });

  describe("given two selected variants that resolve to the same name", () => {
    it("numbers the picker cards (1) and (2) in variant order", () => {
      // A duplicated prompt: both variants resolve to one name. The picker
      // must disambiguate them the same way the verdict column does, keyed on
      // variant order, so "(2)" here is the same column as "(2)" in results.
      useTargetNamesMock.mockImplementation((targets) =>
        targets.map((target) => (target ? "Prompt A" : "")),
      );

      renderForm({
        value: baseConfig({ variants: ["t1", "t2"] }),
        targets: [target("t1"), target("t2")],
      });

      expect(screen.getByText("Prompt A (1)")).toBeInTheDocument();
      expect(screen.getByText("Prompt A (2)")).toBeInTheDocument();
      expect(screen.queryByText("Prompt A")).not.toBeInTheDocument();
    });

    it("leaves a uniquely-named variant unnumbered", () => {
      useTargetNamesMock.mockImplementation((targets) =>
        targets.map((target) =>
          target ? (target.id === "t1" ? "Prompt A" : "Prompt B") : "",
        ),
      );

      renderForm({
        value: baseConfig({ variants: ["t1", "t2"] }),
        targets: [target("t1"), target("t2")],
      });

      expect(screen.getByText("Prompt A")).toBeInTheDocument();
      expect(screen.getByText("Prompt B")).toBeInTheDocument();
    });
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

  describe("when the user picks a golden column from the field picker", () => {
    it("writes it into goldenField and turns golden answer on", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      renderForm({ value: baseConfig({ hasGoldenAnswer: false }), onChange });

      await user.click(screen.getByTestId("comparison-golden-field-input"));
      await user.click(screen.getByTestId("field-option-expected_output"));

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ goldenField: "expected_output" }),
      );
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ hasGoldenAnswer: true }),
      );
    });
  });

  describe("when the user clears the golden field picker", () => {
    it("clears goldenField and turns golden answer off", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      renderForm({
        value: baseConfig({
          hasGoldenAnswer: true,
          goldenField: "expected_output",
        }),
        onChange,
      });

      await user.click(
        within(screen.getByTestId("comparison-golden-field")).getByTestId(
          "clear-mapping-button",
        ),
      );

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ hasGoldenAnswer: false, goldenField: "" }),
      );
    });
  });

  // #5378: golden answer is opt-in. The separate "Has golden answer" toggle
  // was folded into the Golden field picker ("None — judge on merits" turns
  // it off). Golden and Input now render together as a two-column row, and the
  // golden picker is always visible.
  describe("when the golden and input fields render", () => {
    it("renders both pickers together, with no separate toggle", () => {
      renderForm({ value: baseConfig({ hasGoldenAnswer: true }) });

      expect(screen.getByTestId("comparison-golden-field")).toBeInTheDocument();
      expect(screen.getByTestId("comparison-input-field")).toBeInTheDocument();
      expect(
        screen.queryByTestId("comparison-has-golden-answer"),
      ).not.toBeInTheDocument();
    });

    it("labels the golden trigger None once golden answer is off", () => {
      renderForm({ value: baseConfig({ hasGoldenAnswer: false }) });

      expect(
        screen.getByTestId("comparison-golden-field-input"),
      ).toHaveAttribute("placeholder", "None — judge on merits");
    });
  });

  // The judge prompt tracks the golden setting while it is still an untouched
  // shipped default: switching golden on/off swaps it to the matching default.
  // hasInput is always true at config time, so both swaps land on the *_INPUT
  // defaults; the no-input variants are chosen per row at runtime in Python.
  describe("when golden changes and the prompt is an untouched default", () => {
    const PromptProbe = () => {
      const prompt = useWatch({ name: "settings.prompt" }) as
        | string
        | undefined;
      return <div data-testid="prompt-probe">{prompt}</div>;
    };

    const renderWithPrompt = ({
      hasGolden,
      value,
    }: {
      hasGolden: boolean;
      value: ComparisonEvaluatorConfig;
    }) => {
      const Wrapper = ({ children }: { children: ReactNode }) => {
        const methods = useForm({
          defaultValues: {
            settings: {
              has_golden_answer: hasGolden,
              prompt: pickDefaultJudgePrompt({ hasGolden, hasInput: true }),
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
      return render(
        <Wrapper>
          <PromptProbe />
          <ComparisonConfigForm
            value={value}
            onChange={vi.fn()}
            targets={[target("t1"), target("t2")]}
            datasetColumns={[{ id: "col-1", name: "expected_output" }]}
          />
        </Wrapper>,
      );
    };

    it("swaps to the no-golden default when None is picked", async () => {
      const user = userEvent.setup();
      renderWithPrompt({
        hasGolden: true,
        value: baseConfig({
          hasGoldenAnswer: true,
          goldenField: "expected_output",
          variants: ["t1", "t2"],
        }),
      });

      await user.click(
        within(screen.getByTestId("comparison-golden-field")).getByTestId(
          "clear-mapping-button",
        ),
      );

      await waitFor(() =>
        expect(screen.getByTestId("prompt-probe").textContent).toBe(
          pickDefaultJudgePrompt({ hasGolden: false, hasInput: true }),
        ),
      );
    });

    it("swaps to the golden default when a column is picked", async () => {
      const user = userEvent.setup();
      renderWithPrompt({
        hasGolden: false,
        value: baseConfig({ hasGoldenAnswer: false, variants: ["t1", "t2"] }),
      });

      await user.click(screen.getByTestId("comparison-golden-field-input"));
      await user.click(screen.getByTestId("field-option-expected_output"));

      await waitFor(() =>
        expect(screen.getByTestId("prompt-probe").textContent).toBe(
          pickDefaultJudgePrompt({ hasGolden: true, hasInput: true }),
        ),
      );
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

      // The picker is always visible now; once golden is corrected to off it
      // reads "None — judge on merits" rather than a stale column.
      await waitFor(() =>
        expect(
          screen.getByTestId("comparison-golden-field-input"),
        ).toHaveAttribute("placeholder", "None — judge on merits"),
      );
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
          screen.getByTestId("comparison-variant-output-t1-input"),
        ).toHaveAttribute("placeholder", "Whole output");
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

          await user.click(
            screen.getByTestId("comparison-variant-output-t1-input"),
          );
          await user.click(screen.getByTestId("field-option-answer"));

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

          await user.click(
            screen.getByTestId("comparison-variant-output-t1-input"),
          );
          await user.click(screen.getByTestId("field-option-answer"));

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

          await user.click(
            within(
              screen.getByTestId("comparison-variant-output-t1"),
            ).getByTestId("clear-mapping-button"),
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

        await user.click(
          screen.getByTestId("comparison-variant-output-t1-input"),
        );
        await user.click(screen.getByTestId("field-option-output.document_type"));

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

      await user.click(screen.getByTestId("comparison-input-field-input"));
      await user.click(screen.getByTestId("field-option-question"));

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
        name: "golden field",
        testId: "comparison-golden-field-info",
        opensWith:
          /the reference answer the judge compares each candidate against/i,
      },
      {
        name: "input field",
        testId: "comparison-input-field-info",
        opensWith: /gives the judge task context/i,
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

  // A bare "expected_output" / "answer" doesn't say WHICH dataset or variant it
  // came from. Qualify both with their source — the same "Test Data.input" shape
  // the prompt variable mapping chips use — so every field label reads the same
  // way across the form. Display only: the stored goldenField / output path stay
  // the bare names the backend reads.
  describe("given a dataset name is known", () => {
    it("qualifies the golden column options as Dataset.column", async () => {
      const user = userEvent.setup();
      renderForm({
        datasetName: "Test Data",
        datasetColumns: [
          { id: "col-1", name: "expected_output" },
          { id: "col-2", name: "input" },
        ],
      });

      await user.click(screen.getByTestId("comparison-golden-field-input"));

      // The source header names the dataset; each field option below it
      // shows the bare column name — selecting one is what produces the
      // qualified "Dataset.column" chip (covered by the next test).
      await waitFor(() => expect(screen.getByText("Test Data")).toBeVisible());
      expect(screen.getByTestId("field-option-expected_output")).toBeVisible();
    });

    it("qualifies the chosen golden column on the trigger too", () => {
      renderForm({
        datasetName: "Test Data",
        value: baseConfig({
          hasGoldenAnswer: true,
          goldenField: "expected_output",
        }),
      });

      expect(
        within(screen.getByTestId("comparison-golden-field")).getByText(
          "Test Data.expected_output",
        ),
      ).toBeVisible();
    });

    it("qualifies the input column options as Dataset.column", async () => {
      const user = userEvent.setup();
      renderForm({
        datasetName: "Test Data",
        datasetColumns: [{ id: "col-2", name: "input" }],
      });

      await user.click(screen.getByTestId("comparison-input-field-input"));

      await waitFor(() => expect(screen.getByText("Test Data")).toBeVisible());
      expect(screen.getByTestId("field-option-input")).toBeVisible();
    });

    it("qualifies the chosen input column on the trigger too", () => {
      renderForm({
        datasetName: "Test Data",
        value: baseConfig({ inputField: "input" }),
      });

      expect(
        within(screen.getByTestId("comparison-input-field")).getByText(
          "Test Data.input",
        ),
      ).toBeVisible();
    });

    // The dataset name is absent until the store hydrates; the picker still
    // shows every available column, unqualified, rather than hiding them.
    it("falls back to an unqualified source name when the dataset name is unknown", async () => {
      const user = userEvent.setup();
      renderForm({ datasetColumns: [{ id: "col-1", name: "expected_output" }] });

      await user.click(screen.getByTestId("comparison-golden-field-input"));

      await waitFor(() =>
        expect(
          screen.getByTestId("field-option-expected_output"),
        ).toBeVisible(),
      );
    });
  });

  describe("given a variant with a json_schema output", () => {
    it("qualifies the source header with the variant name, options with the field path", async () => {
      const user = userEvent.setup();
      useTargetNameMock.mockImplementation((t: { id: string }) =>
        t.id === "t1" ? "support-detailed" : "support-concise",
      );
      renderForm({
        targets: [jsonSchemaTarget("t1"), target("t2")],
        value: baseConfig({ variants: ["t1", "t2"] }),
      });

      await user.click(
        screen.getByTestId("comparison-variant-output-t1-input"),
      );

      // The dropdown's source header names the variant once (alongside the
      // card's own title, hence getAllByText); each field option below it
      // shows the bare "output.field" path — selecting one is what produces
      // the qualified "support-detailed.output.field" chip.
      await waitFor(() =>
        expect(screen.getAllByText("support-detailed")).toHaveLength(2),
      );
      expect(
        screen.getByTestId("field-option-output.document_type"),
      ).toBeVisible();
      expect(
        screen.getByTestId("field-option-output.confidence"),
      ).toBeVisible();
      expect(
        screen.getByTestId("field-option-output.reasoning"),
      ).toBeVisible();
    });

    // The label names the full path ("…output.answer") but the PATH stored for
    // a single "output" field must stay unwrapped (["answer"]): the backend
    // unwraps that field before walking the object, so a ["output","answer"]
    // path would hand the judge an empty candidate. This pins the divergence so
    // a later "cleanup" can't quietly align them and break the judge.
    it("stores the unwrapped path even though the label shows the full one", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      useTargetNameMock.mockImplementation((t: { id: string }) =>
        t.id === "t1" ? "support-detailed" : "support-concise",
      );
      renderForm({
        targets: [jsonSchemaTarget("t1"), target("t2")],
        value: baseConfig({ variants: ["t1", "t2"] }),
        onChange,
      });

      await user.click(
        screen.getByTestId("comparison-variant-output-t1-input"),
      );
      await user.click(screen.getByTestId("field-option-output.document_type"));

      // What gets stored is the unwrapped path the backend expects, not the
      // "output.document_type" the option was labelled with.
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          variantOutputPaths: { t1: ["document_type"] },
        }),
      );

      // …and the chip now reads the qualified label built from that same
      // stored selection.
      expect(
        within(screen.getByTestId("comparison-variant-output-t1")).getByText(
          "support-detailed.output.document_type",
        ),
      ).toBeVisible();
    });

    // CodeRabbit (PR #5789): an explicitly-chosen "Whole output" stores path [],
    // which matches no option. The placeholder must still read the unqualified
    // "Whole output" — "Whole output" is a mode, not a field, so unlike a real
    // selection it never carries the variant name prefix.
    it("labels an explicitly empty path as Whole output, not blank or qualified", () => {
      useTargetNameMock.mockImplementation(() => "support-detailed");
      renderForm({
        targets: [jsonSchemaTarget("t1"), target("t2")],
        value: baseConfig({
          variants: ["t1", "t2"],
          variantOutputPaths: { t1: [] },
        }),
      });

      expect(
        screen.getByTestId("comparison-variant-output-t1-input"),
      ).toHaveAttribute("placeholder", "Whole output");
    });
  });
});
