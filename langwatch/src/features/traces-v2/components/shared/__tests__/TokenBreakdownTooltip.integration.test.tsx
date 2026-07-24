/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TokenBreakdownTooltipContent } from "../TokenBreakdownTooltip";

// Unmount between cases so renders don't leak rows into one another's
// document-scoped assertions (RTL auto-cleanup isn't wired in this project).
afterEach(cleanup);

function renderBreakdown(
  props: Partial<Parameters<typeof TokenBreakdownTooltipContent>[0]> = {},
) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <TokenBreakdownTooltipContent
        inputTokens={1000}
        outputTokens={50}
        cacheReadTokens={null}
        cacheCreationTokens={null}
        reasoningTokens={null}
        totalWithCache={1050}
        {...props}
      />
    </ChakraProvider>,
  );
}

describe("TokenBreakdownTooltipContent", () => {
  describe("given a turn that reported cache and reasoning tokens", () => {
    describe("when the breakdown renders", () => {
      it("shows every row plus the cache-inclusive total", () => {
        const { getByText } = renderBreakdown({
          inputTokens: 12000,
          outputTokens: 800,
          cacheReadTokens: 96000,
          cacheCreationTokens: 4000,
          reasoningTokens: 256,
          totalWithCache: 112800,
        });

        expect(getByText("Input")).toBeInTheDocument();
        expect(getByText("12,000")).toBeInTheDocument();
        expect(getByText("Cache read")).toBeInTheDocument();
        expect(getByText("96,000")).toBeInTheDocument();
        expect(getByText("Cache write")).toBeInTheDocument();
        expect(getByText("4,000")).toBeInTheDocument();
        expect(getByText("Reasoning")).toBeInTheDocument();
        expect(getByText("256")).toBeInTheDocument();
        // The total counts cache read + write on top of input+output.
        expect(getByText("Total")).toBeInTheDocument();
        expect(getByText("112,800")).toBeInTheDocument();
      });
    });
  });

  describe("given a turn with no prompt caching or reasoning", () => {
    describe("when the breakdown renders", () => {
      it("hides the cache and reasoning rows but keeps input, output, total", () => {
        const { getByText, queryByText } = renderBreakdown();

        expect(getByText("Input")).toBeInTheDocument();
        expect(getByText("Output")).toBeInTheDocument();
        expect(getByText("Total")).toBeInTheDocument();
        expect(queryByText("Cache read")).not.toBeInTheDocument();
        expect(queryByText("Cache write")).not.toBeInTheDocument();
        expect(queryByText("Reasoning")).not.toBeInTheDocument();
      });
    });
  });

  describe("given missing input/output counts", () => {
    describe("when the breakdown renders", () => {
      it("renders an em dash instead of a number", () => {
        const { getAllByText } = renderBreakdown({
          inputTokens: null,
          outputTokens: null,
        });

        expect(getAllByText("—").length).toBe(2);
      });
    });
  });

  describe("given an estimated token count", () => {
    describe("when the breakdown renders", () => {
      it("surfaces the estimated caveat", () => {
        const { getByText } = renderBreakdown({ estimated: true });

        expect(getByText("Tokens are estimated")).toBeInTheDocument();
      });
    });
  });

  describe("given an authoritative token count", () => {
    describe("when the breakdown renders", () => {
      it("omits the estimated caveat", () => {
        const { queryByText } = renderBreakdown({ estimated: false });

        expect(queryByText("Tokens are estimated")).not.toBeInTheDocument();
      });
    });
  });
});
