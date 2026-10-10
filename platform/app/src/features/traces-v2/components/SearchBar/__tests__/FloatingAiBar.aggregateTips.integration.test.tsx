/**
 * @vitest-environment jsdom
 *
 * The Ask AI bar cycles tips under the composer. One of them points to the
 * "+" next to the lenses to save the result as a lens. An aggregate project
 * is read only (ADR-144) and its trace list shows no "+", so on an aggregate
 * that tip would send ana looking for a button that is not there.
 *
 * @see specs/governance/aggregate-project.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { FloatingAiBar } from "../FloatingAiBar";

const { projectRef } = vi.hoisted(() => ({
  projectRef: { current: { id: "proj-1", kind: "application" } },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: projectRef.current,
    hasPermission: () => true,
  }),
}));

vi.mock("@paper-design/shaders-react", () => ({
  MeshGradient: () => null,
}));

// The composer dispatches through tRPC; these tests only read the tip row.
vi.mock("../../ai/useAiTraceAction", () => ({
  useAiTraceAction: () => ({
    submit: vi.fn(),
    isPending: false,
    error: null,
    clearError: vi.fn(),
  }),
}));

const LENS_TIP = /save the result as a lens/i;
/** Matches any of the bar's tips, so the test reads whichever one shows. */
const ANY_TIP =
  /save the result as a lens|press enter to apply|describe what you want/i;
const TIP_INTERVAL_MS = 4200;

/** Renders the bar and collects every tip it shows over a few cycles. */
async function tipsShownOver(cycles: number): Promise<string[]> {
  render(
    <ChakraProvider value={defaultSystem}>
      <FloatingAiBar
        rect={{ top: 100, left: 100, width: 600 }}
        onClose={vi.fn()}
      />
    </ChakraProvider>,
  );
  const seen: string[] = [];
  for (let step = 0; step < cycles; step++) {
    const tip = screen.getByText(ANY_TIP).textContent ?? "";
    seen.push(tip);
    act(() => {
      vi.advanceTimersByTime(TIP_INTERVAL_MS);
    });
    await waitFor(() =>
      expect(screen.getByText(ANY_TIP).textContent).not.toBe(tip),
    );
  }
  return seen;
}

beforeEach(() => {
  // Only the tip interval is faked; motion's exit animation keeps real
  // frames so AnimatePresence can swap one tip for the next.
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("<FloatingAiBar /> tips", () => {
  describe("given an aggregate project", () => {
    /** @scenario "The aggregate's trace list offers no control to save a view" */
    it("never suggests saving the result as a lens", async () => {
      projectRef.current = { id: "proj-agg", kind: "aggregate" };

      const tips = await tipsShownOver(6);

      expect(new Set(tips).size).toBeGreaterThan(1);
      expect(tips.some((tip) => LENS_TIP.test(tip))).toBe(false);
    });
  });

  describe("given an ordinary project", () => {
    /** @scenario "The aggregate's trace list offers no control to save a view" */
    it("still suggests saving the result as a lens", async () => {
      projectRef.current = { id: "proj-1", kind: "application" };

      const tips = await tipsShownOver(6);

      expect(tips.some((tip) => LENS_TIP.test(tip))).toBe(true);
    });
  });
});
