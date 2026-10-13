// @vitest-environment jsdom
/**
 * The Ask AI bar's lens tip points to the "+" beside the lenses; an aggregate project is
 * read only (ADR-177) and shows no "+", so the tip is not offered there.
 * @see specs/governance/aggregate-project.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { FloatingAiBar } from "../floating-ai-bar.tsx";

const { projectRef } = vi.hoisted(() => ({
  projectRef: { current: { id: "proj-1", kind: "application" } },
}));

vi.mock("../../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({
    project: projectRef.current,
    hasPermission: () => true,
  }),
}));

// jsdom never finishes motion's exit, so AnimatePresence would hold the first tip forever.
vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@paper-design/shaders-react", () => ({
  MeshGradient: () => null,
}));

// The composer dispatches through tRPC; these tests only read the tip row.
vi.mock("../../ai/use-ai-trace-action.ts", () => ({
  useAiTraceAction: () => ({
    submit: vi.fn(),
    isPending: false,
    error: null,
    clearError: vi.fn(),
  }),
}));

const LENS_TIP = /save the result as a lens/i;
/** Matches any of the bar's tips, so the test reads whichever one shows. */
const ANY_TIP = /save the result as a lens|press enter to apply|describe what you want/i;
const TIP_INTERVAL_MS = 4200;

/** Renders the bar and collects every tip it shows over a few cycles. */
async function tipsShownOver(cycles: number): Promise<string[]> {
  renderWithDesignSystem(
    <FloatingAiBar rect={{ top: 100, left: 100, width: 600 }} onClose={vi.fn()} />,
  );
  const seen: string[] = [];
  for (let step = 0; step < cycles; step++) {
    const tip = screen.getByText(ANY_TIP).textContent ?? "";
    seen.push(tip);
    act(() => {
      vi.advanceTimersByTime(TIP_INTERVAL_MS);
    });
    await waitFor(() => expect(screen.getByText(ANY_TIP).textContent).not.toBe(tip));
  }
  return seen;
}

beforeEach(() => {
  // Only the tip interval is faked.
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
