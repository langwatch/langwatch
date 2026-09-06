/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import type { TargetConfig } from "../../../types";
import type { ComparisonAggregate } from "../../../utils/computeAggregates";
import { ComparisonScoreboard } from "../ComparisonScoreboard";

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

const aggregate = (
  overrides: Partial<ComparisonAggregate> = {},
): ComparisonAggregate => ({
  evaluatorId: "cmp-1",
  variants: ["target-a", "target-b", "target-c"],
  winsByLabel: {},
  ties: 0,
  decidedRows: 0,
  topCount: 0,
  totalCost: 0,
  ...overrides,
});

describe("ComparisonScoreboard", () => {
  afterEach(() => cleanup());

  describe("given no decided rows", () => {
    it("renders nothing", () => {
      const { container } = wrap(
        <ComparisonScoreboard
          aggregate={aggregate()}
          variantTargets={[target("target-a"), target("target-b")]}
          variantNames={["a", "b"]}
          variantDisplayNames={["a", "b"]}
        />,
      );
      expect(container).toBeEmptyDOMElement();
    });
  });

  describe("given a clear winner", () => {
    it("names the winning variant", () => {
      wrap(
        <ComparisonScoreboard
          aggregate={aggregate({
            winsByLabel: { "target-a": 3, "target-b": 1 },
            decidedRows: 4,
            topCount: 3,
            topLabel: "target-a",
          })}
          variantTargets={[target("target-a"), target("target-b")]}
          variantNames={["Alpha", "Beta"]}
          variantDisplayNames={["Alpha", "Beta"]}
        />,
      );
      expect(screen.getByText("Alpha wins")).toBeInTheDocument();
    });
  });

  describe("given no single leader", () => {
    it("reads as Tied", () => {
      wrap(
        <ComparisonScoreboard
          aggregate={aggregate({
            winsByLabel: { "target-a": 2, "target-b": 2 },
            decidedRows: 4,
            topCount: 2,
            // no topLabel — two variants share the lead
          })}
          variantTargets={[target("target-a"), target("target-b")]}
          variantNames={["Alpha", "Beta"]}
          variantDisplayNames={["Alpha", "Beta"]}
        />,
      );
      expect(screen.getByText("Tied")).toBeInTheDocument();
    });
  });

  // The three-way case #5101 exists for: the third variant's wins must be
  // tallied and it must be nameable as the winner, not collapsed away.
  describe("given a three-way comparison the third variant leads", () => {
    it("names the third variant as the winner", () => {
      wrap(
        <ComparisonScoreboard
          aggregate={aggregate({
            winsByLabel: { "target-a": 1, "target-b": 1, "target-c": 4 },
            decidedRows: 6,
            topCount: 4,
            topLabel: "target-c",
          })}
          variantTargets={[
            target("target-a"),
            target("target-b"),
            target("target-c"),
          ]}
          variantNames={["Alpha", "Beta", "Gamma"]}
          variantDisplayNames={["Alpha", "Beta", "Gamma"]}
        />,
      );
      expect(screen.getByText("Gamma wins")).toBeInTheDocument();
    });
  });
});
