/**
 * Visual preview of the pairwise compare UI (#5100). Renders each new
 * component with realistic mock data in real Chromium and captures
 * screenshots that are attached to the PR. No backend, no DB — pure
 * component rendering.
 *
 * Screenshots land under `/tmp/pr5106/` so the assistant can upload them.
 */

import { ChakraProvider, HStack } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { system as langwatchSystem } from "~/pages/_app";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, it, vi } from "vitest";
import { page } from "vitest/browser";

vi.mock("../../hooks/useEvaluatorName", () => ({
  useEvaluatorName: () => "Pairwise Compare",
  useEvaluatorNames: () => new Map(),
  useCodeEvaluatorIds: () => new Set(),
}));

import type { EvaluatorConfig } from "../../types";
import { PairwiseConfigForm } from "../EvaluatorPanel/PairwiseConfigForm";
import { RowVerdictStrip } from "../RowVerdictStrip";
import { EvaluatorChip } from "../TargetSection/EvaluatorChip";

afterEach(() => cleanup());

const targets = [
  {
    id: "variant_a",
    type: "prompt" as const,
    promptId: "p_a",
    outputs: [],
    mappings: {},
  },
  {
    id: "variant_b",
    type: "prompt" as const,
    promptId: "p_b",
    outputs: [],
    mappings: {},
  },
] as any;

const datasetColumns = [
  { id: "c1", name: "input" },
  { id: "c2", name: "expected_output" },
  { id: "c3", name: "context" },
];

describe("Pairwise compare UI preview (PR #5106)", () => {
  it("PairwiseConfigForm — initial state with metrics checked", async () => {
    await page.viewport(520, 600);
    render(
      <ChakraProvider value={langwatchSystem}>
        <div style={{ width: 480, padding: 16, background: "white" }}>
          <PairwiseConfigForm
            value={{
              variantA: "variant_a",
              variantB: "variant_b",
              goldenField: "expected_output",
              includeMetrics: ["cost", "duration"],
            }}
            onChange={() => {}}
            targets={targets}
            datasetColumns={datasetColumns}
          />
        </div>
      </ChakraProvider>,
    );

    await screen.findByText(/Variant A/);
    await page.screenshot({
      path: "/tmp/pr5106/01-pairwise-config-form.png",
    });
  });

  it("RowVerdictStrip — A wins", async () => {
    await page.viewport(800, 40);
    render(
      <ChakraProvider value={langwatchSystem}>
        <div style={{ width: 780, background: "white" }}>
          <RowVerdictStrip
            label="A"
            variantAName="variant_a"
            variantBName="variant_b"
            reasoning="Variant A's answer is more accurate and matches the golden reference word-for-word."
          />
        </div>
      </ChakraProvider>,
    );

    await screen.findByText("variant_a");
    await page.screenshot({
      path: "/tmp/pr5106/04-row-verdict-a-wins.png",
    });
  });

  it("RowVerdictStrip — tie", async () => {
    await page.viewport(800, 40);
    render(
      <ChakraProvider value={langwatchSystem}>
        <div style={{ width: 780, background: "white" }}>
          <RowVerdictStrip
            label="tie"
            variantAName="variant_a"
            variantBName="variant_b"
            reasoning="Both candidates produce semantically identical answers."
          />
        </div>
      </ChakraProvider>,
    );

    await screen.findByText("Tie");
    await page.screenshot({
      path: "/tmp/pr5106/05-row-verdict-tie.png",
    });
  });

  it("RowVerdictStrip — B wins", async () => {
    await page.viewport(800, 40);
    render(
      <ChakraProvider value={langwatchSystem}>
        <div style={{ width: 780, background: "white" }}>
          <RowVerdictStrip
            label="B"
            variantAName="variant_a"
            variantBName="variant_b"
            reasoning="Variant B's answer is more concise while still matching the golden answer's semantics."
          />
        </div>
      </ChakraProvider>,
    );

    await screen.findByText("variant_b");
    await page.screenshot({
      path: "/tmp/pr5106/06-row-verdict-b-wins.png",
    });
  });

  it("EvaluatorChip — winner / loser / tie tints", async () => {
    await page.viewport(600, 80);
    const evaluator: EvaluatorConfig = {
      id: "eval-1",
      evaluatorType:
        "langevals/pairwise_compare" as EvaluatorConfig["evaluatorType"],
      dbEvaluatorId: "db-eval-1",
      mappings: {},
      inputs: [],
      pairwise: {
        variantA: "variant_a",
        variantB: "variant_b",
        goldenField: "expected_output",
        includeMetrics: [],
      },
    };
    const winnerResult = { status: "processed", score: 0, label: "A" };

    render(
      <ChakraProvider value={langwatchSystem}>
        <div style={{ padding: 16, background: "white" }}>
          <HStack gap={4}>
            <EvaluatorChip
              evaluator={evaluator}
              result={winnerResult}
              pairwiseState="winner"
              onEdit={() => {}}
              onRemove={() => {}}
            />
            <EvaluatorChip
              evaluator={evaluator}
              result={winnerResult}
              pairwiseState="loser"
              onEdit={() => {}}
              onRemove={() => {}}
            />
            <EvaluatorChip
              evaluator={evaluator}
              result={{ status: "processed", score: 0.5, label: "tie" }}
              pairwiseState="tie"
              onEdit={() => {}}
              onRemove={() => {}}
            />
          </HStack>
        </div>
      </ChakraProvider>,
    );

    await page.screenshot({
      path: "/tmp/pr5106/07-evaluator-chip-tints.png",
    });
  });
});
