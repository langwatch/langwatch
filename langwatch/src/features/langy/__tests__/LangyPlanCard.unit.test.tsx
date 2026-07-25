/**
 * @vitest-environment jsdom
 *
 * The plan checklist card: steps in order, the current one expanded with its
 * nested work, completed steps collapsed, a cancelled step struck, and a
 * settled/finished plan collapsed to a summary. Plus the zero-regression pin:
 * a turn with no plan renders exactly the flat activity list it does today.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";

// The capability renderer (reached via the collapsed-receipt scenario) reads
// the project off this hook, which is tRPC-backed, mock the boundary, as the
// other panel tests do, instead of standing up a client.
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { slug: "demo" } }),
}));

import { LangyPlanCard } from "../components/LangyPlanCard";
import { LangyToolActivity } from "../components/LangyToolActivity";
import type { LangyPlan } from "../logic/langyPlan";

function ui(node: React.ReactNode) {
  return render(<ChakraProvider value={defaultSystem}>{node}</ChakraProvider>);
}

/** A settled non-plan tool call part, the kind that nests under a step. */
function toolPart(command: string, id: string) {
  return {
    type: "tool-bash",
    toolCallId: id,
    state: "output-available",
    input: { command },
    output: "ok",
  };
}

function plan(overrides: Partial<LangyPlan> = {}): LangyPlan {
  return {
    items: [
      { content: "Find the slow traces", status: "completed" },
      { content: "Summarise them", status: "in_progress" },
      { content: "Open a fix", status: "pending" },
    ],
    currentIndex: 1,
    completedCount: 1,
    totalCount: 3,
    itemParts: [[], [toolPart("echo summarising", "c-summary")], []],
    preamble: [],
    ...overrides,
  };
}

describe("LangyPlanCard", () => {
  describe("given a multi-step plan in flight", () => {
    it("shows only the current step under a compact progress summary", () => {
      ui(<LangyPlanCard plan={plan()} isStreaming />);
      expect(screen.getByText("Plan · 1 of 3 · 2 left")).toBeDefined();
      expect(screen.queryByText("Find the slow traces")).toBeNull();
      expect(screen.getByText("Summarise them")).toBeDefined();
      expect(screen.queryByText("Open a fix")).toBeNull();
    });

    it("nests the current step's work under it", () => {
      ui(<LangyPlanCard plan={plan()} isStreaming />);
      // The tool that ran while step 2 was current is shown by default.
      expect(screen.getByText("echo summarising")).toBeDefined();
    });

    it("does not expand a completed step's work by default", () => {
      ui(
        <LangyPlanCard
          plan={plan({
            itemParts: [[toolPart("echo searching", "c1")], [], []],
          })}
          isStreaming
        />,
      );
      // Step 1 is completed, so its nested call is collapsed away until clicked.
      expect(screen.queryByText("echo searching")).toBeNull();
    });
  });

  describe("given a cancelled step", () => {
    it("shows it struck through and out of the total", () => {
      ui(
        <LangyPlanCard
          plan={plan({
            items: [
              { content: "Kept", status: "completed" },
              { content: "Abandoned", status: "cancelled" },
              { content: "Doing now", status: "in_progress" },
            ],
            completedCount: 1,
            totalCount: 2,
          })}
          isStreaming
        />,
      );
      expect(screen.getByText("Plan · 1 of 2 · 1 left")).toBeDefined();
      screen.getByRole("button", { name: /plan/i }).click();
      const struck = screen.getByText("Abandoned");
      expect(getComputedStyle(struck).textDecoration).toContain("line-through");
    });
  });

  describe("given a settled, fully-completed plan", () => {
    it("collapses the whole card to a completed summary", () => {
      ui(
        <LangyPlanCard
          plan={plan({
            items: [
              { content: "Find the slow traces", status: "completed" },
              { content: "Summarise them", status: "completed" },
            ],
            currentIndex: -1,
            completedCount: 2,
            totalCount: 2,
            itemParts: [[], []],
          })}
          isStreaming={false}
        />,
      );
      expect(screen.getByText("Plan · 2 of 2 · done")).toBeDefined();
      // The individual steps are hidden behind the collapse.
      expect(screen.queryByText("Summarise them")).toBeNull();
    });
  });

  describe("given a settled but incomplete plan (a frozen failure)", () => {
    it("keeps done steps green and does not fake completion", () => {
      ui(
        <LangyPlanCard
          plan={plan({ currentIndex: 1, completedCount: 1, totalCount: 3 })}
          isStreaming={false}
        />,
      );
      // Not collapsed to a "Completed N steps" summary — the plan is frozen.
      expect(screen.queryByText(/Completed 3 steps/)).toBeNull();
      expect(screen.getByText("Plan · 1 of 3 · 2 left")).toBeDefined();
      expect(screen.getByText("Summarise them")).toBeDefined();
    });
  });
});

describe("LangyToolActivity zero-regression when there is no plan", () => {
  it("renders the flat activity list with no plan overline", () => {
    const message = {
      id: "m1",
      role: "assistant",
      parts: [toolPart("echo hi", "c1")],
    } as unknown as UIMessage;
    ui(<LangyToolActivity message={message} />);
    expect(screen.getByText("echo hi")).toBeDefined();
    expect(screen.queryByText(/^Plan ·/)).toBeNull();
    expect(screen.queryByLabelText("Langy plan")).toBeNull();
  });

  it("collapses repeated capability results into one inspectable receipt", () => {
    const message = {
      id: "m-datasets",
      role: "assistant",
      parts: Array.from({ length: 4 }, (_, index) => ({
        type: "tool-langwatch.dataset.list",
        toolCallId: `datasets-${index}`,
        state: "output-available",
        input: {},
        output: { datasets: [] },
      })),
    } as unknown as UIMessage;

    ui(<LangyToolActivity message={message} />);

    expect(screen.getByText("Checked datasets 4 times")).toBeDefined();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});
