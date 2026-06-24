/**
 * Visual preview of the pairwise compare UI (#5100). Renders each new
 * component with realistic mock data in real Chromium and captures
 * screenshots that are attached to the PR. No backend, no DB — pure
 * component rendering.
 *
 * Screenshots land under `/tmp/pr5106/` so the assistant can upload them.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, it } from "vitest";
import { page } from "vitest/browser";

import { AggregateHeaderBar } from "../AggregateHeaderBar";
import { PairwiseConfigForm } from "../EvaluatorPanel/PairwiseConfigForm";
import { RowVerdictStrip } from "../RowVerdictStrip";

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
      <ChakraProvider value={defaultSystem}>
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
    await page.viewport(1200, 80);
    render(
      <ChakraProvider value={defaultSystem}>
        <div style={{ width: 1180, background: "white" }}>
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
    await page.viewport(1200, 80);
    render(
      <ChakraProvider value={defaultSystem}>
        <div style={{ width: 1180, background: "white" }}>
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
    await page.viewport(800, 60);
    render(
      <ChakraProvider value={defaultSystem}>
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
    await page.viewport(800, 60);
    render(
      <ChakraProvider value={defaultSystem}>
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
    await page.viewport(800, 60);
    render(
      <ChakraProvider value={defaultSystem}>
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
});
