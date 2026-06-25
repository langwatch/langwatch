/**
 * Visual preview of the pairwise + N-way compare UI (#5100, #5101).
 * Renders each new component with realistic mock data in real Chromium
 * and captures screenshots that can be attached to the PR. No backend,
 * no DB — pure component rendering.
 *
 * Screenshots:
 *   - /tmp/pr5106/  — original pairwise-MVP UI (kept stable for #5100)
 *   - /tmp/pr5107/  — N-way (#5101) extensions
 */

import { ChakraProvider, HStack } from "@chakra-ui/react";
import { system as langwatchSystem } from "~/pages/_app";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, it, vi } from "vitest";
import { page } from "vitest/browser";

vi.mock("../../hooks/useEvaluatorName", () => ({
  useEvaluatorName: () => "Pairwise Compare",
  useEvaluatorNames: () => new Map(),
  useCodeEvaluatorIds: () => new Set(),
}));

import { AggregateHeaderBar } from "../AggregateHeaderBar";
import { PairwiseConfigForm } from "../EvaluatorPanel/PairwiseConfigForm";
import { RowVerdictStrip } from "../RowVerdictStrip";
import { EvaluatorChip } from "../TargetSection/EvaluatorChip";
import type { EvaluatorConfig } from "../../types";

afterEach(() => cleanup());

const twoTargets = [
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

const fourTargets = [
  ...twoTargets,
  {
    id: "variant_c",
    type: "prompt" as const,
    promptId: "p_c",
    outputs: [],
    mappings: {},
  },
  {
    id: "variant_d",
    type: "prompt" as const,
    promptId: "p_d",
    outputs: [],
    mappings: {},
  },
] as any;

const datasetColumns = [
  { id: "c1", name: "input" },
  { id: "c2", name: "expected_output" },
  { id: "c3", name: "context" },
];

describe("Pairwise compare UI preview — MVP (PR #5106)", () => {
  it("PairwiseConfigForm — initial state with metrics checked", async () => {
    await page.viewport(520, 600);
    render(
      <ChakraProvider value={langwatchSystem}>
        <div style={{ width: 480, padding: 16, background: "white" }}>
          <PairwiseConfigForm
            value={{
              mode: "pairwise",
              variants: ["variant_a", "variant_b"],
              goldenField: "expected_output",
              includeMetrics: ["cost", "duration"],
              positionBiasMitigation: null,
            }}
            onChange={() => {}}
            targets={twoTargets}
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

  it("AggregateHeaderBar — tally + filter chips + handoffs", async () => {
    await page.viewport(1600, 70);
    render(
      <ChakraProvider value={langwatchSystem}>
        <div style={{ width: 1580, background: "white" }}>
          <AggregateHeaderBar
            variants={[
              { id: "variant_a", name: "variant_a", wins: 12 },
              { id: "variant_b", name: "variant_b", wins: 7 },
            ]}
            ties={2}
            totalCost={0.0421}
            activeFilter="all"
            onFilterChange={() => {}}
            onExport={() => {}}
            onPromote={() => {}}
            biasCorrected={true}
          />
        </div>
      </ChakraProvider>,
    );

    await screen.findByText(/variant_a wins 12/);
    await page.screenshot({
      path: "/tmp/pr5106/02-aggregate-header-bar.png",
    });
  });

  it("AggregateHeaderBar — losses filter active", async () => {
    await page.viewport(1600, 70);
    render(
      <ChakraProvider value={langwatchSystem}>
        <div style={{ width: 1580, background: "white" }}>
          <AggregateHeaderBar
            variants={[
              { id: "variant_a", name: "variant_a", wins: 12 },
              { id: "variant_b", name: "variant_b", wins: 7 },
            ]}
            ties={2}
            totalCost={0.0421}
            activeFilter="losses"
            onFilterChange={() => {}}
            onExport={() => {}}
            onPromote={() => {}}
            biasCorrected={true}
          />
        </div>
      </ChakraProvider>,
    );

    await screen.findByText(/Losses/);
    await page.screenshot({
      path: "/tmp/pr5106/03-aggregate-header-losses.png",
    });
  });

  it("RowVerdictStrip — A wins", async () => {
    await page.viewport(800, 40);
    render(
      <ChakraProvider value={langwatchSystem}>
        <div style={{ width: 780, background: "white" }}>
          <RowVerdictStrip
            winnerName="variant_a"
            isTie={false}
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
            winnerName="Tie"
            isTie={true}
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
            winnerName="variant_b"
            isTie={false}
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
      evaluatorType: "langevals/pairwise_compare" as EvaluatorConfig["evaluatorType"],
      dbEvaluatorId: "db-eval-1",
      mappings: {},
      inputs: [],
      pairwise: {
        mode: "pairwise",
        variants: ["variant_a", "variant_b"],
        goldenField: "expected_output",
        includeMetrics: [],
        positionBiasMitigation: null,
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

describe("Pairwise compare UI preview — N-way select_best (PR #5101)", () => {
  it("PairwiseConfigForm — select_best mode with 3 of 4 variants picked", async () => {
    await page.viewport(520, 700);
    render(
      <ChakraProvider value={langwatchSystem}>
        <div style={{ width: 480, padding: 16, background: "white" }}>
          <PairwiseConfigForm
            value={{
              mode: "select_best",
              variants: ["variant_a", "variant_b", "variant_c"],
              goldenField: "expected_output",
              includeMetrics: ["cost"],
              positionBiasMitigation: null,
            }}
            onChange={() => {}}
            targets={fourTargets}
            datasetColumns={datasetColumns}
          />
        </div>
      </ChakraProvider>,
    );

    await screen.findByText(/3 variants selected/);
    await page.screenshot({
      path: "/tmp/pr5107/01-pairwise-config-form-select-best.png",
    });
  });

  it("AggregateHeaderBar — N-way tally across 4 variants", async () => {
    await page.viewport(1800, 80);
    render(
      <ChakraProvider value={langwatchSystem}>
        <div style={{ width: 1780, background: "white" }}>
          <AggregateHeaderBar
            variants={[
              { id: "variant_a", name: "gpt-4o v3", wins: 12 },
              { id: "variant_b", name: "gpt-4o v4", wins: 7 },
              { id: "variant_c", name: "claude-3.5", wins: 9 },
              { id: "variant_d", name: "gemini-1.5", wins: 3 },
            ]}
            ties={2}
            totalCost={0.1342}
            activeFilter={{ variantId: "variant_a" }}
            onFilterChange={() => {}}
            onExport={() => {}}
            onPromote={() => {}}
            biasCorrected={true}
          />
        </div>
      </ChakraProvider>,
    );

    await screen.findByText(/gpt-4o v3 wins 12/);
    await page.screenshot({
      path: "/tmp/pr5107/02-aggregate-header-nway.png",
    });
  });

  it("RowVerdictStrip — N-way winner is a real variant id", async () => {
    await page.viewport(800, 40);
    render(
      <ChakraProvider value={langwatchSystem}>
        <div style={{ width: 780, background: "white" }}>
          <RowVerdictStrip
            winnerName="claude-3.5"
            isTie={false}
            reasoning="Of the 4 candidates, claude-3.5 stays closest to the golden answer's structure and wording while keeping the answer concise."
          />
        </div>
      </ChakraProvider>,
    );

    await screen.findByText("claude-3.5");
    await page.screenshot({
      path: "/tmp/pr5107/03-row-verdict-nway-winner.png",
    });
  });
});
