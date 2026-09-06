// @vitest-environment jsdom
/**
 * A target's variables panel: what each input reads from, and what is still
 * unmapped.
 *
 * @see specs/experiments-v3/mapping-validation.feature
 * @see specs/experiments-v3/mapping-source-types.feature
 * @see specs/experiments-v3/mapping-source-display.feature
 */
import "@testing-library/jest-dom/vitest";

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

// The resolver answers a friendly name for the chained prompt target and falls
// back to the raw id when no entity name is known.
vi.mock("../../../../../behavior/experiments-v3/use-resolve-target-name.ts", () => ({
  useResolveTargetName: () => (target: { id: string; promptId?: string }) =>
    target.promptId === "prompt-cat" ? "category_classifier" : target.id,
}));

import type { DatasetReference, TargetConfig } from "../../../../../model/experiments-v3/types.ts";
import { TargetVariablesPanel } from "../target-variables-panel.tsx";

const ACTIVE_DATASET_ID = "dataset-1";

const datasets: DatasetReference[] = [
  {
    id: ACTIVE_DATASET_ID,
    name: "Test Dataset",
    type: "inline",
    columns: [
      { id: "col-1", name: "input_text", type: "string" },
      { id: "col-2", name: "expected_output", type: "string" },
    ],
  },
];

const target: TargetConfig = {
  id: "target-1",
  type: "prompt",
  inputs: [
    { identifier: "question", type: "str" },
    { identifier: "context", type: "str" },
  ],
  outputs: [{ identifier: "answer", type: "str" }],
  mappings: {
    [ACTIVE_DATASET_ID]: {
      question: {
        type: "source",
        source: "dataset",
        sourceId: ACTIVE_DATASET_ID,
        sourceField: "input_text",
      },
    },
  },
  localPromptConfig: {
    llm: { model: "gpt-4" },
    messages: [{ role: "user", content: "Answer this: {{question}} with context: {{context}}" }],
    inputs: [
      { identifier: "question", type: "str" },
      { identifier: "context", type: "str" },
    ],
    outputs: [{ identifier: "answer", type: "str" }],
  },
} as TargetConfig;

const otherTarget: TargetConfig = {
  id: "target-2",
  type: "prompt",
  inputs: [{ identifier: "query", type: "str" }],
  outputs: [{ identifier: "search_results", type: "str" }],
  mappings: {},
} as TargetConfig;

function renderPanel(props: Partial<Parameters<typeof TargetVariablesPanel>[0]> = {}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <TargetVariablesPanel
        target={target}
        activeDatasetId={ACTIVE_DATASET_ID}
        datasets={datasets}
        otherTargets={[]}
        onInputsChange={vi.fn()}
        onMappingChange={vi.fn()}
        {...props}
      />
    </ChakraProvider>,
  );
}

/** The mapping field of the input that has no source yet. */
async function openTheUnmappedDropdown() {
  const user = userEvent.setup();
  const empty = screen.getAllByRole("textbox").find((input) => !(input as HTMLInputElement).value);
  expect(empty).toBeDefined();
  await user.click(empty!);
}

afterEach(() => {
  cleanup();
});

describe("the target variables panel", () => {
  describe("given an input the prompt uses but nothing maps", () => {
    describe("when the panel opens", () => {
      /** @scenario "Opening drawer shows missing mapping warning" */
      it("names the unmapped field in a warning", () => {
        renderPanel();

        const warning = screen.getByTestId("missing-mappings-error");
        expect(warning).toBeInTheDocument();
        expect(warning.textContent).toContain("context");
      });
    });

    describe("when the panel is read only", () => {
      it("states no warning, since the reader cannot act on it", () => {
        renderPanel({ readOnly: true });

        expect(screen.queryByTestId("missing-mappings-error")).not.toBeInTheDocument();
      });
    });
  });

  describe("given every used input is mapped", () => {
    describe("when the panel opens", () => {
      it("shows no warning", () => {
        renderPanel({
          target: {
            ...target,
            mappings: {
              [ACTIVE_DATASET_ID]: {
                ...target.mappings[ACTIVE_DATASET_ID],
                context: {
                  type: "source",
                  source: "dataset",
                  sourceId: ACTIVE_DATASET_ID,
                  sourceField: "expected_output",
                },
              },
            },
          } as TargetConfig,
        });

        expect(screen.queryByTestId("missing-mappings-error")).not.toBeInTheDocument();
      });
    });
  });

  describe("given the active dataset has an image column", () => {
    describe("when the mapping dropdown opens", () => {
      /** @scenario An image dataset column is badged as Image in the mapping dropdown */
      it("badges that column as Image rather than falling back to Text", async () => {
        renderPanel({
          datasets: [
            {
              ...datasets[0]!,
              columns: [...datasets[0]!.columns, { id: "col-3", name: "image", type: "image" }],
            },
          ],
        });

        await openTheUnmappedDropdown();

        const imageOption = await screen.findByTestId("field-option-image");
        expect(within(imageOption).getByText("Image")).toBeInTheDocument();
        expect(within(imageOption).queryByText("Text")).not.toBeInTheDocument();
      });
    });
  });

  describe("given another target this one can chain from", () => {
    describe("when the mapping dropdown opens", () => {
      /** @scenario Chaining one target into another shows the upstream target name */
      it("labels the upstream target with its resolved name, not its internal id", async () => {
        renderPanel({
          otherTargets: [
            { ...otherTarget, id: "target_1778838627724", promptId: "prompt-cat" } as TargetConfig,
          ],
        });

        await openTheUnmappedDropdown();

        await waitFor(() => {
          expect(screen.getByText("category_classifier")).toBeInTheDocument();
        });
        expect(screen.queryByText("target_1778838627724")).not.toBeInTheDocument();
      });

      it("falls back to the target id when no name is known for it", async () => {
        renderPanel({ otherTargets: [otherTarget] });

        await openTheUnmappedDropdown();

        await waitFor(() => {
          expect(screen.getByText("target-2")).toBeInTheDocument();
          expect(screen.getByText("search_results")).toBeInTheDocument();
        });
      });
    });
  });
});
