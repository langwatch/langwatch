/**
 * A turn reads in the order it happened: prose, the calls between it, and the cards those calls
 * raised, each where the call ran rather than piled under the reply.
 * @vitest-environment jsdom
 * Spec: specs/langy/langy-capability-cards.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { UIMessage } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/browser-host/use-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("../../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "p_demo", slug: "demo" },
  }),
}));

vi.mock("../../../../../ui/sections/derived-cards/langy-code-access-card.tsx", () => ({
  LangyCodeAccessCard: ({ callId }: { callId: string }) => (
    <div data-testid="code-access-card">{callId}</div>
  ),
}));

vi.mock("../../../../../behavior/langy-api.ts", () => ({
  api: { useUtils: () => ({}), publicEnv: { useQuery: () => ({ data: {} }) } },
}));

import { MessageContent } from "../message-content.tsx";

afterEach(cleanup);

const FIRST = "Looking at the failures on the checkout agent.";
const SECOND = "They are all provider timeouts.";
const CLOSING = "That is the whole path. Enjoy the tests.";

function toolPart(command: string, id: string) {
  return {
    type: "tool-bash",
    toolCallId: id,
    state: "output-available",
    input: { command },
    output: "ok",
  };
}

function questionPart(id: string) {
  return {
    type: "tool-question",
    toolCallId: id,
    state: "output-available",
    input: {
      questions: [
        {
          question: "Can I create and run it for you?",
          options: [{ label: "Sure, go ahead!" }, { label: "Chat about this" }],
        },
      ],
    },
    output: "answered",
  };
}

function assistantMessage(parts: UIMessage["parts"]): UIMessage {
  return { id: "m-assistant", role: "assistant", parts };
}

function renderMessage(message: UIMessage, isStreaming = false) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <MessageContent
        message={message}
        conversationId="conv-1"
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

/** The deepest element holding this text; the live turn splits prose across spans. */
function blockHolding(text: string): Element {
  const holders = [...document.querySelectorAll("*")].filter((node) =>
    node.textContent?.includes(text),
  );
  const deepest = holders.at(-1);
  if (!deepest) throw new Error(`nothing on screen holds: ${text}`);
  return deepest;
}

/** Document order, read off the DOM rather than off the parts passed in. */
function inOrder(...nodes: Element[]): boolean {
  return nodes.every(
    (node, index) =>
      index === 0 ||
      Boolean(nodes[index - 1]!.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING),
  );
}

describe("given a turn that wrote, ran a call, and wrote again", () => {
  const parts = [
    { type: "text" as const, text: FIRST },
    toolPart("langwatch trace search", "c1"),
    { type: "text" as const, text: SECOND },
  ] as UIMessage["parts"];

  /** @scenario "A tool card sits between the paragraphs it ran between" */
  it("draws the card between the two paragraphs, as two blocks", () => {
    renderMessage(assistantMessage(parts));

    const paragraph = screen.getByText(FIRST);
    expect(
      inOrder(paragraph, screen.getByLabelText("Langy activity"), screen.getByText(SECOND)),
    ).toBe(true);
    expect(paragraph.textContent).not.toContain(SECOND);
  });

  /** @scenario "A turn is read in the order it was watched in" */
  it("keeps that order once the turn settles", () => {
    const { unmount } = renderMessage(assistantMessage(parts), true);
    expect(
      inOrder(blockHolding(FIRST), screen.getByLabelText("Langy activity"), blockHolding(SECOND)),
    ).toBe(true);
    unmount();

    renderMessage(assistantMessage(parts), false);
    expect(
      inOrder(blockHolding(FIRST), screen.getByLabelText("Langy activity"), blockHolding(SECOND)),
    ).toBe(true);
  });
});

describe("given a turn that raised a card with a call and then wrote on", () => {
  /** @scenario "A card raised by a call sits where the call ran" */
  it("draws the question card before the paragraph written after it", () => {
    renderMessage(
      assistantMessage([
        { type: "text", text: FIRST },
        questionPart("q1"),
        { type: "text", text: CLOSING },
      ] as UIMessage["parts"]),
    );

    expect(
      inOrder(
        screen.getByText(FIRST),
        screen.getByText("Sure, go ahead!"),
        screen.getByText(CLOSING),
      ),
    ).toBe(true);
  });

  /** @scenario "A card raised by a call sits where the call ran" */
  it("draws the code access card above the line that points at it", () => {
    const line = "I'm waiting for you to say how I should reach your code, on the card above.";
    renderMessage(
      assistantMessage([
        {
          type: "tool-code_access",
          toolCallId: "call-code",
          state: "output-available",
          input: { reason: "wire tracing in", offer_describe: true },
          output: "The code access card is shown to the user.",
        },
        { type: "text", text: line },
      ] as UIMessage["parts"]),
    );

    expect(inOrder(screen.getByTestId("code-access-card"), screen.getByText(line))).toBe(true);
  });

  /** @scenario "A card raised by a call sits where the call ran" */
  it("draws the progress card after the call that committed, not under the closing line", () => {
    renderMessage(
      assistantMessage([
        { type: "text", text: FIRST },
        toolPart("git add -A && git commit -m 'Add tracing'", "c1"),
        { type: "text", text: SECOND },
        toolPart("langwatch scenario run", "c2"),
        { type: "text", text: CLOSING },
      ] as UIMessage["parts"]),
    );

    expect(
      inOrder(
        screen.getByText(FIRST),
        screen.getByText("Commit"),
        screen.getByText(SECOND),
        screen.getByText(CLOSING),
      ),
    ).toBe(true);
  });
});

describe("given a turn that ran two calls with no prose between them", () => {
  it("keeps them in one activity block", () => {
    renderMessage(
      assistantMessage([
        toolPart("langwatch trace search", "c1"),
        toolPart("langwatch trace get", "c2"),
        { type: "text", text: SECOND },
      ] as UIMessage["parts"]),
    );

    expect(screen.getAllByLabelText("Langy activity")).toHaveLength(1);
    expect(inOrder(screen.getByLabelText("Langy activity"), screen.getByText(SECOND))).toBe(true);
  });
});
