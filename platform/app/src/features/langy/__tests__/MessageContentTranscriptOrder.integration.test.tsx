/**
 * @vitest-environment jsdom
 *
 * A turn reads in the order it happened. The panel used to render two piles
 * keyed by kind — every tool card, then the whole reply joined underneath — so
 * a reader watching a live turn saw the cards change at the top while the text
 * grew at the bottom, with nothing saying which paragraph followed which call.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { UIMessage } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "p_demo", slug: "demo" },
  }),
}));

import { MessageContent } from "../components/MessageContent";

afterEach(cleanup);

const FIRST = "Looking at the failures on the checkout agent.";
const SECOND = "They are all provider timeouts.";

function toolPart(command: string, id: string) {
  return {
    type: "tool-bash",
    toolCallId: id,
    state: "output-available",
    input: { command },
    output: "ok",
  };
}

function assistantMessage(parts: unknown[]): UIMessage {
  return {
    id: "m-assistant",
    role: "assistant",
    parts,
  } as unknown as UIMessage;
}

function renderMessage(message: UIMessage, isStreaming = false) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <MessageContent
        message={message}
        appliedOutcomes={{}}
        discardedProposals={new Set()}
        applyingProposals={new Set()}
        onApply={async () => {}}
        onDiscard={() => {}}
        isStreaming={isStreaming}
      />
    </ChakraProvider>,
  );
}

/**
 * The deepest element holding this text. The live turn reveals its prose word
 * by word, so the string is split across spans and no single element "has" it
 * in the testing-library sense; their nearest common ancestor is what sits in
 * the transcript either way.
 */
function blockHolding(text: string): Element {
  const holders = [...document.querySelectorAll("*")].filter((node) =>
    node.textContent?.includes(text),
  );
  const deepest = holders.at(-1);
  if (!deepest) throw new Error(`nothing on screen holds: ${text}`);
  return deepest;
}

/** Document order, read off the DOM rather than off the parts we passed in. */
function orderOf(...nodes: Array<Element | null>): boolean {
  for (let index = 0; index < nodes.length - 1; index += 1) {
    const left = nodes[index];
    const right = nodes[index + 1];
    if (!left || !right) return false;
    const relation = left.compareDocumentPosition(right);
    if (!(relation & Node.DOCUMENT_POSITION_FOLLOWING)) return false;
  }
  return true;
}

describe("given a turn that wrote, ran a call, and wrote again", () => {
  /** @scenario "A tool card sits between the paragraphs it ran between" */
  it("draws the card between the two paragraphs", () => {
    renderMessage(
      assistantMessage([
        { type: "text", text: FIRST },
        toolPart("langwatch trace search", "c1"),
        { type: "text", text: SECOND },
      ]),
    );

    expect(
      orderOf(
        screen.getByText(FIRST),
        screen.getByLabelText("Langy activity"),
        screen.getByText(SECOND),
      ),
    ).toBe(true);
  });

  /** @scenario "A tool card sits between the paragraphs it ran between" */
  it("does not collect the reply into one block under the cards", () => {
    renderMessage(
      assistantMessage([
        { type: "text", text: FIRST },
        toolPart("langwatch trace search", "c1"),
        { type: "text", text: SECOND },
      ]),
    );

    // Two paragraphs written either side of a call are two blocks, not one
    // body: joined, the reader cannot tell which of them the call produced.
    const paragraph = screen.getByText(FIRST);
    expect(paragraph.textContent).not.toContain(SECOND);
  });

  /** @scenario "A turn is read in the order it was watched in" */
  it("keeps that order once the turn settles", () => {
    const parts = [
      { type: "text", text: FIRST },
      toolPart("langwatch trace search", "c1"),
      { type: "text", text: SECOND },
    ];
    const { unmount } = renderMessage(assistantMessage(parts), true);
    expect(
      orderOf(
        blockHolding(FIRST),
        screen.getByLabelText("Langy activity"),
        blockHolding(SECOND),
      ),
    ).toBe(true);
    unmount();

    renderMessage(assistantMessage(parts), false);
    expect(
      orderOf(
        blockHolding(FIRST),
        screen.getByLabelText("Langy activity"),
        blockHolding(SECOND),
      ),
    ).toBe(true);
  });
});

describe("given a turn that ran two calls with no prose between them", () => {
  it("keeps them in one activity block rather than splitting the turn", () => {
    renderMessage(
      assistantMessage([
        toolPart("langwatch trace search", "c1"),
        toolPart("langwatch trace get", "c2"),
        { type: "text", text: SECOND },
      ]),
    );

    expect(screen.getAllByLabelText("Langy activity")).toHaveLength(1);
    expect(
      orderOf(
        screen.getByLabelText("Langy activity"),
        screen.getByText(SECOND),
      ),
    ).toBe(true);
  });
});
