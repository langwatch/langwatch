/**
 * @vitest-environment jsdom
 *
 * Integration coverage for the conversation-view scenario of
 * specs/traces-v2/media-rendering.feature: message bubbles render the trace's
 * media parts (players, images) as real widgets, not raw JSON text.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { Trace } from "@langwatch/contracts/tracer";
import { TraceMessages } from "../TraceMessages";

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", slug: "test", name: "Test Project" },
  }),
}));

vi.mock("../../../hooks/useAnnotationCommentStore", () => ({
  useAnnotationCommentStore: () => ({
    setCommentState: vi.fn(),
    action: null,
    conversationHasSomeComments: false,
    setConversationHasSomeComments: vi.fn(),
  }),
}));

vi.mock("./../MessageHoverActions", () => ({
  MessageHoverActions: () => null,
  useTranslationState: () => ({
    translationActive: false,
    translatedTextInput: null,
    translatedTextOutput: null,
  }),
}));

// `~/utils/api` and the relative `../../utils/api` resolve to the same
// module; one mock covers every consumer (annotations query, stored-object
// probe, field-redaction status).
vi.mock("~/utils/api", () => ({
  api: {
    storedObjects: {
      headById: {
        useQuery: () => ({ data: undefined }),
      },
    },
    annotation: {
      getByTraceId: {
        useQuery: () => ({ data: [] }),
      },
    },
    project: {
      getFieldRedactionStatus: {
        useQuery: () => ({
          data: {
            isRedacted: { input: false, output: false },
            visibleTo: { input: null, output: null },
          },
          isLoading: false,
        }),
      },
    },
  },
}));

vi.mock("../../ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function makeTrace(): Trace {
  return {
    trace_id: "trace-1",
    project_id: "proj-1",
    metadata: {},
    timestamps: { started_at: Date.now(), inserted_at: Date.now() },
    input: {
      value: JSON.stringify([
        {
          role: "user",
          content: [
            { type: "text", text: "what does this recording say?" },
            {
              type: "input_audio",
              input_audio: {
                url: "/api/files/proj-1/a1",
                mimeType: "audio/wav",
              },
            },
          ],
        },
      ]),
    },
    output: {
      value: JSON.stringify([
        {
          role: "assistant",
          content: [
            { type: "text", text: "here is the chart" },
            { type: "image_url", image_url: { url: "/api/files/proj-1/i1" } },
          ],
        },
      ]),
    },
    metrics: {},
  } as unknown as Trace;
}

afterEach(cleanup);

describe("TraceMessages media rendering", () => {
  /** @scenario "The conversation view renders media parts inside message bubbles" */
  it("renders the input recording with a player and the output image inline", () => {
    render(
      <TraceMessages trace={makeTrace()} index="only" highlighted={false} />,
      { wrapper: Wrapper },
    );

    expect(screen.getByTestId("media-part-audio")).toBeInTheDocument();
    expect(screen.getByTestId("media-part-image")).toHaveAttribute(
      "src",
      "/api/files/proj-1/i1",
    );
  });
});
