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

// The choices card reads the public env over tRPC; this suite covers where
// the card sits, not what it loads.
vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({}),
    publicEnv: { useQuery: () => ({ data: {} }) },
  },
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

describe("given a turn that raised a card with a call and then wrote on", () => {
  const CLOSING = "That is the whole path. Enjoy the tests.";

  function questionPart(id: string) {
    return {
      type: "tool-question",
      toolCallId: id,
      state: "output-available",
      input: {
        questions: [
          {
            question: "Can I create and run it for you?",
            options: [
              { label: "Sure, go ahead!" },
              { label: "Chat about this" },
            ],
          },
        ],
      },
      output: "answered",
    };
  }

  /** @scenario "A card raised by a call sits where the call ran" */
  it("draws the question card before the paragraph written after it", () => {
    renderMessage(
      assistantMessage([
        { type: "text", text: FIRST },
        questionPart("q1"),
        { type: "text", text: CLOSING },
      ]),
    );

    expect(
      orderOf(
        screen.getByText(FIRST),
        screen.getByText("Sure, go ahead!"),
        screen.getByText(CLOSING),
      ),
    ).toBe(true);
  });

  /** @scenario "A card raised by a call sits where the call ran" */
  it("draws the progress card after the call that moved the flow, not under the closing line", () => {
    renderMessage(
      assistantMessage([
        { type: "text", text: FIRST },
        toolPart("git add -A && git commit -m 'Add tracing'", "c1"),
        { type: "text", text: SECOND },
        toolPart("langwatch scenario run", "c2"),
        { type: "text", text: CLOSING },
      ]),
    );

    expect(
      orderOf(
        screen.getByText(FIRST),
        screen.getByText("Commit"),
        screen.getByText(SECOND),
        screen.getByText(CLOSING),
      ),
    ).toBe(true);
  });

  /** @scenario "The pull request card closes the path" */
  it("draws the guided pull request card after the closing line once the path is done", () => {
    render(
      <ChakraProvider value={defaultSystem}>
        <MessageContent
          message={assistantMessage([
            toolPart("langwatch test-suite run suite_1 --wait", "c1"),
            { type: "text", text: CLOSING },
            toolPart("langwatch onboarding complete-path llmops", "c2"),
          ])}
          appliedOutcomes={{}}
          discardedProposals={new Set()}
          applyingProposals={new Set()}
          onApply={async () => {}}
          onDiscard={() => {}}
          hideGithubProgress
          guidedPullRequest={{
            url: "https://github.com/acme/checkout/pull/12",
            title: "Add LangWatch tracing and the connect endpoint",
            branch: "langy/tracing",
          }}
        />
      </ChakraProvider>,
    );

    const card = screen.getByLabelText("Guided path pull request");
    expect(orderOf(screen.getByText(CLOSING), card)).toBe(true);
    expect(card.textContent).toContain(
      "Add LangWatch tracing and the connect endpoint",
    );
    expect(card.textContent).toContain("langy/tracing");
    expect(
      screen.getByText("Open pull request").closest("a")?.getAttribute("href"),
    ).toBe("https://github.com/acme/checkout/pull/12");
  });

  it("keeps the guided pull request card off a reply that did not close the path", () => {
    render(
      <ChakraProvider value={defaultSystem}>
        <MessageContent
          message={assistantMessage([
            toolPart("langwatch scenario run s_1 --wait", "c1"),
            { type: "text", text: SECOND },
          ])}
          appliedOutcomes={{}}
          discardedProposals={new Set()}
          applyingProposals={new Set()}
          onApply={async () => {}}
          onDiscard={() => {}}
          guidedPullRequest={{ branch: "langy/tracing" }}
        />
      </ChakraProvider>,
    );

    expect(screen.queryByLabelText("Guided path branch")).toBeNull();
  });

  /** @scenario "A guided conversation shows no progress card" */
  it("leaves the progress card out when the caller hides it", () => {
    render(
      <ChakraProvider value={defaultSystem}>
        <MessageContent
          message={assistantMessage([
            toolPart("git commit -m 'Add tracing'", "c1"),
            { type: "text", text: CLOSING },
          ])}
          appliedOutcomes={{}}
          discardedProposals={new Set()}
          applyingProposals={new Set()}
          onApply={async () => {}}
          onDiscard={() => {}}
          hideGithubProgress
        />
      </ChakraProvider>,
    );

    expect(screen.queryByText("Commit")).toBeNull();
    expect(screen.getByText(CLOSING)).toBeDefined();
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
