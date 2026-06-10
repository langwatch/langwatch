/**
 * @vitest-environment jsdom
 *
 * Integration test for ScenarioMessageRenderer's content coercion.
 *
 * Pins the renderer/extractor coercion parity: when the python-sdk sends
 * `content` as a Python `repr(list)` string (single quotes, None/True/False
 * keywords), the renderer must walk it the same way the stored-objects
 * extractor does instead of dumping the raw repr blob into the bubble.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ScenarioMessageRenderer } from "../ScenarioMessageRenderer";
import type { ScenarioMessageSnapshotEvent } from "~/server/scenarios/scenario-event.types";

vi.mock("~/utils/api", () => ({
  api: {
    storedObjects: {
      headById: {
        useQuery: () => ({ data: undefined }),
      },
    },
  },
}));

vi.mock("../../copilot-kit/TraceMessage", () => ({
  TraceMessage: ({ traceId }: { traceId: string }) => (
    <button data-testid="trace-message" data-trace-id={traceId}>View Trace</button>
  ),
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const PROJECT_ID = "proj_test";

const renderWith = (
  messages: ScenarioMessageSnapshotEvent["messages"],
): void => {
  render(
    <Wrapper>
      <ScenarioMessageRenderer
        messages={messages}
        variant="drawer"
        projectId={PROJECT_ID}
      />
    </Wrapper>,
  );
};

const renderWithGrid = (
  messages: ScenarioMessageSnapshotEvent["messages"],
): void => {
  render(
    <Wrapper>
      <ScenarioMessageRenderer
        messages={messages}
        variant="grid"
        projectId={PROJECT_ID}
      />
    </Wrapper>,
  );
};

describe("<ScenarioMessageRenderer/>", () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => cleanup());

  describe("when a message arrives with content as a python-repr string", () => {
    it("renders an <audio> element instead of the raw repr blob", () => {
      const pythonReprContent =
        "[{'type': 'input_audio', 'input_audio': {'data': 'UklGRg==', 'format': 'wav'}}]";

      renderWith([
        {
          id: "msg_audio_repr",
          role: "user",
          content: pythonReprContent,
        } as ScenarioMessageSnapshotEvent["messages"][number],
      ]);

      const audio = document.querySelector("audio");
      expect(audio).not.toBeNull();
      expect(screen.queryByText(/input_audio/)).toBeNull();
    });
  });

  describe("when a message arrives with content as a JSON-encoded array string", () => {
    it("renders the same way as the python-repr equivalent", () => {
      const jsonContent =
        '[{"type":"input_audio","input_audio":{"data":"UklGRg==","format":"wav"}}]';

      renderWith([
        {
          id: "msg_audio_json",
          role: "user",
          content: jsonContent,
        } as ScenarioMessageSnapshotEvent["messages"][number],
      ]);

      const audio = document.querySelector("audio");
      expect(audio).not.toBeNull();
    });
  });

  describe("when a message arrives with a sibling text part as a transcript", () => {
    it("renders audio + italic transcript and not the raw blob", () => {
      const pythonReprContent =
        "[{'type': 'input_audio', 'input_audio': {'data': 'UklGRg==', 'format': 'wav'}}, {'type': 'text', 'text': 'hello world'}]";

      renderWith([
        {
          id: "msg_audio_with_transcript",
          role: "assistant",
          content: pythonReprContent,
        } as ScenarioMessageSnapshotEvent["messages"][number],
      ]);

      expect(document.querySelector("audio")).not.toBeNull();
      expect(screen.getByText("hello world")).toBeInTheDocument();
    });
  });

  describe("when a message has plain string content (not array-shaped)", () => {
    it("renders as a text bubble unchanged", () => {
      renderWith([
        {
          id: "msg_plain",
          role: "assistant",
          content: "hello there",
        } as ScenarioMessageSnapshotEvent["messages"][number],
      ]);

      expect(screen.getByText("hello there")).toBeInTheDocument();
      expect(document.querySelector("audio")).toBeNull();
    });
  });

  // The AC 3 binding below is partial: TraceMessage owns the click handler
  // (useTraceDetailsDrawer().openTraceDetailsDrawer), so this jsdom test only
  // asserts the renderer's responsibility — mounting TraceMessage with the
  // correct traceId. The drawer-open behavior on click is browser-verified.
  describe("when an assistant audio message has a trace id in drawer variant", () => {
    /** @scenario "Assistant audio turn with a trace id shows the View Trace button in drawer variant" */
    /** @scenario "Clicking View Trace on an audio turn opens the trace details drawer" */
    it("renders a View Trace button under the media bubble", () => {
      renderWith([
        {
          id: "msg_audio_trace",
          role: "assistant",
          trace_id: "trace_abc123",
          content:
            '[{"type":"input_audio","input_audio":{"data":"UklGRg==","format":"wav"}}]',
        } as ScenarioMessageSnapshotEvent["messages"][number],
      ]);

      const traceButton = screen.getByTestId("trace-message");
      expect(traceButton).toBeInTheDocument();
      expect(traceButton).toHaveAttribute("data-trace-id", "trace_abc123");
      // Confirms it's the media branch rendering (not a text branch)
      expect(document.querySelector("audio")).not.toBeNull();
    });
  });

  describe("when an assistant audio message has no trace id", () => {
    /** @scenario "Assistant audio turn without a trace id does not show the button" */
    it("does not render a View Trace button", () => {
      renderWith([
        {
          id: "msg_audio_no_trace",
          role: "assistant",
          content:
            '[{"type":"input_audio","input_audio":{"data":"UklGRg==","format":"wav"}}]',
        } as ScenarioMessageSnapshotEvent["messages"][number],
      ]);

      expect(screen.queryByTestId("trace-message")).toBeNull();
      expect(document.querySelector("audio")).not.toBeNull();
    });
  });

  describe("when a user-role audio message has a trace id", () => {
    /** @scenario "User-role audio turn does not show the View Trace button" */
    it("does not render a View Trace button", () => {
      renderWith([
        {
          id: "msg_audio_user_trace",
          role: "user",
          trace_id: "trace_xyz",
          content:
            '[{"type":"input_audio","input_audio":{"data":"UklGRg==","format":"wav"}}]',
        } as ScenarioMessageSnapshotEvent["messages"][number],
      ]);

      expect(screen.queryByTestId("trace-message")).toBeNull();
      expect(document.querySelector("audio")).not.toBeNull();
    });
  });

  describe("when the renderer is mounted in grid variant", () => {
    /** @scenario "Grid variant suppresses the View Trace button on audio turns" */
    it("does not render a View Trace button on assistant audio messages", () => {
      renderWithGrid([
        {
          id: "msg_audio_grid",
          role: "assistant",
          trace_id: "trace_grid",
          content:
            '[{"type":"input_audio","input_audio":{"data":"UklGRg==","format":"wav"}}]',
        } as ScenarioMessageSnapshotEvent["messages"][number],
      ]);

      expect(screen.queryByTestId("trace-message")).toBeNull();
    });
  });

  describe("when an assistant message has both audio and a sibling text transcript with one trace id", () => {
    /** @scenario "Transcript-collapse case renders one bubble with one View Trace button" */
    it("renders exactly one bubble with exactly one View Trace button", () => {
      renderWith([
        {
          id: "msg_audio_transcript",
          role: "assistant",
          trace_id: "trace_collapse",
          content:
            '[{"type":"input_audio","input_audio":{"data":"UklGRg==","format":"wav"}},{"type":"text","text":"hello"}]',
        } as ScenarioMessageSnapshotEvent["messages"][number],
      ]);

      expect(document.querySelectorAll("audio")).toHaveLength(1);
      expect(screen.getAllByTestId("trace-message")).toHaveLength(1);
    });
  });

  describe("when assistant text, tool_call, and tool_result turns have trace ids", () => {
    /** @scenario "Existing trace-button behavior on text and tool turns is unchanged" */
    it("renders a View Trace button for each turn unchanged", () => {
      renderWith([
        {
          id: "msg_text_turn",
          role: "assistant",
          trace_id: "trace_text",
          content: "Here is the result",
        } as ScenarioMessageSnapshotEvent["messages"][number],
        {
          id: "msg_tool_call_turn",
          role: "assistant",
          trace_id: "trace_tool_call",
          content: "",
          tool_calls: [{ function: { name: "search", arguments: "{}" } }],
        } as ScenarioMessageSnapshotEvent["messages"][number],
        {
          id: "msg_tool_result_turn",
          role: "tool",
          trace_id: "trace_tool_result",
          content: "ok",
        } as ScenarioMessageSnapshotEvent["messages"][number],
      ]);

      const traceButtons = screen.getAllByTestId("trace-message");
      expect(traceButtons).toHaveLength(3);

      const traceIds = traceButtons.map((btn) =>
        btn.getAttribute("data-trace-id"),
      );
      expect(traceIds).toContain("trace_text");
      expect(traceIds).toContain("trace_tool_call");
      expect(traceIds).toContain("trace_tool_result");
    });
  });

  // -------------------------------------------------------------------------
  // #4138 — post-extraction `input_audio` URL shape.
  //
  // After server-side stored-objects extraction, an `input_audio` part is
  // rewritten from inline `{data, format}` to `{url: "/api/files/<id>",
  // mimeType}` (content-extractor.ts). These pin that the renderer plays the
  // url-shape turn through MediaPart's native <audio> in BOTH the grid and
  // drawer variants, and degrades gracefully for an unrenderable shape.
  // -------------------------------------------------------------------------
  describe("when an assistant audio message arrives in the post-extraction url shape (#4138)", () => {
    const urlShapeMessage = {
      id: "msg_audio_url_shape",
      role: "assistant",
      content: [
        {
          type: "input_audio",
          input_audio: { url: "/api/files/test-id", mimeType: "audio/mpeg" },
        },
      ],
    } as unknown as ScenarioMessageSnapshotEvent["messages"][number];

    it("renders a media-part-audio element whose src is the file url (drawer variant)", () => {
      renderWith([urlShapeMessage]);

      const audio = screen.getByTestId(
        "media-part-audio",
      ) as HTMLAudioElement;
      expect(audio).toBeInTheDocument();
      expect(audio.tagName.toLowerCase()).toBe("audio");
      expect(audio).toHaveAttribute("src", "/api/files/test-id");
      expect(audio).toHaveAttribute("controls");
      // The raw part shape must never leak into the bubble as text.
      expect(screen.queryByText(/input_audio/)).toBeNull();
    });

    it("renders a media-part-audio element whose src is the file url (grid variant)", () => {
      renderWithGrid([urlShapeMessage]);

      const audio = screen.getByTestId(
        "media-part-audio",
      ) as HTMLAudioElement;
      expect(audio).toBeInTheDocument();
      expect(audio).toHaveAttribute("src", "/api/files/test-id");
      expect(audio).toHaveAttribute("controls");
    });
  });

  describe("when a media part has an unsupported mimeType (#4138 graceful fallback)", () => {
    /**
     * A media part whose mimeType is not an `audio/`/`image/`/`video/` type
     * resolves to the binary category in MediaPart, which renders a
     * download-link fallback (media-part-binary) rather than a broken <audio>
     * element. This guards the unhappy shape — a graceful fallback node, never
     * a broken/empty media element — for a file the renderer cannot play
     * inline (e.g. an externalized blob with a non-media content type).
     */
    it("renders a graceful binary fallback, not a broken audio element", () => {
      renderWith([
        {
          id: "msg_audio_bad_mime",
          role: "assistant",
          content: [
            {
              // Non-media mimeType → MediaPart resolves the binary category and
              // renders the download-link fallback instead of an <audio>.
              type: "binary",
              mimeType: "application/octet-stream",
              url: "/api/files/unsupported-id",
              filename: "voice-turn.bin",
            },
          ],
        } as unknown as ScenarioMessageSnapshotEvent["messages"][number],
      ]);

      // Graceful fallback present; no broken <audio> element rendered.
      expect(screen.getByTestId("media-part-binary")).toBeInTheDocument();
      expect(document.querySelector("audio")).toBeNull();
      expect(screen.queryByText(/input_audio/)).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // #4698 — text-first part ordering + audio-only + assistant=left.
  //
  // The production SDK emits assistant voice turns text-FIRST
  // (`[text, input_audio]`); every pre-existing collapse fixture is audio-first
  // (`[input_audio, text]`). The collapse guard is order-independent (filters
  // by kind, not index), so both orderings must produce exactly one bubble
  // with the text as the transcript. Alignment (assistant=left, user=right) is
  // asserted via the `data-align` test affordance because Chakra's `align`
  // prop compiles to an atomic CSS class jsdom's getComputedStyle cannot read.
  // -------------------------------------------------------------------------
  describe("when an assistant voice turn carries audio + a sibling text transcript (#4698)", () => {
    const orderings: Array<{
      label: string;
      parts: unknown[];
    }> = [
      {
        label: "text-first [text, input_audio] (production SDK ordering)",
        parts: [
          { type: "text", text: "hello from the agent" },
          {
            type: "input_audio",
            input_audio: { url: "/api/files/voice-id", mimeType: "audio/mpeg" },
          },
        ],
      },
      {
        label: "audio-first [input_audio, text]",
        parts: [
          {
            type: "input_audio",
            input_audio: { url: "/api/files/voice-id", mimeType: "audio/mpeg" },
          },
          { type: "text", text: "hello from the agent" },
        ],
      },
    ];

    orderings.forEach(({ label, parts }) => {
      describe(`given ordering: ${label}`, () => {
        /** @scenario "Both part orderings collapse a voice turn into one assistant bubble" */
        it("renders exactly one assistant-left bubble with the text as transcript", () => {
          renderWith([
            {
              id: "msg_voice_collapse",
              role: "assistant",
              trace_id: "trace_voice",
              content: parts,
            } as unknown as ScenarioMessageSnapshotEvent["messages"][number],
          ]);

          // Exactly one audio element and one trace button — no duplicate bubble.
          expect(document.querySelectorAll("audio")).toHaveLength(1);
          expect(screen.getAllByTestId("trace-message")).toHaveLength(1);

          // The text renders as the transcript inside the same media wrapper as
          // the <audio> (co-contained), not as a standalone second bubble.
          const transcript = screen.getByText("hello from the agent");
          const audio = screen.getByTestId("media-part-audio");
          const mediaWrapper = audio.closest("[data-align]");
          expect(mediaWrapper).not.toBeNull();
          expect(mediaWrapper).toContainElement(transcript);

          // Assistant bubble aligns LEFT (flex-start) via the test affordance.
          expect(mediaWrapper).toHaveAttribute("data-align", "flex-start");
        });
      });
    });
  });

  describe("when a simulated-user voice turn arrives (#4698 alignment inversion)", () => {
    /** @scenario "User-role voice turns align right" */
    it("aligns the user media bubble to the right (flex-end)", () => {
      renderWith([
        {
          id: "msg_voice_user",
          role: "user",
          content: [
            {
              type: "input_audio",
              input_audio: { url: "/api/files/user-voice", mimeType: "audio/mpeg" },
            },
          ],
        } as unknown as ScenarioMessageSnapshotEvent["messages"][number],
      ]);

      const audio = screen.getByTestId("media-part-audio");
      const mediaWrapper = audio.closest("[data-align]");
      expect(mediaWrapper).toHaveAttribute("data-align", "flex-end");
    });
  });

  describe("when an assistant voice turn is audio-only with no transcript (#4698)", () => {
    /** @scenario "Audio-only voice turn renders one bubble with no empty transcript artifact" */
    it("renders one assistant-left audio bubble and no italic transcript node", () => {
      renderWith([
        {
          id: "msg_voice_audio_only",
          role: "assistant",
          content: [
            {
              type: "input_audio",
              input_audio: { url: "/api/files/solo-voice", mimeType: "audio/mpeg" },
            },
          ],
        } as unknown as ScenarioMessageSnapshotEvent["messages"][number],
      ]);

      // Exactly one audio bubble.
      expect(document.querySelectorAll("audio")).toHaveLength(1);

      const audio = screen.getByTestId("media-part-audio");
      const mediaWrapper = audio.closest("[data-align]");
      expect(mediaWrapper).toHaveAttribute("data-align", "flex-start");

      // No transcript artifact: the inner media container holds only the
      // <audio> (its VStack), no italic caption <p>. Asserting the audio's
      // immediate container has a single child guards against an empty
      // transcript node sneaking in.
      const innerContainer = audio.parentElement?.parentElement;
      expect(innerContainer?.childElementCount).toBe(1);
    });
  });
});
