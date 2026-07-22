/**
 * @vitest-environment jsdom
 *
 * The thinking line is a plain, non-interactive status line. Reasoning reaches
 * it as a BOOLEAN and nothing more: it changes the words ("Thinking…" instead of
 * a false escalation toward "stuck") and never becomes a surface. The model's
 * private thinking is not shown to the user — no glimpse, no expander, no
 * scrollback.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { UIMessage } from "ai";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LangyThinkingLine } from "../components/LangyThinkingLine";

const REASONING_TEXT =
  "The p95 spike is confined to one window. Checking whether the slow traces share anything.";

function renderLine({ hasLiveReasoning }: { hasLiveReasoning: boolean }) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <LangyThinkingLine messages={[]} hasLiveReasoning={hasLiveReasoning} />
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
  describe("given no reasoning is flowing", () => {
    it("renders a plain status line with nothing to expand", () => {
      renderLine({ hasLiveReasoning: false });
      expect(screen.getByRole("status")).toBeDefined();
      expect(screen.queryByRole("button")).toBeNull();
    });
  });

  describe("given a running tool carries a long line", () => {
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
          />
        </ChakraProvider>,
      );
      const status = screen.getByRole("status");
      expect(status.textContent).toContain("Using the GitHub skill");
      expect(status.textContent).toContain("Open a real pull request");
      expect(screen.queryByRole("button")).toBeNull();
    });
  });

  describe("given reasoning is streaming on a live turn", () => {
    it("says Thinking, so a working turn never reads as a silent one", () => {
      // The escalation ladder itself is pinned on the pure logic
      // (`langyThinkingLine.unit.test.ts`); what matters here is that the
      // component forwards the boolean at all.
      renderLine({ hasLiveReasoning: true });
      const status = screen.getByRole("status");
      expect(status.textContent).toContain("Thinking");
    });

    it("stays a non-interactive line with no reasoning surface", () => {
      renderLine({ hasLiveReasoning: true });
      act(() => {
        vi.advanceTimersByTime(30_000);
      });
      // No expander, and nothing the user can open to read the model's
      // thinking — the whole point of hiding reasoning.
      expect(screen.queryByRole("button")).toBeNull();
      expect(screen.queryByText(REASONING_TEXT)).toBeNull();
    });
  });
});
