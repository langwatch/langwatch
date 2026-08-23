/**
 * @vitest-environment jsdom
 *
 * What the shared conversation renderer draws for one message.
 *
 * `flattenMessages.unit.test.ts` covers the flattening — which wire shapes
 * become which parts. This covers the half after it: given those parts, what
 * a reader sees. Together they are the path the playground runs, which is
 * `flattenMessages` then `ConversationThread` and nothing in between, so the
 * fixtures start from raw messages rather than hand-built parts.
 *
 * These are the behaviours CopilotKit dropped: it rendered text and only text,
 * so a tool call, a reasoning block and an attachment all vanished from the
 * playground even though the trace held them.
 *
 * The thread AROUND the messages — traces, scrolling — is
 * `ConversationThread.thread.integration.test.tsx`.
 *
 * Spec: specs/prompts/playground-conversation.feature
 */
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  renderConversation,
  traceNotYetLanded,
} from "./conversationThreadHarness";

const openTraceDetailsDrawer = vi.hoisted(() => vi.fn());
const tracesGetByIdQuery = vi.hoisted(() => vi.fn());

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "proj-1" } }),
}));

vi.mock("~/hooks/useTraceDetailsDrawer", () => ({
  useTraceDetailsDrawer: () => ({ openTraceDetailsDrawer }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    traces: {
      getById: {
        useQuery: (...args: unknown[]) => tracesGetByIdQuery(...args),
      },
    },
    // MediaPart's existence probe. Disabled unless a player errors first, but
    // the hook is still read on every render, so it has to exist.
    storedObjects: {
      headById: { useQuery: () => ({ data: undefined, isError: false }) },
    },
  },
}));

// The hover preview fetches a trace of its own; the affordance under test is
// the separator it wraps.
vi.mock("~/features/traces-v2/components/TraceIdPeek", () => ({
  TracePreviewHoverCard: ({ children }: { children: ReactNode }) => children,
}));

describe("given a message rendered in the conversation", () => {
  // The thread scrolls the newest part into view on every render; jsdom has no
  // implementation of it.
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    tracesGetByIdQuery.mockReturnValue(traceNotYetLanded());
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
      renderConversation(twoCalls);

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
      renderConversation(callAndResult);

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
      renderConversation([
        ...failedCall,
        { id: "m3", role: "assistant", content: "I could not read the file." },
      ]);

      expect(screen.getByText("error")).toBeInTheDocument();
      // The failure belongs to the card, not the conversation: the reply after
      // it still reads as an ordinary assistant turn.
      expect(
        screen.getByText("I could not read the file."),
      ).toBeInTheDocument();
      expect(screen.getAllByText("error")).toHaveLength(1);
    });
  });

  describe("given an assistant message carrying reasoning", () => {
    /** @scenario Assistant reasoning is shown above the reply */
    it("shows the reasoning as its own block above the reply text", async () => {
      renderConversation([
        {
          id: "m1",
          role: "assistant",
          content: "42",
          reasoning_content: "Six times seven.",
        },
      ]);

      const reasoning = screen.getByText("Reasoned");
      const reply = screen.getByText("42");

      // Above, not merely present: the reasoning has to precede the reply in
      // document order or it reads as an afterthought rather than the working.
      expect(
        reasoning.compareDocumentPosition(reply) &
          Node.DOCUMENT_POSITION_FOLLOWING,
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
      const { container } = renderConversation([
        { id: "m1", role: "user", content: "please **summarise** this" },
      ]);

      expect(container.querySelector("strong")).toHaveTextContent("summarise");
      expect(container.textContent).not.toContain("**summarise**");
    });
  });

  describe("given a loaded message carrying an audio attachment", () => {
    /** @scenario An attachment in a loaded message is rendered */
    it("renders a media part for the attachment", () => {
      renderConversation([
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
      ]);

      expect(screen.getByTestId("media-part-audio")).toBeInTheDocument();
    });
  });

  describe("given a prompt declaring more than one output field", () => {
    const reply = '{"answer":"yes","confidence":0.9}';

    /** @scenario Structured output is shown as a tree once streaming finishes */
    it("renders the finished reply as a structured value rather than raw text", () => {
      const { container } = renderConversation(
        [{ id: "m1", role: "assistant", content: reply }],
        { structuredOutput: true },
      );

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

      const { container } = renderConversation([
        { id: "m1", role: "assistant", content: prose },
      ]);

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
      renderConversation(exchange, {
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
      renderConversation(exchange, { labels: { assistant: "gpt-5-mini" } });

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
      renderConversation(
        [
          { id: "m1", role: "user", content: "hello" },
          { id: "m2", role: "assistant", content: "hi there" },
        ],
        { roleMode: "scenario" },
      );

      expect(screen.getByText("User Simulator")).toBeInTheDocument();
      expect(screen.getByText("Agent")).toBeInTheDocument();
    });
  });
});
