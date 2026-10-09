/**
 * @vitest-environment jsdom
 *
 * A line said with the `say` tool is drawn where the call happened.
 *
 * A model that writes its reply once its calls are done puts every line at
 * the end of the turn, under the cards: a guided onboarding turn of 53 calls
 * arrived as 53 cards and one block of prose. The say tool gives each line a
 * place of its own, so the turn reads in the order it was meant to, live and
 * after a reload.
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

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({}),
    publicEnv: { useQuery: () => ({ data: {} }) },
  },
}));

import { MessageContent } from "../components/MessageContent";

afterEach(cleanup);

const FRAMEWORK = "I found a LangGraph agent in app/graph.py.";
const PULL_REQUEST =
  "I opened a pull request with the tracing change: https://example.test/acme/pull/2. You can merge it already.";
const BRANCH =
  "I left branch `langy/llmops` checked out; the agent runs from it.";
const WHY =
  "Before I run it, why a scenario and not a plain test? A scenario is a simulated user talking to your agent turn by turn.";
const RUNNING = "Running it against your agent now.";
const TWO_THINGS =
  "That one run just proved two things: your agent answers scenarios, and traces are flowing in.";
const CLOSING = "All ready! Let me know if there is anything I can help with.";
const CREATE_OPTION =
  'Create "Guest completes checkout" as your first scenario test';

let sequence = 0;
function toolPart(name: string, input: unknown = { command: "ls" }) {
  sequence += 1;
  return {
    type: `tool-${name}`,
    toolCallId: `call_${sequence}`,
    state: "output-available",
    input,
    output: "ok",
  };
}

function sayPart(text: string, state = "output-available") {
  sequence += 1;
  return {
    type: "tool-say",
    toolCallId: `say_${sequence}`,
    state,
    input: { text },
    output: "Said.",
  };
}

function questionPart() {
  sequence += 1;
  return {
    type: "tool-question",
    toolCallId: `question_${sequence}`,
    state: "output-available",
    input: {
      questions: [
        {
          question:
            "Now that your agent is integrated, I think we should write some tests for it. The first one I'd write is Guest completes checkout, because it is the golden path.",
          bare: true,
          options: [
            { label: CREATE_OPTION },
            { label: "Chat about this", quiet: true },
          ],
        },
      ],
    },
    output: "answered",
  };
}

function calls(count: number): unknown[] {
  return Array.from({ length: count }, (_, index) =>
    toolPart(index % 3 === 0 ? "bash" : "local_bash"),
  );
}

/**
 * The turn as the take recorded it: 53 tool parts, the proposal question
 * among them, then one text part. With the say tool, the lines the skill
 * asks for ride between the calls as say parts, and the text at the end is
 * empty.
 */
