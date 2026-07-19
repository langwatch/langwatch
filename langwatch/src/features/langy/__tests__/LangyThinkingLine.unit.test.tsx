/**
 * @vitest-environment jsdom
 *
 * The thinking line with live reasoning: a periodic GLIMPSE of the latest
 * complete thought — never a ticker — and a click-to-expand full scrollback.
 * The line stays a plain, non-interactive status line when no reasoning flows.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { UIMessage } from "ai";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LangyThinkingLine } from "../components/LangyThinkingLine";
import { GLIMPSE_PERIOD_MS } from "../logic/langyReasoningGlimpse";

const REASONING =
  "The p95 spike is confined to one window. Checking whether the slow traces share anything.";

function renderLine({ reasoning }: { reasoning: string | null }) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <LangyThinkingLine messages={[]} reasoning={reasoning} />
    </ChakraProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("LangyThinkingLine", () => {
  describe("when no reasoning is flowing", () => {
    it("renders a plain status line with nothing to expand", () => {
      renderLine({ reasoning: null });
      expect(screen.getByRole("status")).toBeDefined();
      expect(screen.queryByRole("button")).toBeNull();
    });
  });

  describe("when a running tool carries a long line", () => {
    it("keeps the whole skill summary on one clamped status line", () => {
      // The exact overflow case: the github skill's line is its title plus its
      // full summary — "Using the GitHub skill — Open a real pull request …" —
      // which used to run off the panel's right edge. It must still surface in
      // full (clamped by the renderer), so the content path is exercised, not
      // just the CSS.
      render(
        <ChakraProvider value={defaultSystem}>
          <LangyThinkingLine
            messages={
              [
                {
                  id: "u1",
                  role: "user",
                  parts: [{ type: "text", text: "open a PR" }],
                },
                {
                  id: "a1",
                  role: "assistant",
                  parts: [
                    {
                      type: "tool-skill",
                      state: "input-available",
                      input: { name: "github" },
                    },
                  ],
                },
              ] as unknown as UIMessage[]
            }
            reasoning={null}
          />
        </ChakraProvider>,
      );
      const status = screen.getByRole("status");
      expect(status.textContent).toContain("Using the GitHub skill");
      expect(status.textContent).toContain("Open a real pull request");
      // Non-interactive: no reasoning stream, so nothing to expand.
      expect(screen.queryByRole("button")).toBeNull();
    });
  });

  describe("when reasoning streams on a live turn", () => {
    it("surfaces a glimpse of the latest complete thought after the first beat", () => {
      renderLine({ reasoning: REASONING });
      act(() => {
        vi.advanceTimersByTime(1_700);
      });
      // The latest complete clause ends at "…share anything." — the glimpse
      // shows its freshest words, never the raw stream.
      expect(screen.getByText(/share anything\./)).toBeDefined();
    });

    it("keeps surfacing glimpses on the quiet period", () => {
      renderLine({ reasoning: REASONING });
      act(() => {
        vi.advanceTimersByTime(1_700 + GLIMPSE_PERIOD_MS);
      });
      expect(screen.getByText(/share anything\./)).toBeDefined();
    });

    it("expands to the full reasoning on click and collapses on a second click", () => {
      renderLine({ reasoning: REASONING });
      const line = screen.getByRole("button");
      expect(line.getAttribute("aria-expanded")).toBe("false");

      act(() => {
        line.click();
      });
      expect(line.getAttribute("aria-expanded")).toBe("true");
      expect(screen.getByText(REASONING)).toBeDefined();

      act(() => {
        line.click();
      });
      expect(line.getAttribute("aria-expanded")).toBe("false");
      expect(screen.queryByText(REASONING)).toBeNull();
    });

    it("collapses and clears the glimpse when the turn settles", () => {
      const view = renderLine({ reasoning: REASONING });
      const line = screen.getByRole("button");
      act(() => {
        line.click();
        vi.advanceTimersByTime(1_700);
      });
      expect(line.getAttribute("aria-expanded")).toBe("true");

      // The store clears `reasoning` when the turn settles.
      view.rerender(
        <ChakraProvider value={defaultSystem}>
          <LangyThinkingLine messages={[]} reasoning={null} />
        </ChakraProvider>,
      );
      expect(screen.queryByRole("button")).toBeNull();
      expect(screen.queryByText(/share anything\./)).toBeNull();
    });
  });
});
