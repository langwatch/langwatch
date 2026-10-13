/**
 * @vitest-environment jsdom
 *
 * A proposal is a change Langy staged and has not made: nothing happens until Apply, and a
 * deletion asks for a red, explicit confirm.
 * @see specs/langy/langy-capability-cards.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { AppliedOutcome } from "../langy-proposal-card.tsx";

vi.mock("@langwatch/browser-host/use-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const { ProposalCard } = await import("../langy-proposal-card.tsx");

const newEvaluator = {
  langyProposal: true as const,
  kind: "evaluator.create",
  summary: "Create the Faithfulness evaluator",
  payload: { name: "Faithfulness" },
};

const deleteEvaluator = {
  langyProposal: true as const,
  kind: "evaluator.delete",
  summary: "Delete the Faithfulness evaluator",
  destructive: true,
  payload: { id: "eval_1" },
};

function Harness({
  proposal,
  onApply,
  outcome,
}: {
  proposal: typeof newEvaluator | typeof deleteEvaluator;
  onApply: () => void;
  outcome?: AppliedOutcome;
}) {
  const [applied, setApplied] = useState<AppliedOutcome>(undefined);
  const [discarded, setDiscarded] = useState(false);
  return (
    <ProposalCard
      proposal={proposal}
      appliedOutcome={applied ?? undefined}
      isDiscarded={discarded}
      isApplying={false}
      onApply={() => {
        onApply();
        setApplied(outcome ?? { label: "Open", href: "/acme" });
      }}
      onDiscard={() => setDiscarded(true)}
    />
  );
}

function renderProposal(props: Parameters<typeof Harness>[0]) {
  return render(
    <DesignSystemProvider forcedTheme="light">
      <Harness {...props} />
    </DesignSystemProvider>,
  );
}

describe("ProposalCard", () => {
  describe("given Langy staged a new evaluator as a proposal", () => {
    /** @scenario "Creating a resource renders as a proposal until I apply it" */
    it("offers Apply and Discard, creates nothing until Apply, then opens the evaluator", async () => {
      const onApply = vi.fn();
      const user = userEvent.setup();
      renderProposal({
        proposal: newEvaluator,
        onApply,
        outcome: { label: "Open evaluator", href: "/acme/evaluators" },
      });

      expect(screen.getByText("Proposal")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Apply" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Discard" })).toBeTruthy();
      expect(onApply).not.toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: "Apply" }));

      expect(onApply).toHaveBeenCalledTimes(1);
      expect(screen.getByText("Applied")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
      const open = screen.getByRole("link", { name: /Open evaluator/ });
      expect(open.getAttribute("href")).toBe("/acme/evaluators");
    });
  });

  describe("given Langy staged the deletion of an evaluator", () => {
    /** @scenario "A destructive action is gated behind a red confirm" */
    it("reads as destructive in red, labels the confirm Delete and offers Cancel", () => {
      renderProposal({ proposal: deleteEvaluator, onApply: vi.fn() });

      const overline = screen.getByText("Wants to delete");
      expect(getComputedStyle(overline).color).toContain("red");
      expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
    });
  });
});
