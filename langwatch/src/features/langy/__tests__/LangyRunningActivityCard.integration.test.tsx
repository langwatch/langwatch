/**
 * @vitest-environment jsdom
 *
 * The activity card is the RUNNING card, and nothing else.
 *
 * Its one call site renders it from `groups.filter((group) => !group.done)`, so
 * a group that settles moves to the completed receipt under a different key and
 * the card unmounts. The card nevertheless carried a whole second life for a
 * settled group — an auto-collapse timer, a collapsed summary button, a green
 * checkmark — that no mounted instance could ever reach, because `group.done` is
 * false for every group that gets there. That branch is gone.
 *
 * This file pins the invariant the deletion rests on: a settled group is drawn
 * by the receipt, and only by the receipt. Route settled work back through the
 * running card and these fail rather than quietly resurrecting dead code.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";

import { LangyToolActivity } from "../components/LangyToolActivity";

function turn(state: "input-available" | "output-available"): UIMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    parts: [
      {
        type: "tool-bash",
        toolCallId: "call-1",
        state,
        input: { command: "sed -i s/a/b/ notes.md" },
        ...(state === "output-available" ? { output: "ok" } : {}),
      } as never,
    ],
  };
}

function renderTurn(message: UIMessage) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <LangyToolActivity message={message} />
    </ChakraProvider>,
  );
}

describe("a turn's activity cards", () => {
  describe("given a group whose calls have all settled", () => {
    describe("when the turn renders", () => {
      it("draws it in the completed receipt", () => {
        renderTurn(turn("output-available"));

        expect(
          screen.getByRole("button", { name: /1 action completed/i }),
        ).toBeTruthy();
      });

      it("never draws it as a running card of its own", () => {
        const { container } = renderTurn(turn("output-available"));

        // The running card is the only thing that speaks in the present tense.
        expect(container.textContent).not.toContain("Running a command…");
        expect(container.textContent).toContain("Ran a command");
      });
    });
  });

  describe("given a group with a call still in flight", () => {
    describe("when the turn renders", () => {
      it("draws the in-progress card, with no receipt and no collapse", () => {
        const { container } = renderTurn(turn("input-available"));

        expect(container.textContent).toContain("Running a command…");
        expect(screen.queryByText(/action completed/i)).toBeNull();
        // A step that is still running has nothing to summarise, so it offers
        // no expand/collapse affordance at all.
        expect(container.querySelector("[aria-expanded]")).toBeNull();
      });
    });
  });
});
