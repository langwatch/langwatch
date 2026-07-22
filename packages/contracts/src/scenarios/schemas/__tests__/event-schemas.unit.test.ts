/**
 * @vitest-environment node
 *
 * Unit tests for the scenario event WIRE validator (`scenarioEventSchema`) —
 * the exact schema the `/api/scenario-events` route hands to
 * `zValidator("json", scenarioEventSchema)`. A `safeParse` success here is a
 * faithful, DB-free proxy for "the route returns 201, not 400": the route only
 * 400s when this parse fails.
 *
 * Regression guard for #5149 (the missing WIRE leg of #4138): a
 * SCENARIO_MESSAGE_SNAPSHOT carrying a voice turn
 * (`[text, {type:"input_audio", input_audio:{data}}]`) was rejected here with a
 * Zod `invalid_union` 400 BEFORE `extractInlineMediaFromEvent` ever ran, so
 * voice audio never reached the externalizer the UI render leg (#4138) depends
 * on. These tests pin that the validator now ACCEPTS `input_audio` while still
 * accepting every previously-valid shape.
 */
import { describe, expect, it } from "vitest";
import { ScenarioEventType } from "../../enums";
import {
  scenarioEventSchema,
  scenarioMessageSnapshotSchema,
} from "../index";

const WAV_BASE64 = Buffer.from("fake-wav-bytes").toString("base64");

/** A MESSAGE_SNAPSHOT wire event whose `messages` carry `content` parts. */
function makeSnapshotEvent(content: unknown) {
  return {
    type: ScenarioEventType.MESSAGE_SNAPSHOT,
    timestamp: Date.now(),
    batchRunId: "batch-1",
    scenarioId: "scenario-1",
    scenarioRunId: "run-1",
    scenarioSetId: "default",
    messages: [{ id: "msg-1", role: "assistant", content }],
  };
}

describe("scenarioMessageSnapshotSchema — input_audio wire acceptance (#5149)", () => {
  it("ACCEPTS a voice turn: [text, input_audio] mixed content (was 400 before the fix)", () => {
    const event = makeSnapshotEvent([
      { type: "text", text: "Here is your audio reply" },
      { type: "input_audio", input_audio: { data: WAV_BASE64, format: "wav" } },
    ]);

    // scenarioEventSchema is the discriminated union the route validator uses.
    const result = scenarioEventSchema.safeParse(event);

    expect(result.success).toBe(true);
  });

  it("preserves the input_audio bytes through validation so the extractor can externalize them", () => {
    const event = makeSnapshotEvent([
      { type: "text", text: "Here is your audio reply" },
      { type: "input_audio", input_audio: { data: WAV_BASE64, format: "wav" } },
    ]);

    const result = scenarioMessageSnapshotSchema.safeParse(event);
    expect(result.success).toBe(true);

    // The audio part — and crucially its base64 `data` — must survive the parse
    // unchanged; `extractInlineMediaFromEvent` reads exactly this to decode and
    // store the bytes. If validation stripped it, the extractor would no-op.
    const audioPart = (result.success ? result.data.messages[0] : undefined) as
      | {
          content: Array<{
            type: string;
            input_audio?: { data?: string; format?: string };
          }>;
        }
      | undefined;
    const part = audioPart?.content.find((p) => p.type === "input_audio");
    expect(part?.input_audio?.data).toBe(WAV_BASE64);
    expect(part?.input_audio?.format).toBe("wav");
  });

  it("ACCEPTS an audio-only turn: [input_audio] with no text part", () => {
    const event = makeSnapshotEvent([
      { type: "input_audio", input_audio: { data: WAV_BASE64, format: "wav" } },
    ]);

    expect(scenarioEventSchema.safeParse(event).success).toBe(true);
  });

  it("ACCEPTS the post-extraction rewrite shape: input_audio:{url, mimeType} with no data", () => {
    const event = makeSnapshotEvent([
      { type: "text", text: "Here is your audio reply" },
      {
        type: "input_audio",
        input_audio: { url: "/api/files/proj/abc123", mimeType: "audio/wav" },
      },
    ]);

    expect(scenarioEventSchema.safeParse(event).success).toBe(true);
  });
});

describe("scenarioMessageSnapshotSchema — regression: previously-valid shapes still validate (#5149 AC4)", () => {
  it("ACCEPTS plain string content", () => {
    const event = makeSnapshotEvent("just text");
    expect(scenarioEventSchema.safeParse(event).success).toBe(true);
  });

  it("ACCEPTS a text content part", () => {
    const event = makeSnapshotEvent([{ type: "text", text: "hello" }]);
    expect(scenarioEventSchema.safeParse(event).success).toBe(true);
  });

  it("ACCEPTS an image_url content part (existing tracer chatMessageSchema member)", () => {
    const event = makeSnapshotEvent([
      { type: "image_url", image_url: { url: "https://example.com/cat.png" } },
    ]);
    expect(scenarioEventSchema.safeParse(event).success).toBe(true);
  });
});

/**
 * Regression guard for the image/file attachment wire leg: the typescript
 * scenario SDK stopped JSON-stringifying array content, so the documented
 * multimodal shapes (scenario docs: multimodal-images, multimodal-files)
 * started arriving as raw arrays and were 400-rejected here BEFORE
 * `extractInlineMediaFromEvent` ever ran — runs showed a report but zero
 * conversation turns in the simulations UI.
 */
