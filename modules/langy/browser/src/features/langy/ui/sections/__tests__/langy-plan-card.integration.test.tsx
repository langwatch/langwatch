/**
 * @vitest-environment jsdom
 *
 * The plan checklist as the reader sees it: every step a checkbox that names its status, a
 * header that counts what is done, open while the turn runs and folded once it settles.
 * @see specs/langy/langy-plan-progress.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { langyPlan } from "../../../../../model/langy-plan.ts";
import { LangyPlanCard } from "../langy-plan-card.tsx";

function planOf(todos: { content: string; status: string }[]) {
  const plan = langyPlan({ parts: [{ type: "tool-todowrite", input: { todos } } as never] });
  if (!plan) throw new Error("no plan");
  return plan;
}

const threeSteps = planOf([
  { content: "Read the traces", status: "completed" },
  { content: "Write the evaluator", status: "in_progress" },
  { content: "Run the experiment", status: "pending" },
]);

function ui({ isStreaming }: { isStreaming: boolean }) {
  return (
    <DesignSystemProvider forcedTheme="light">
      <LangyPlanCard plan={threeSteps} isStreaming={isStreaming} />
    </DesignSystemProvider>
  );
}

const markers = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("[data-plan-marker]")).map((el) =>
    el.getAttribute("data-plan-marker"),
  );

describe("LangyPlanCard", () => {
  describe("given a running turn with finished, current and not-yet-started steps", () => {
    /** @scenario "Multi-step work shows a live checklist" */
    it("lists the steps in order with one current step and the finished one marked done", () => {
      const { container } = render(ui({ isStreaming: true }));

      const steps = Array.from(container.querySelectorAll("li")).map((li) => li.textContent);
      expect(steps).toEqual([
        "CompletedRead the traces",
        "In progressWrite the evaluator",
        "Not startedRun the experiment",
      ]);
      expect(markers(container)).toEqual(["completed", "in_progress", "pending"]);
      expect(markers(container).filter((m) => m === "in_progress")).toHaveLength(1);
    });

    /** @scenario "Every step reads as a checkbox and the header counts what is checked" */
    it("names each box's status and counts what is done out of the total, never what is left", () => {
      const { container } = render(ui({ isStreaming: true }));

      expect(screen.getByText("Completed")).toBeTruthy();
      expect(screen.getByText("In progress")).toBeTruthy();
      expect(screen.getByText("Not started")).toBeTruthy();
      expect(screen.getByText("Plan · 1 of 3 done")).toBeTruthy();
      expect(container.textContent?.toLowerCase()).not.toContain("left");
    });

    /** @scenario "The checklist is open while the turn works" */
    it("shows every step without a click, and folds to the progress line once settled", () => {
      const running = render(ui({ isStreaming: true }));
      expect(screen.getByText("Read the traces")).toBeTruthy();
      expect(screen.getByText("Run the experiment")).toBeTruthy();
      running.unmount();

      render(ui({ isStreaming: false }));
      expect(screen.getByText("Plan · 1 of 3 done")).toBeTruthy();
      expect(screen.queryByText("Read the traces")).toBeNull();
      expect(screen.queryByText("Run the experiment")).toBeNull();
    });

    /** @scenario "The checklist is open while the turn works" */
    it("keeps the reader's own choice when the turn settles or resumes", async () => {
      const user = userEvent.setup();
      const { rerender } = render(ui({ isStreaming: true }));

      await user.click(screen.getByRole("button", { expanded: true }));
      rerender(ui({ isStreaming: false }));
      expect(screen.queryByText("Read the traces")).toBeNull();

      await user.click(screen.getByRole("button", { expanded: false }));
      rerender(ui({ isStreaming: true }));
      rerender(ui({ isStreaming: false }));
      expect(screen.getByText("Read the traces")).toBeTruthy();
    });
  });

  describe("given a plan in which the agent cancelled one of its steps", () => {
    /** @scenario "A cancelled step is struck through, not dropped" */
    it("shows the step struck through and leaves it out of the completed total", () => {
      const plan = planOf([
        { content: "Kept", status: "completed" },
        { content: "Abandoned", status: "cancelled" },
        { content: "Doing now", status: "in_progress" },
      ]);
      render(
        <DesignSystemProvider forcedTheme="light">
          <LangyPlanCard plan={plan} isStreaming />
        </DesignSystemProvider>,
      );

      const abandoned = screen.getByText("Abandoned");
      expect(getComputedStyle(abandoned).textDecoration).toContain("line-through");
      expect(getComputedStyle(screen.getByText("Kept")).textDecoration).not.toContain(
        "line-through",
      );
      expect(screen.getByText("Plan · 1 of 2 done")).toBeTruthy();
    });
  });
});