function guidedTurn(): unknown[] {
  sequence = 0;
  return [
    ...calls(30),
    sayPart(FRAMEWORK),
    sayPart(PULL_REQUEST),
    sayPart(BRANCH),
    questionPart(),
    ...calls(3),
    sayPart(WHY),
    sayPart(RUNNING),
    ...calls(4),
    sayPart(TWO_THINGS),
    ...calls(15),
    sayPart(CLOSING),
    { type: "text", text: "", role: "assistant" },
  ];
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

/** Document order, read off the DOM. */
function inOrder(...nodes: Array<Element | null>): boolean {
  for (let index = 0; index < nodes.length - 1; index += 1) {
    const left = nodes[index];
    const right = nodes[index + 1];
    if (!left || !right) return false;
    if (
      !(left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING)
    )
      return false;
  }
  return true;
}

/**
 * The prose element holding a said line: one child of a said block per line.
 * Markdown splits a line across elements (a link, a code span), so the match
 * is on the element's whole text, with the backticks of a code span dropped
 * as the renderer drops them.
 */
function said(text: string): Element {
  const plain = text.replaceAll("`", "");
  const blocks = [...document.querySelectorAll("[data-langy-say] > *")].filter(
    (block) => block.textContent?.includes(plain),
  );
  const block = blocks[0];
  if (!block) throw new Error(`not drawn as a said line: ${text}`);
  return block;
}

describe("given a guided turn whose lines were said with the say tool", () => {
  /** @scenario "A line said with the say tool is drawn where the call happened" */
  it("draws each line as prose where it was said, between the cards", () => {
    renderMessage(assistantMessage(guidedTurn()));

    // The blocks of cards: the run holding the question draws its card, not
    // rows, so only the runs with rows count here.
    const activity = screen
      .getAllByLabelText("Langy activity")
      .filter((block) => (block.textContent ?? "").trim() !== "");
    expect(activity.length).toBe(4);
    const proposal = screen.getByRole("button", { name: CREATE_OPTION });

    // The step 2 lines sit after the first block of cards and above the
    // proposal card; why and running sit before the run's cards; the closing
    // line is the last thing on screen, after the last block of cards.
    expect(
      inOrder(
        activity[0]!,
        said(FRAMEWORK),
        said(PULL_REQUEST),
        said(BRANCH),
        proposal,
        activity[1]!,
        said(WHY),
        said(RUNNING),
        activity[2]!,
        said(TWO_THINGS),
        activity[3]!,
        said(CLOSING),
      ),
    ).toBe(true);
    expect(inOrder(activity.at(-1)!, said(CLOSING))).toBe(true);
  });

  /** @scenario "A line said with the say tool is drawn where the call happened" */
  it("never lists a said line in the tool activity, and never as a card", () => {
    renderMessage(assistantMessage(guidedTurn()));

    for (const block of screen.getAllByLabelText("Langy activity")) {
      expect(block.textContent).not.toContain("Say");
      expect(block.textContent).not.toContain(CLOSING);
      expect(block.textContent).not.toContain(FRAMEWORK);
    }
    expect(screen.queryByText("Said.")).toBeNull();
    // Prose, not a framed card: the said line has no card chrome of its own.
    expect(said(CLOSING).closest("[data-derived-by-langy]")).toBeNull();
    // Markdown, as the reply's own prose is.
    expect(said(BRANCH).querySelector("code")?.textContent).toBe(
      "langy/llmops",
    );
  });

  /** @scenario "A line said with the say tool is drawn where the call happened" */
  it("draws the lines live as they are said, and the same way once the turn settles", () => {
    const parts = guidedTurn();
    const { unmount } = renderMessage(assistantMessage(parts), true);
    expect(
      inOrder(
        said(FRAMEWORK),
        screen.getByRole("button", { name: CREATE_OPTION }),
        said(CLOSING),
      ),
    ).toBe(true);
    unmount();

    renderMessage(assistantMessage(parts), false);
    expect(
      inOrder(
        said(FRAMEWORK),
        screen.getByRole("button", { name: CREATE_OPTION }),
        said(CLOSING),
      ),
    ).toBe(true);
  });

  /** @scenario "A line said with the say tool is drawn where the call happened" */
  it("draws nothing for a say call whose input is still streaming", () => {
    sequence = 0;
    renderMessage(
      assistantMessage([
        toolPart("bash"),
        sayPart("Half a", "input-streaming"),
      ]),
      true,
    );

    expect(document.querySelector("[data-langy-say]")).toBeNull();
  });
});

describe("given the same turn with every line written at the end instead", () => {
  it("draws the cards first and the reply under them, as the record says", () => {
    sequence = 0;
    renderMessage(
      assistantMessage([
        ...calls(30),
        questionPart(),
        ...calls(22),
        {
          type: "text",
          text: `${FRAMEWORK}\n\n${PULL_REQUEST}\n\n${CLOSING}`,
          role: "assistant",
        },
      ]),
    );

    const activity = screen.getAllByLabelText("Langy activity");
    const reply = [...document.querySelectorAll("*")]
      .filter((node) => node.textContent?.includes(CLOSING))
      .at(-1)!;
    expect(inOrder(activity.at(-1)!, reply)).toBe(true);
    expect(document.querySelector("[data-langy-say]")).toBeNull();
  });
});
