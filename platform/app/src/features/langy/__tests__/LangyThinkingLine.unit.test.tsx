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
import { act, render, renderHook, screen } from "@testing-library/react";
import type { UIMessage } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCyclingVerb } from "~/features/traces-v2/components/ai/useCyclingVerb";
import {
  LangyThinkingLine,
  THINKING_VERB_DWELL_MS,
} from "../components/LangyThinkingLine";
import { LANGY_THINKING_VERBS } from "../components/langyThinkingVerbs";
import { TEXT_QUIET_MS, THINKING_STUCK_MS } from "../logic/langyThinkingLine";

const REASONING_TEXT =
  "The p95 spike is confined to one window. Checking whether the slow traces share anything.";

function renderLine({ hasLiveReasoning }: { hasLiveReasoning: boolean }) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <LangyThinkingLine messages={[]} hasLiveReasoning={hasLiveReasoning} />
    </ChakraProvider>,
  );
}

/**
 * Whether the leading orb is claiming the turn is alive. A stuck turn keeps
 * the slot but drops the glow, which is the one state that must not claim it.
 */
const orbState = () =>
  document.querySelector("[data-status-orb]")?.getAttribute("data-status-orb");

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

    it("renders the text fully opaque, with no end-of-line fade mask", () => {
      // The line used to wear a mask-image gradient that dissolved its last
      // 1.5em to transparent — on a short "Thinking…" that faded the tail of
      // the text itself. Overflow is clamped with an ellipsis instead; no
      // rendered style may mask the text away.
      renderLine({ hasLiveReasoning: false });
      const styles = Array.from(document.querySelectorAll("style"))
        .map((tag) => tag.textContent ?? "")
        .join("\n");
      expect(styles).not.toContain("mask-image");
    });

    it("leads with the shared status-orb slot so the line never jumps", () => {
      // The startup sequence alternates this line with StreamingStatusLine's
      // orb-led rows; both share STATUS_LINE_ROW, so the leading indicator
      // slot exists here too and the text keeps one left offset throughout.
      renderLine({ hasLiveReasoning: false });
      expect(document.querySelector("[data-status-orb]")).not.toBeNull();
    });
  });

  describe("given a running skill tool", () => {
    it("says a skill is loading, in the reader's words, on one status line", () => {
      // The activity card names the skill and quotes its summary; the row
      // under the transcript says only what the reader is waiting on.
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
      expect(status.textContent).toBe("Loading a skill");
      expect(screen.queryByRole("button")).toBeNull();
    });
  });

  describe("given a turn that has been running a long time", () => {
    // The line's clock reads `Date.now()`, which the suite's default fake
    // timers leave alone, so the wall clock has to be faked as well for the
    // escalation to be reachable at all.
    beforeEach(() => {
      vi.useFakeTimers({
        toFake: [
          "setTimeout",
          "clearTimeout",
          "setInterval",
          "clearInterval",
          "Date",
        ],
      });
    });

    /**
     * The clock the escalation reads is silence, not turn length. It used to
     * run from the moment the line mounted, so a turn that had answered a
     * permission card and was running a local command, with output arriving
     * in the terminal, was told it may be stuck while nothing was wrong.
     *
     * @scenario "The escalation measures silence, not how long the turn has run" */
    it("drops the stuck line as soon as the turn produces something", () => {
      const line = (activityKey: string) => (
        <ChakraProvider value={defaultSystem}>
          <LangyThinkingLine messages={[]} activityKey={activityKey} />
        </ChakraProvider>
      );
      const { rerender } = render(line("calls:0"));

      act(() => {
        vi.advanceTimersByTime(THINKING_STUCK_MS + 2_000);
      });
      // The orb reads the tone directly, so it says what the line has decided
      // without waiting on the text's crossfade.
      expect(orbState()).toBe("idle");

      // One tool call landed. The turn is working, so it may not read as
      // stuck any more.
      rerender(line("calls:1"));
      expect(orbState()).toBe("active");
    });

    /** @scenario "A turn that really is silent still ends up looking stuck" */
    it("keeps escalating while nothing at all happens", () => {
      render(
        <ChakraProvider value={defaultSystem}>
          <LangyThinkingLine messages={[]} activityKey="quiet" />
        </ChakraProvider>,
      );
      expect(orbState()).toBe("active");

      act(() => {
        vi.advanceTimersByTime(THINKING_STUCK_MS + 2_000);
      });
      expect(orbState()).toBe("idle");
    });
  });

  describe("given the reply's text is arriving", () => {
    const withReply = (text: string) =>
      [
        { id: "u1", role: "user", parts: [{ type: "text", text: "go" }] },
        {
          id: "a1",
          role: "assistant",
          parts: [
            {
              type: "tool-bash",
              state: "output-available",
              input: { command: "ls" },
            },
            { type: "text", text },
          ],
        },
      ] as unknown as UIMessage[];
    const row = (text: string) => (
      <ChakraProvider value={defaultSystem}>
        <LangyThinkingLine messages={withReply(text)} activityKey="k" />
      </ChakraProvider>
    );

    /** @scenario "The activity row returns once the text has been quiet for a second" */
    it("hides while tokens arrive and returns after one quiet second, with a spinner and a verb", () => {
      const { rerender } = render(row("Here"));
      // Text already on the message when the row mounts counts as quiet.
      expect(screen.getByRole("status")).toBeDefined();

      rerender(row("Here is"));
      expect(screen.queryByRole("status")).toBeNull();

      // Another delta inside the window keeps it hidden, and restarts it.
      act(() => {
        vi.advanceTimersByTime(TEXT_QUIET_MS - 100);
      });
      rerender(row("Here is the"));
      act(() => {
        vi.advanceTimersByTime(TEXT_QUIET_MS - 100);
      });
      expect(screen.queryByRole("status")).toBeNull();

      act(() => {
        vi.advanceTimersByTime(100);
      });
      const status = screen.getByRole("status");
      expect(LANGY_THINKING_VERBS.map((verb) => `${verb}…`)).toContain(
        status.textContent,
      );
      expect(
        document.querySelector("[data-langy-activity-spinner]"),
      ).not.toBeNull();
    });

    /** @scenario "The activity row cycles a verb while Langy works between steps" */
    it("changes the verb every few seconds while the turn works", () => {
      render(row("Done."));
      expect(screen.getByRole("status").textContent).toBe("Thinking…");

      // The crossfade waits for the exit animation, which jsdom never plays,
      // so the rotation itself is read off the hook the row cycles with, at
      // the row's own dwell.
      const { result } = renderHook(() =>
        useCyclingVerb(true, LANGY_THINKING_VERBS, THINKING_VERB_DWELL_MS),
      );
      expect(result.current).toBe("Thinking");
      act(() => {
        vi.advanceTimersByTime(THINKING_VERB_DWELL_MS);
      });
      expect(result.current).toBe("Crunching");
      act(() => {
        vi.advanceTimersByTime(THINKING_VERB_DWELL_MS);
      });
      expect(result.current).toBe("Thinking");
      expect(THINKING_VERB_DWELL_MS).toBe(2_400);
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
