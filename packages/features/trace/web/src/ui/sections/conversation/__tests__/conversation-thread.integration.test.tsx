/**
 * @vitest-environment jsdom
 *
 * What the shared conversation renderer actually draws.
 *
 * `flattenMessages.unit.test.ts` covers the flattening — which wire shapes
 * become which parts. This covers the half after it: given those parts, what
 * a reader sees. Together they are the path the playground runs, which is
 * `flattenMessages` then `ConversationThread` and nothing in between, so the
 * fixtures here start from raw messages rather than hand-built parts wherever
 * the scenario says the conversation was loaded from a trace.
 *
 * These are the behaviours CopilotKit dropped: it rendered text and only text,
 * so a tool call, a reasoning block and an attachment all vanished from the
 * playground even though the trace held them.
 *
 * Spec: specs/prompts/playground-conversation.feature
 * Spec: specs/prompts/undefined-variable-banner-stability.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationThread } from "../conversation-thread.tsx";
import { type FlattenableMessage, flattenMessages } from "../flatten-messages.ts";

const message = (msg: Record<string, unknown>) => msg as FlattenableMessage;

/**
 * The playground's own configuration, so these tests answer for the surface
 * the spec is about: `PromptPlaygroundChat` renders `ConversationThread` with
 * `shouldRenderStructuredOutput` on, the default `regular` variant (turn separators on)
 * and the default shouldAutoScroll, and adds nothing else.
 */
function renderConversation({
  messages,
  shouldRenderStructuredOutput = true,
  labels,
  roleMode = "chat",
}: {
  messages: Record<string, unknown>[];
  shouldRenderStructuredOutput?: boolean;
  labels?: { user?: string; assistant?: string };
  roleMode?: "chat" | "scenario";
}): ReturnType<typeof render> {
  const ui: ReactElement = (
    <ConversationThread
      parts={flattenMessages({ messages: messages.map(message) })}
      projectId="proj-1"
      shouldRenderStructuredOutput={shouldRenderStructuredOutput}
      labels={labels}
      roleMode={roleMode}
      // The host draws the media and the turn separator. Both reach a project's
      // stored objects and its traces, which this package does not own, so the
      // thread is exercised through the ports it actually offers.
      renderMediaPart={({ part }) => <div data-testid={`media-part-${part.type}`} />}
      renderTurnSeparator={({ index, traceId }) => (
        <div data-testid="turn-separator" data-turn={index} data-trace-id={traceId ?? ""} />
      )}
    />
  );
  return render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);
}

