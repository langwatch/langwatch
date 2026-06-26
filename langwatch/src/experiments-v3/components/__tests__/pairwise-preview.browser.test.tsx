/**
 * Visual preview of the pairwise compare UI (#5100). Renders each new
 * component with realistic mock data in real Chromium and captures
 * screenshots that are attached to the PR. No backend, no DB — pure
 * component rendering.
 *
 * Screenshots land under `/tmp/pr5106/` so the assistant can upload them.
 */

import { ChakraProvider, HStack } from "@chakra-ui/react";
import { system as langwatchSystem } from "~/pages/_app";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

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

/**
 * Harness for the unified-drawer toggle verification. Wraps the form in a
 * real react-hook-form provider so the Include cost / Include duration
 * switches actually drive `settings.include_metrics` (the field the
 * runner consumes), and surfaces a live readout of that field so the
 * test can assert the click-to-toggle behavior end-to-end.
 */
function PairwiseHarness({
  initialMetrics = [] as ("cost" | "duration")[],
}: {
  initialMetrics?: ("cost" | "duration")[];
}) {
  const form = useForm({
    defaultValues: { name: "Pairwise Compare", settings: { include_metrics: initialMetrics } },
  });
  const [pairwise, setPairwise] = useState({
    variantA: "variant_a",
    variantB: "variant_b",
    goldenField: "expected_output",
    includeMetrics: initialMetrics,
  });
  const metrics = form.watch("settings.include_metrics");
  return (
    <FormProvider {...form}>
      <div style={{ width: 480, padding: 16, background: "white" }}>
        <PairwiseConfigForm
          value={pairwise}
          onChange={setPairwise}
          targets={targets}
          datasetColumns={datasetColumns}
        />
        <div data-testid="metrics-readout" style={{ paddingTop: 8, fontFamily: "monospace" }}>
          settings.include_metrics = {JSON.stringify(metrics)}
        </div>
      </div>
    </FormProvider>
  );
}

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

  it("AggregateHeaderBar — tally + filter chips + handoffs", async () => {
    await page.viewport(1600, 70);
    render(
      <ChakraProvider value={langwatchSystem}>
        <div style={{ width: 1580, background: "white" }}>
          <AggregateHeaderBar
            counts={{ a: 12, b: 7, tie: 2 }}
            variantAName="variant_a"
            variantBName="variant_b"
            totalCost={0.0421}
            activeFilter="all"
            onFilterChange={() => {}}
            onExport={() => {}}
            onPromoteA={() => {}}
            onPromoteB={() => {}}
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
            counts={{ a: 12, b: 7, tie: 2 }}
            variantAName="variant_a"
            variantBName="variant_b"
            totalCost={0.0421}
            activeFilter="losses"
            onFilterChange={() => {}}
            onExport={() => {}}
            onPromoteA={() => {}}
            onPromoteB={() => {}}
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
      evaluatorType: "langevals/pairwise_compare" as EvaluatorConfig["evaluatorType"],
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

  it("Include duration switch — toggles on click and writes to settings.include_metrics", async () => {
    await page.viewport(560, 700);
    render(
      <ChakraProvider value={langwatchSystem}>
        <PairwiseHarness initialMetrics={[]} />
      </ChakraProvider>,
    );

    const durationSwitch = await screen.findByTestId(
      "pairwise-include-duration",
    );
    const readout = screen.getByTestId("metrics-readout");

    // OFF: nothing in the array, switch unchecked.
    expect(durationSwitch).toHaveAttribute("data-state", "unchecked");
    expect(readout.textContent).toContain("settings.include_metrics = []");
    await page.screenshot({
      path: "/tmp/pr5106/08-include-duration-off.png",
    });

    // Use the browser's real click so Chakra's label-wrapped hidden
    // checkbox toggles for real (synthetic fireEvent.click on the label
    // doesn't propagate to the input).
    await userEvent.click(page.getByTestId("pairwise-include-duration"));

    // ON: duration in the array, switch checked.
    expect(durationSwitch).toHaveAttribute("data-state", "checked");
    expect(readout.textContent).toContain(
      'settings.include_metrics = ["duration"]',
    );
    await page.screenshot({
      path: "/tmp/pr5106/09-include-duration-on.png",
    });

    await userEvent.click(page.getByTestId("pairwise-include-duration"));

    // Click again: back to OFF — proves it's a real toggle, not a one-way.
    expect(durationSwitch).toHaveAttribute("data-state", "unchecked");
    expect(readout.textContent).toContain("settings.include_metrics = []");
  });
});
