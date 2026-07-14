/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TargetConfig } from "../../types";
import { MISSING_MODEL_API_KEY_EXPLANATION } from "../../utils/explainEvaluatorDomainError";
import { ComparisonCell } from "../ComparisonCell";

// useTargetName reaches through to tRPC; mock it to resolve each target to a
// stable handle so WinnerLabel can match a verdict label against it.
const HANDLE_BY_ID: Record<string, string> = {
  "target-a": "concise-support",
  "target-b": "friendly-support",
};
vi.mock("../../hooks/useTargetName", () => ({
  useTargetName: (target: { id: string }) =>
    HANDLE_BY_ID[target.id] ?? target.id,
}));

// scrollToTargetColumn touches the DOM/layout; spy on it to assert the
// click wiring without needing a real scroll container.
const scrollSpy = vi.fn();
vi.mock("../../hooks/useOpenTargetEditor", () => ({
  scrollToTargetColumn: (id: string) => scrollSpy(id),
}));
vi.mock("~/components/Markdown", () => ({
  Markdown: ({ children }: { children: string }) => <div>{children}</div>,
}));

import { useEvaluationsV3Store } from "../../hooks/useEvaluationsV3Store";

const wrap = (node: ReactNode) =>
  render(<ChakraProvider value={defaultSystem}>{node}</ChakraProvider>);

const variantTargets: TargetConfig[] = [
  {
    id: "target-a",
    type: "prompt",
    promptId: "p-a",
    inputs: [],
    outputs: [],
    mappings: {},
  },
  {
    id: "target-b",
    type: "prompt",
    promptId: "p-b",
    inputs: [],
    outputs: [],
    mappings: {},
  },
];