describe("<ConversationThread />", () => {
  // The thread scrolls the newest part into view on every render; jsdom has no
  // implementation of it.
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
    // The thread scrolls its own box as content arrives; jsdom implements
    // neither method, and one test below replaces this stub to observe it.
    Element.prototype.scrollTo = vi.fn() as unknown as Element["scrollTo"];
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => cleanup());

  describe("given a trace whose assistant message made tool calls", () => {
    const twoCalls = [
      {
        id: "m1",
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "call_1",
            function: { name: "search", arguments: '{"q":"weather"}' },
          },
          {
            id: "call_2",
            function: { name: "lookup", arguments: '{"city":"Berlin"}' },
          },
        ],
      },
    ];

    /** @scenario Tool calls from a loaded trace appear in the conversation */
    it("shows every call with its name and a summary of its primary argument", () => {
      renderConversation({ messages: twoCalls });

      expect(screen.getByText("search")).toBeInTheDocument();
      expect(screen.getByText("lookup")).toBeInTheDocument();
      // The summary is what makes two calls to the same tool tellable apart
      // without expanding either.
      expect(screen.getByText("weather")).toBeInTheDocument();
      expect(screen.getByText("Berlin")).toBeInTheDocument();
    });
  });

  describe("given a tool call and the result that answers it", () => {
    const callAndResult = [
      {
        id: "m1",
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "call_1",
            function: { name: "search", arguments: '{"q":"weather"}' },
          },
        ],
      },
      {
        id: "m2",
        role: "tool",
        name: "search",
        tool_call_id: "call_1",
        content: "sunny and 21 degrees",
      },
    ];

    /** @scenario A tool call and its result read as one card */
    it("draws one card for the pair, with the result body collapsed", async () => {
      renderConversation({ messages: callAndResult });

      // One card, not a call card followed by an orphan result card.
      expect(screen.getAllByText("search")).toHaveLength(1);
      expect(screen.queryByText(/sunny and 21 degrees/)).toBeNull();

      await userEvent.click(screen.getByRole("button", { name: /search/ }));

      expect(screen.getByText(/sunny and 21 degrees/)).toBeInTheDocument();
    });
  });

  describe("given a tool result flagged as an error", () => {
    const failedCall = [
      {
        id: "m1",
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tu_1",
            name: "read",
            input: { path: "/tmp/missing" },
          },
        ],
      },
      {
        id: "m2",
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tu_1",
            name: "read",
            content: "ENOENT: no such file",
            is_error: true,
          },
        ],
      },
    ];

    /** @scenario A failed tool call is marked as failed */
    it("marks that card as failed and leaves the rest of the thread alone", () => {
      renderConversation({
        messages: [
          ...failedCall,
          {
            id: "m3",
            role: "assistant",
            content: "I could not read the file.",
          },
        ],
      });

      expect(screen.getByText("error")).toBeInTheDocument();
      // The failure belongs to the card, not the conversation: the reply after
      // it still reads as an ordinary assistant turn.
      expect(screen.getByText("I could not read the file.")).toBeInTheDocument();
      expect(screen.getAllByText("error")).toHaveLength(1);
    });
  });

  describe("given an assistant message carrying reasoning", () => {
    /** @scenario Assistant reasoning is shown above the reply */
    it("shows the reasoning as its own block above the reply text", async () => {
      renderConversation({
        messages: [
          {
            id: "m1",
            role: "assistant",
            content: "42",
            reasoning_content: "Six times seven.",
          },
        ],
      });

      const reasoning = screen.getByText("Reasoned");
      const reply = screen.getByText("42");

      // Above, not merely present: the reasoning has to precede the reply in
      // document order or it reads as an afterthought rather than the working.
      expect(
        reasoning.compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();

      // The block is collapsed until asked for — but it is the reasoning the
      // model sent, not a label with nothing behind it.
      await userEvent.click(reasoning);
      expect(screen.getByText("Six times seven.")).toBeInTheDocument();
    });
  });

  describe("given a user message written in markdown", () => {
    /** @scenario A user turn renders markdown */
    it("renders the emphasis as formatting rather than literal asterisks", () => {
      const { container } = renderConversation({
        messages: [{ id: "m1", role: "user", content: "please **summarise** this" }],
      });

      expect(container.querySelector("strong")).toHaveTextContent("summarise");
      expect(container.textContent).not.toContain("**summarise**");
    });
  });

  describe("given a loaded message carrying an audio attachment", () => {
    /** @scenario An attachment in a loaded message is rendered */
    it("renders a media part for the attachment", () => {
      renderConversation({
        messages: [
          {
            id: "m1",
            role: "user",
            content: [
              {
                type: "input_audio",
                input_audio: { data: "AAAA", format: "wav" },
              },
            ],
          },
        ],
      });

      expect(screen.getByTestId("media-part-audio")).toBeInTheDocument();
    });
  });

  describe("given a turn carrying a trace", () => {
    /** @scenario A turn is separated and carries its trace to the host */
    it("hands the host the turn number and the trace it belongs to", () => {
      renderConversation({
        messages: [
          {
            id: "m1",
            role: "assistant",
            content: "done",
            trace_id: "trace-1",
          },
        ],
      });

      const separator = screen.getByTestId("turn-separator");
      expect(separator).toHaveAttribute("data-turn", "1");
      expect(separator).toHaveAttribute("data-trace-id", "trace-1");
    });
  });

  describe("given the thread is rendered beside other scrolling content", () => {
    it("scrolls its own box rather than every ancestor", () => {
      const scrollTo = vi.fn();
      // jsdom implements neither, so both are observed rather than measured.
      Element.prototype.scrollTo = scrollTo as unknown as Element["scrollTo"];

      renderConversation({
        messages: [{ id: "m1", role: "user", content: "hello" }],
      });

      // `scrollIntoView` walks up and scrolls EVERY ancestor scroll container
      // it finds. The playground puts this thread beside the prompt editor, so
      // the thread re-mounting on a tab change dragged the editor to the top
      // and back down again. Scrolling its own box cannot reach a sibling.
      expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
      expect(scrollTo).toHaveBeenCalled();
    });
  });

  describe("given a conversation whose trace no longer exists", () => {
    /** @scenario A prompt with a running conversation re-opens without crashing */
    it("renders the conversation instead of throwing to the error boundary", () => {
      // Re-opening a prompt tab replays its stored conversation, and an
      // assistant turn in it can name a trace that expired or was never
      // written. The affordance degrades; the transcript still renders.
      expect(() =>
        renderConversation({
          messages: [
            { id: "m1", role: "user", content: "hello" },
            {
              id: "m2",
              role: "assistant",
              content: "hi there",
              trace_id: "trace-gone",
            },
          ],
        }),
      ).not.toThrow();

      expect(screen.getByText("hello")).toBeInTheDocument();
      expect(screen.getByText("hi there")).toBeInTheDocument();
    });
  });

  describe("given a prompt declaring more than one output field", () => {
    const reply = '{"answer":"yes","confidence":0.9}';

    /** @scenario Structured output is shown as a tree once streaming finishes */
    it("renders the finished reply as a structured value rather than raw text", () => {
      const { container } = renderConversation({
        messages: [{ id: "m1", role: "assistant", content: reply }],
        shouldRenderStructuredOutput: true,
      });

      // The value tree itself is a lazily-imported viewer that jsdom never
      // resolves, so what is asserted is the branch: a structured reply goes
      // into its own pre-formatted value container and NOT into a chat bubble,
      // and the JSON the model emitted is not shown as a run of prose.
      expect(container.querySelector("pre")).toBeInTheDocument();
      expect(container.querySelector("[data-align]")).toBeNull();
      expect(container.textContent).not.toContain(reply);
    });

    it("leaves an ordinary reply as prose", () => {
      const prose = "Yes, with high confidence.";

      const { container } = renderConversation({
        messages: [{ id: "m1", role: "assistant", content: prose }],
      });

      // The other side of the same branch, on the same surface: a prompt with
      // one output field answers in prose, and prose still reads as a chat
      // bubble even though structured rendering is switched on.
      expect(container.textContent).toContain(prose);
      expect(container.querySelector("[data-align]")).toBeInTheDocument();
      expect(container.querySelector("pre")).toBeNull();
    });
  });

  describe("given the caller names the sides of the conversation", () => {
    const exchange = [
      { id: "m1", role: "user", content: "hello" },
      { id: "m2", role: "assistant", content: "hi there" },
    ];

    /** @scenario Named sides replace the generic message labels */
    it("labels each message with the name of the side that sent it", () => {
      renderConversation({
        messages: exchange,
        labels: { user: "Ada", assistant: "gpt-5-mini" },
      });

      expect(screen.getByText("Ada")).toBeInTheDocument();
      expect(screen.getByText("gpt-5-mini")).toBeInTheDocument();
      // The names replace the generic labels rather than joining them, or the
      // bubble would say who is speaking twice.
      expect(screen.queryByText("User")).toBeNull();
      expect(screen.queryByText("Assistant")).toBeNull();
    });

    /** @scenario An unnamed side keeps its generic label */
    it("leaves a side the caller could not name on its role label", () => {
      // The profile has no name to show yet. A blank chip is worse than the
      // generic word, so the unnamed side keeps what it already had.
      renderConversation({
        messages: exchange,
        labels: { assistant: "gpt-5-mini" },
      });

      expect(screen.getByText("gpt-5-mini")).toBeInTheDocument();
      expect(screen.getByText("User")).toBeInTheDocument();
    });
  });

  describe("given a scenario run rendered through the same thread", () => {
    /** @scenario A simulation transcript keeps its own role labels */
    it("keeps the simulator and the agent under test on their own labels", () => {
      // Simulations name no sides, and must not inherit the playground's
      // naming: their roles are inverted, and "Agent" is the subject of the
      // run rather than a generic assistant.
      renderConversation({
        messages: [
          { id: "m1", role: "user", content: "hello" },
          { id: "m2", role: "assistant", content: "hi there" },
        ],
        roleMode: "scenario",
      });

      expect(screen.getByText("User Simulator")).toBeInTheDocument();
      expect(screen.getByText("Agent")).toBeInTheDocument();
    });
  });
});
