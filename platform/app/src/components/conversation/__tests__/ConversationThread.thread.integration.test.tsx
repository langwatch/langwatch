/**
 * @vitest-environment jsdom
 *
 * What the thread does around its messages: the trace each turn offers, and
 * which box it scrolls.
 *
 * What a single message DRAWS is
 * `ConversationThread.parts.integration.test.tsx`.
 *
 * Spec: specs/prompts/playground-conversation.feature
 * Spec: specs/prompts/undefined-variable-banner-stability.feature
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
  traceGone,
  traceLanded,
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

describe("given a conversation thread", () => {
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

  describe("given a turn whose trace has landed", () => {
    beforeEach(() => {
      tracesGetByIdQuery.mockReturnValue(traceLanded());
    });

    /** @scenario Each completed turn offers its trace */
    it("separates the turn with a labelled separator that opens the trace", async () => {
      renderConversation([
        {
          id: "m1",
          role: "assistant",
          content: "done",
          trace_id: "trace-1",
        },
      ]);

      expect(screen.getByText("Turn 1")).toBeInTheDocument();

      const separator = screen.getByRole("button", {
        name: "View trace for turn 1",
      });
      await userEvent.click(separator);

      expect(openTraceDetailsDrawer).toHaveBeenCalledWith({
        traceId: "trace-1",
      });
    });
  });

  describe("given a turn whose trace has not landed yet", () => {
    /** @scenario A turn whose trace has not landed yet offers no trace affordance */
    it("leaves the separator a plain rule", () => {
      renderConversation([
        {
          id: "m1",
          role: "assistant",
          content: "done",
          trace_id: "trace-1",
        },
      ]);

      expect(screen.getByText("Turn 1")).toBeInTheDocument();
      // Advertising a trace that 404s is worse than waiting a beat for one
      // that opens, so nothing is offered until the trace is really there.
      expect(screen.queryByRole("button", { name: /View trace/ })).toBeNull();
      expect(screen.queryByText("View trace")).toBeNull();
    });
  });

  describe("given the thread is rendered beside other scrolling content", () => {
    it("scrolls its own box rather than every ancestor", () => {
      // jsdom implements neither, so both are observed rather than measured.
      // Spied rather than assigned: assigning left the stub on the shared
      // prototype for every describe after this one, and `clearAllMocks`
      // clears calls without removing the patch.
      const scrollTo = vi
        .spyOn(Element.prototype, "scrollTo")
        .mockImplementation(() => undefined);

      renderConversation([{ id: "m1", role: "user", content: "hello" }]);

      // `scrollIntoView` walks up and scrolls EVERY ancestor scroll container
      // it finds. The playground puts this thread beside the prompt editor, so
      // the thread re-mounting on a tab change dragged the editor to the top
      // and back down again. Scrolling its own box cannot reach a sibling.
      expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
      expect(scrollTo).toHaveBeenCalled();

      scrollTo.mockRestore();
    });
  });

  describe("given a conversation whose trace no longer exists", () => {
    beforeEach(() => {
      tracesGetByIdQuery.mockReturnValue(traceGone());
    });

    /** @scenario A prompt with a running conversation re-opens without crashing */
    it("renders the conversation instead of throwing to the error boundary", () => {
      // Re-opening a prompt tab replays its stored conversation, and an
      // assistant turn in it can name a trace that expired or was never
      // written. The affordance degrades; the transcript still renders.
      expect(() =>
        renderConversation([
          { id: "m1", role: "user", content: "hello" },
          {
            id: "m2",
            role: "assistant",
            content: "hi there",
            trace_id: "trace-gone",
          },
        ]),
      ).not.toThrow();

      expect(screen.getByText("hello")).toBeInTheDocument();
      expect(screen.getByText("hi there")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /View trace/ })).toBeNull();
    });
  });
});
