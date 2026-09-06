/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EvaluatorConfig, TargetConfig } from "../../types";
import { ComparisonColumnHeader } from "../ComparisonColumnHeader";

// Editor entry point pulls in the drawer machinery; a no-op is enough here.
vi.mock("../../hooks/useOpenEvaluatorEditor", () => ({
  useOpenComparisonEditor: () => vi.fn(),
}));
// Batched name lookup reaches through to tRPC.
vi.mock("../../hooks/useTargetName", () => ({
  useTargetNames: (targets: ({ id: string } | undefined)[]) =>
    targets.map((t) => t?.id ?? ""),
}));

import { useEvaluationsV3Store } from "../../hooks/useEvaluationsV3Store";

const wrap = (node: ReactNode) =>
  render(<ChakraProvider value={defaultSystem}>{node}</ChakraProvider>);

const target = (id: string): TargetConfig => ({
  id,
  type: "prompt",
  promptId: `p-${id}`,
  inputs: [],
  outputs: [],
  mappings: {},
});

const seedComparison = (variants: string[]) => {
  const store = useEvaluationsV3Store.getState();
  store.addTarget(target("target-a"));
  store.addTarget(target("target-b"));
  store.addEvaluator({
    id: "cmp-1",
    evaluatorType: "langevals/select_best_compare",
    inputs: [],
    mappings: {},
    comparison: {
      variants,
      hasGoldenAnswer: false,
      includeMetrics: [],
      randomizeOrder: true,
    },
  } as unknown as EvaluatorConfig);
};

describe("ComparisonColumnHeader", () => {
  beforeEach(() => {
    useEvaluationsV3Store.getState().reset();
  });
  afterEach(() => cleanup());

  describe("given a comparison with fewer than 2 variants", () => {
    it("shows a needs-configuration alert (its only surface for the cue)", () => {
      seedComparison(["target-a"]);
      wrap(<ComparisonColumnHeader evaluatorId="cmp-1" name="Comparison" />);
      expect(
        screen.getByTestId("comparison-missing-mapping-alert"),
      ).toBeInTheDocument();
    });
  });

  describe("given a fully configured comparison", () => {
    it("shows no alert", () => {
      seedComparison(["target-a", "target-b"]);
      wrap(<ComparisonColumnHeader evaluatorId="cmp-1" name="Comparison" />);
      expect(
        screen.queryByTestId("comparison-missing-mapping-alert"),
      ).not.toBeInTheDocument();
    });
  });
});