describe("given a MESSAGE_SNAPSHOT wire event carrying attachment content", () => {
  const WEBP_DATA_URI = `data:image/webp;base64,${Buffer.from(
    "fake-webp-bytes",
  ).toString("base64")}`;
  const PDF_DATA_URI = `data:application/pdf;base64,${Buffer.from(
    "%PDF-1.4 fake pdf bytes",
  ).toString("base64")}`;

  describe("when the message carries an AI-SDK image part", () => {
    /** @scenario "Documented image and file attachment shapes validate on the wire" */
    it("ACCEPTS a mixed [text, image] turn (was 400 before the fix)", () => {
      const event = makeSnapshotEvent([
        { type: "text", text: "What do you see in this image?" },
        { type: "image", image: WEBP_DATA_URI },
      ]);

      expect(scenarioEventSchema.safeParse(event).success).toBe(true);
    });

    it("ACCEPTS an image-only turn with no text part", () => {
      const event = makeSnapshotEvent([
        { type: "image", image: WEBP_DATA_URI },
      ]);

      expect(scenarioEventSchema.safeParse(event).success).toBe(true);
    });

    it("preserves the image data URI through validation so the extractor can externalize it", () => {
      const event = makeSnapshotEvent([
        { type: "text", text: "What do you see in this image?" },
        { type: "image", image: WEBP_DATA_URI },
      ]);

      const result = scenarioMessageSnapshotSchema.safeParse(event);
      expect(result.success).toBe(true);

      const message = (result.success ? result.data.messages[0] : undefined) as
        | { content: Array<{ type: string; image?: string }> }
        | undefined;
      const part = message?.content.find((p) => p.type === "image");
      expect(part?.image).toBe(WEBP_DATA_URI);
    });

    /** @scenario "AI-SDK image parts with http(s) URLs validate and pass through unchanged" */
    it("ACCEPTS an external http URL image", () => {
      const event = makeSnapshotEvent([
        { type: "image", image: "https://example.com/cat.png" },
      ]);

      expect(scenarioEventSchema.safeParse(event).success).toBe(true);
    });
  });

  describe("when the message carries an OpenAI file part", () => {
    /** @scenario "Documented image and file attachment shapes validate on the wire" */
    it("ACCEPTS a [text, file] turn in the multimodal-files docs shape (was 400 before the fix)", () => {
      const event = makeSnapshotEvent([
        { type: "text", text: "Please summarize this document." },
        {
          type: "file",
          file: { filename: "document.pdf", file_data: PDF_DATA_URI },
        },
      ]);

      expect(scenarioEventSchema.safeParse(event).success).toBe(true);
    });

    it("preserves the file_data and filename through validation so the extractor can externalize them", () => {
      const event = makeSnapshotEvent([
        {
          type: "file",
          file: { filename: "document.pdf", file_data: PDF_DATA_URI },
        },
      ]);

      const result = scenarioMessageSnapshotSchema.safeParse(event);
      expect(result.success).toBe(true);

      const message = (result.success ? result.data.messages[0] : undefined) as
        | {
            content: Array<{
              type: string;
              file?: { file_data?: string; filename?: string };
            }>;
          }
        | undefined;
      const part = message?.content.find((p) => p.type === "file");
      expect(part?.file?.file_data).toBe(PDF_DATA_URI);
      expect(part?.file?.filename).toBe("document.pdf");
    });

    /** @scenario "OpenAI file parts carrying only a provider file_id pass through unchanged" */
    it("ACCEPTS a part carrying only a provider file_id", () => {
      const event = makeSnapshotEvent([
        { type: "file", file: { file_id: "file-abc123" } },
      ]);

      expect(scenarioEventSchema.safeParse(event).success).toBe(true);
    });
  });

  describe("when the message carries an AI-SDK file part", () => {
    /** @scenario "AI-SDK file parts with a document mediaType validate on the wire" */
    it("ACCEPTS a document mediaType part and preserves its data", () => {
      const base64 = Buffer.from("%PDF-1.4 fake pdf bytes").toString("base64");
      const event = makeSnapshotEvent([
        {
          type: "file",
          mediaType: "application/pdf",
          data: base64,
          filename: "document.pdf",
        },
      ]);

      const result = scenarioMessageSnapshotSchema.safeParse(event);
      expect(result.success).toBe(true);

      const message = (result.success ? result.data.messages[0] : undefined) as
        | { content: Array<{ type: string; data?: string }> }
        | undefined;
      const part = message?.content.find((p) => p.type === "file");
      expect(part?.data).toBe(base64);
    });
  });

  describe("when the message carries post-extraction rewrites", () => {
    /** @scenario "Post-extraction image and file rewrites still validate on the wire" */
    it("ACCEPTS the image url reference and the binary reference", () => {
      const event = makeSnapshotEvent([
        { type: "image", image: "/api/files/proj-1/abc123" },
        {
          type: "binary",
          mimeType: "application/pdf",
          id: "def456",
          url: "/api/files/proj-1/def456",
          filename: "document.pdf",
        },
      ]);

      expect(scenarioEventSchema.safeParse(event).success).toBe(true);
    });
  });
});