describe("ComparisonCell", () => {
  afterEach(() => {
    cleanup();
    scrollSpy.mockClear();
    useEvaluationsV3Store.getState().setHighlightedVariantTargetId(undefined);
  });

  describe("given the comparison is still running", () => {
    it("shows a comparing indicator", () => {
      wrap(
        <ComparisonCell
          result={null}
          isLoading
          variantTargets={variantTargets}
        />,
      );
      expect(screen.getByText(/comparing/i)).toBeInTheDocument();
    });
  });

  describe("given no verdict has been produced yet", () => {
    it("says so rather than rendering an empty cell", () => {
      wrap(<ComparisonCell result={null} variantTargets={variantTargets} />);
      expect(screen.getByText(/no verdict yet/i)).toBeInTheDocument();
    });
  });

  describe("given the judge call errored", () => {
    it("surfaces a friendly headline", () => {
      wrap(
        <ComparisonCell
          result={{
            status: "error",
            details: "AuthenticationError: bad api key",
          }}
          variantTargets={variantTargets}
        />,
      );
      expect(screen.getByText(/model api key/i)).toBeInTheDocument();
    });

    describe("given the judge call failed auth (403)", () => {
      /** @scenario The Comparison cell renders a friendly auth failure */
      it("uses the domain error to show a rich auth message", () => {
        wrap(
          <ComparisonCell
            result={{
              status: "error",
              details: '403 {\n  "message": "Missing Authentication Token"\n}',
              domainError: {
                kind: "evaluator_execution_error",
                meta: { httpStatus: 403 },
                telemetry: {},
                httpStatus: 502,
                reasons: [],
              },
            }}
            variantTargets={variantTargets}
          />,
        );

        expect(
          screen.getByText(/missing or invalid model api key/i),
        ).toBeInTheDocument();
        expect(screen.getByText(/settings.*ai gateway/i)).toBeInTheDocument();
        // The raw provider payload belongs behind "show details", not in the
        // headline — locate the popover body by testid rather than Chakra's
        // private class, which is free to change on a version bump.
        expect(screen.getByText("show details")).toBeInTheDocument();
        expect(
          within(screen.getByTestId("comparison-error-details")).getByText(
            /^403/,
          ),
        ).toBeInTheDocument();
      });
    });

    // The auth message has two doors into the cell: a structured 401/403 domain
    // error, and the legacy raw-string heuristic that still serves results
    // stored before evaluators carried domain errors. Rendering both and
    // comparing pins them to a single source of truth — a second hard-coded
    // copy of the strings drifts the first time either one is reworded.
    describe("when the same auth failure arrives structurally and as raw text", () => {
      const readAuthCopy = (result: unknown) => {
        const { unmount } = wrap(
          <ComparisonCell result={result} variantTargets={variantTargets} />,
        );
        const copy = {
          headline: screen.getByText(MISSING_MODEL_API_KEY_EXPLANATION.headline)
            .textContent,
          hint: screen.getByText(MISSING_MODEL_API_KEY_EXPLANATION.hint)
            .textContent,
        };
        unmount();
        return copy;
      };

      it("renders one canonical copy for both", () => {
        const structural = readAuthCopy({
          status: "error",
          details: '403 {\n  "message": "Missing Authentication Token"\n}',
          domainError: {
            kind: "evaluator_execution_error",
            meta: { httpStatus: 403 },
            telemetry: {},
            httpStatus: 502,
            reasons: [],
          },
        });
        const legacy = readAuthCopy({
          status: "error",
          details: "AuthenticationError: bad api key",
        });

        expect(legacy).toEqual(structural);
        expect(structural).toEqual({
          headline: MISSING_MODEL_API_KEY_EXPLANATION.headline,
          hint: MISSING_MODEL_API_KEY_EXPLANATION.hint,
        });
      });
    });
  });

  describe("given a row-level run callback", () => {
    it("shows a per-row run action and calls it without selecting the cell", async () => {
      const user = userEvent.setup();
      const onRun = vi.fn();
      wrap(
        <ComparisonCell
          result={null}
          variantTargets={variantTargets}
          onRun={onRun}
        />,
      );

      await user.click(
        screen.getByRole("button", { name: /run comparison for this row/i }),
      );

      expect(onRun).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a tie verdict", () => {
    it("renders a tie, not a winner", () => {
      wrap(
        <ComparisonCell
          result={{ label: "tie", details: "evenly matched" }}
          variantTargets={variantTargets}
        />,
      );
      expect(screen.getByText("Tie")).toBeInTheDocument();
      expect(screen.queryByTestId("comparison-winner")).not.toBeInTheDocument();
    });
  });

  describe("given a winning variant", () => {
    it("names only the winner", () => {
      wrap(
        <ComparisonCell
          result={{ label: "friendly-support", details: "warmer tone" }}
          variantTargets={variantTargets}
        />,
      );
      const winners = screen.getAllByTestId("comparison-winner");
      expect(winners).toHaveLength(1);
      expect(winners[0]).toHaveTextContent("friendly-support");
    });

    it("highlights the winner's column and scrolls to it when clicked", async () => {
      const user = userEvent.setup();
      wrap(
        <ComparisonCell
          result={{ label: "friendly-support" }}
          variantTargets={variantTargets}
        />,
      );

      await user.click(screen.getByTestId("comparison-winner"));

      expect(
        useEvaluationsV3Store.getState().ui.highlightedVariantTargetId,
      ).toBe("target-b");
      expect(scrollSpy).toHaveBeenCalledWith("target-b");
    });
  });

  // Verdicts stored before the pairwise/N-way merge carry a slot letter
  // ("A"/"B") rather than the winning candidate's identifier.
  describe("given a legacy slot-letter verdict", () => {
    it("resolves the letter to the variant at that position", () => {
      wrap(
        <ComparisonCell
          result={{ label: "A" }}
          variantTargets={variantTargets}
        />,
      );
      const winners = screen.getAllByTestId("comparison-winner");
      expect(winners).toHaveLength(1);
      // "A" → variants[0] === target-a → handle "concise-support".
      expect(winners[0]).toHaveTextContent("concise-support");
    });
  });
});
