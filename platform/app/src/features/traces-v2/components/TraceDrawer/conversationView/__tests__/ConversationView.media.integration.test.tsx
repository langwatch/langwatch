/**
 * @vitest-environment jsdom
 *
 * Media in the conversation thread: a turn's recordings, images and
 * attachments hang off the message that carried them, split by the same side
 * rule the trace summary strips use. See specs/traces-v2/media-rendering.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const turns: TraceListItem[] = [];

vi.mock("../../../../hooks/useConversationTurns", () => ({
  useConversationTurns: () => ({ data: { items: turns }, isLoading: false }),
}));

vi.mock("../../../../hooks/useConversationAnnotations", () => ({
  useConversationAnnotations: () => ({
    byTrace: new Map(),
    all: [],
    hasAny: false,
    isLoading: false,
  }),
}));

vi.mock("../../../../hooks/useTraceDrawerNavigation", () => ({
  useTraceDrawerNavigation: () => ({ navigateToTrace: vi.fn() }),
}));

vi.mock("../../../../hooks/useConversationTurnEvents", () => ({
  useConversationTurnEvents: (rows: TraceListItem[]) => rows,
}));

vi.mock("../../../../hooks/useTextTranslation", () => ({
  useTextTranslation: ({ texts }: { texts: Record<string, string> }) => ({
    displayTexts: texts,
    isActive: false,
    isLoading: false,
    toggle: () => undefined,
  }),
}));

vi.mock("../../markdownView", () => ({ RenderedMarkdown: () => null }));

vi.mock("../TurnAnnotations", () => ({
  TurnActionRow: () => null,
  TurnAnnotationBadges: () => null,
}));

vi.mock("~/components/Markdown", () => ({
  Markdown: ({ children }: { children: string }) => <span>{children}</span>,
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1" },
    hasPermission: () => false,
  }),
}));

/**
 * The player itself is the simulations MediaPart, covered by its own tests.
 * Here it only has to report which source it was handed, so the test can say
 * which recording landed under which message.
 */
vi.mock("~/components/simulations/MediaPart", () => ({
  MediaPart: ({
    part,
  }: {
    part: { source?: { value?: string }; url?: string };
  }) => <div data-testid="media-part">{part.source?.value ?? part.url}</div>,
}));

import type { TraceMediaRef } from "~/shared/traces/media-refs";
import { NO_TRACE_EVENTS, type TraceListItem } from "../../../../types/trace";
import { ConversationView } from "../ConversationView";

const CALLER_RECORDING = "/api/files/project-1/caller";
const REPLY_RECORDING = "/api/files/project-1/reply";

function turn(over: Partial<TraceListItem> = {}): TraceListItem {
  return {
    traceId: "trace-1",
    timestamp: 1,
    name: "turn",
    serviceName: "svc",
    durationMs: 10,
    totalCost: 0,
    nonBilledCost: 0,
    totalTokens: 0,
    models: [],
    labels: [],
    status: "ok",
    spanCount: 1,
    sizeBytes: 0,
    input: "book me a room",
    output: "your room is booked",
    origin: "application",
    evaluations: [],
    events: NO_TRACE_EVENTS,
    ...over,
  };
}

function audioRef(url: string, role?: TraceMediaRef["role"]): TraceMediaRef {
  return { kind: "audio", url, ...(role ? { role } : {}) };
}

function renderConversation(item: TraceListItem) {
  turns.splice(0, turns.length, item);
  return render(
    <ChakraProvider value={defaultSystem}>
      <ConversationView conversationId="thread-1" currentTraceId="trace-1" />
    </ChakraProvider>,
  );
}

/**
 * The body of one thread message, found by the role label at its top: the
 * label, the prose and the media strip all live in the same content box.
 */
function messageBody(label: string): HTMLElement {
  return screen.getByText(label).parentElement!.parentElement!;
}

const mediaIn = (label: string): string[] =>
  within(messageBody(label))
    .queryAllByTestId("media-part")
    .map((el) => el.textContent ?? "");

afterEach(cleanup);

describe("given a voice turn whose payload holds both recordings", () => {
  /**
   * The reply recording rides along in the turn's input as well as its
   * output: the shape that used to stack two players on the caller's side.
   */
  const voiceTurn = () =>
    turn({
      inputMediaRefs: [
        audioRef(CALLER_RECORDING, "user"),
        audioRef(REPLY_RECORDING, "assistant"),
      ],
      outputMediaRefs: [audioRef(REPLY_RECORDING, "assistant")],
    });

  /** @scenario "A recording the caller sent renders under the user message" */
  it("renders only the caller's recording under the user message", () => {
    renderConversation(voiceTurn());

    expect(mediaIn("User")).toEqual([CALLER_RECORDING]);
  });

  /** @scenario "A recording the agent replied with renders under the assistant message" */
  it("renders only the reply recording under the assistant message", () => {
    renderConversation(voiceTurn());

    expect(mediaIn("Assistant")).toEqual([REPLY_RECORDING]);
  });
});

describe("given a turn whose media was recorded without a role", () => {
  /** @scenario "Media with no role recorded renders on the side it was recorded under" */
  it("keeps each side's media on the side it was recorded under", () => {
    renderConversation(
      turn({
        inputMediaRefs: [audioRef(CALLER_RECORDING)],
        outputMediaRefs: [audioRef(REPLY_RECORDING)],
      }),
    );

    expect(mediaIn("User")).toEqual([CALLER_RECORDING]);
    expect(mediaIn("Assistant")).toEqual([REPLY_RECORDING]);
  });
});

describe("given a turn with no media at all", () => {
  it("renders the messages with no media strip", () => {
    renderConversation(turn());

    expect(screen.queryAllByTestId("media-part")).toHaveLength(0);
  });
});

describe("given a turn whose input a privacy rule hid", () => {
  /** @scenario "A message hidden by a privacy rule renders no media" */
  it("shows the redacted marker and no media on the user side", () => {
    renderConversation(
      turn({
        input: null,
        inputRedacted: true,
        // Refs are stripped server-side for a redacted field; the message
        // still carries no media even when one reaches the client.
        inputMediaRefs: [audioRef(CALLER_RECORDING, "user")],
      }),
    );

    expect(screen.getByText("Redacted")).toBeInTheDocument();
    expect(screen.queryAllByTestId("media-part")).toHaveLength(0);
  });
});
