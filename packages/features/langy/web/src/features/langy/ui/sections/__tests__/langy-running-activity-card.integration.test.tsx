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
 * by the receipt, and only by the receipt — with ONE deliberate exception. While
 * the turn is still streaming, the action that finished LAST holds its ground as
 * a settled card of its own until something takes its place (the next call, the
 * answer's text, or the turn ending). Folding it the instant its output landed
 * meant the card the reader was looking at vanished into the accordion in a
 * blink while the model went back to thinking.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { UIMessage } from "ai";
import { afterEach, describe, expect, it } from "vitest";

import { LangyToolActivity } from "../langy-tool-activity";
import { useLangyStore } from "../../../../../index";

function turnFromParts(parts: unknown[]): UIMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    parts: parts as never[],
  };
}

function bashPart({
  id,
  command,
  state,
}: {
  id: string;
  command: string;
  state: "input-available" | "output-available";
}) {
  return {
    type: "tool-bash",
    toolCallId: id,
    state,
    input: { command },
    ...(state === "output-available" ? { output: "ok" } : {}),
  };
}

function turn(state: "input-available" | "output-available"): UIMessage {
  return turnFromParts([bashPart({ id: "call-1", command: "sed -i s/a/b/ notes.md", state })]);
}

function renderTurn(message: UIMessage, { live = true }: { live?: boolean } = {}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <LangyToolActivity message={message} live={live} />
    </ChakraProvider>,
  );
}

describe("a turn's activity cards", () => {
  afterEach(() => {
    cleanup();
    useLangyStore.setState({ turnPhase: "idle" });
  });

  describe("given a group whose calls have all settled", () => {
    describe("when the turn renders", () => {
      it("draws it in the completed receipt", () => {
        renderTurn(turn("output-available"));

        expect(screen.getByRole("button", { name: /1 action completed/i })).toBeTruthy();
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

  describe("given the turn is still streaming", () => {
    /** @scenario The action that just finished stays on the table while the model thinks */
    it("keeps the action that just finished as its own card instead of a receipt", () => {
      useLangyStore.setState({ turnPhase: "active" });
      const { container } = renderTurn(turn("output-available"));

      expect(container.textContent).toContain("Ran a command");
      expect(screen.queryByRole("button", { name: /action completed/i })).toBeNull();
    });

    describe("when the reader opens the held card", () => {
      /** @scenario The action that just finished can be opened to show what it returned */
      it("shows what the finished call returned", () => {
        useLangyStore.setState({ turnPhase: "active" });
        renderTurn(
          turnFromParts([
            {
              type: "tool-bash",
              toolCallId: "call-1",
              state: "output-available",
              input: { command: "cat notes.md" },
              output: "three findings, all in notes.md",
            },
          ]),
        );

        const disclosure = screen.getByRole("button", { expanded: false });
        fireEvent.click(disclosure);

        expect(screen.getByText("three findings, all in notes.md")).toBeTruthy();
      });

      /** @scenario An opened result names the command that produced it */
      it("names the command under which each result came back", () => {
        useLangyStore.setState({ turnPhase: "active" });
        renderTurn(
          turnFromParts([
            {
              type: "tool-langwatch.trace.search",
              toolCallId: "call-1",
              state: "output-available",
              input: { command: 'langwatch trace search --limit "5"' },
              output: JSON.stringify({ kind: "json", payload: { count: 5 } }),
            },
          ]),
        );

        fireEvent.click(screen.getByRole("button", { expanded: false }));

        expect(screen.getByText('$ langwatch trace search --limit "5"')).toBeTruthy();
      });

      it("offers no disclosure when the call recorded no result", () => {
        useLangyStore.setState({ turnPhase: "active" });
        const { container } = renderTurn(
          turnFromParts([
            {
              type: "tool-bash",
              toolCallId: "call-1",
              state: "output-available",
              input: { command: "cat notes.md" },
              output: "",
            },
          ]),
        );

        expect(container.querySelector("[aria-expanded]")).toBeNull();
      });
    });

    describe("when the next tool call starts", () => {
      it("folds the finished action into the receipt beside the running card", () => {
        useLangyStore.setState({ turnPhase: "active" });
        const { container } = renderTurn(
          turnFromParts([
            bashPart({
              id: "call-1",
              command: "sed -i s/a/b/ notes.md",
              state: "output-available",
            }),
            {
              type: "tool-grep",
              toolCallId: "call-2",
              state: "input-available",
              input: { pattern: "other" },
            },
          ]),
        );

        expect(screen.getByRole("button", { name: /1 action completed/i })).toBeTruthy();
        expect(container.textContent).toContain("Searching the code…");
      });
    });

    describe("when answer text streams in after the finished action", () => {
      it("folds the finished action into the receipt", () => {
        useLangyStore.setState({ turnPhase: "active" });
        renderTurn(
          turnFromParts([
            bashPart({
              id: "call-1",
              command: "sed -i s/a/b/ notes.md",
              state: "output-available",
            }),
            { type: "text", text: "Here is what I found." },
          ]),
        );

        expect(screen.getByRole("button", { name: /1 action completed/i })).toBeTruthy();
      });
    });
  });

  describe("given the turn has settled", () => {
    it("folds every action into the receipt, the last one included", () => {
      renderTurn(turn("output-available"));

      expect(screen.getByRole("button", { name: /1 action completed/i })).toBeTruthy();
    });

    describe("when a call was still open at the end", () => {
      /** @scenario A call left open by a stopped turn reads as interrupted */
      it("draws it as interrupted rather than as still running", () => {
        const { container } = renderTurn(turn("input-available"), {
          live: false,
        });

        expect(container.textContent).toContain("Running a command");
        expect(container.textContent).not.toContain("Running a command…");
        expect(container.textContent).toContain("Interrupted before it finished");
      });
    });
  });
});
