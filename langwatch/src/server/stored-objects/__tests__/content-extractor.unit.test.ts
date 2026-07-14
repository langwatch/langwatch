/**
 * @vitest-environment node
 *
 * Unit tests for extractInlineMediaFromEvent.
 */
import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before any imports that trigger module load
// ---------------------------------------------------------------------------

vi.mock("@langwatch/telemetry", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { extractInlineMediaFromEvent } from "../content-extractor";
import type { StoredObjectsService } from "../stored-objects.service";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Builds a minimal mock StoredObjectsService. */
function makeService(
  overrides: { storeFromBytes?: StoredObjectsService["storeFromBytes"] } = {},
): StoredObjectsService {
  return {
    storeFromBytes:
      overrides.storeFromBytes ??
      vi.fn().mockResolvedValue({
        id: "stored-id-1",
        mediaType: "audio/mp3",
        isDuplicate: false,
      }),
    getById: vi.fn(),
    deleteOwnedBy: vi.fn(),
  } as unknown as StoredObjectsService;
}

const BASE_PARAMS = {
  projectId: "proj-1",
  ownerKind: "scenario_run",
  ownerId: "run-abc",
  purpose: "scenario_event",
};

/** Encodes a small test string as base64 to simulate inline media data. */
function makeBase64Payload(content = "test-bytes"): string {
  return Buffer.from(content).toString("base64");
}

/** Builds a MESSAGE_SNAPSHOT-like event shape used by the route after schema validation. */
function makeEventWithContent(content: unknown): unknown {
  return {
    type: "MESSAGE_SNAPSHOT",
    timestamp: 1000,
    batchRunId: "batch-1",
    scenarioId: "scen-1",
    scenarioRunId: "run-abc",
    scenarioSetId: "default",
    messages: [],
    message: {
      role: "user",
      content,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("extractInlineMediaFromEvent", () => {
  describe("when an event has no message content", () => {
    it("returns the event unchanged and no refs", async () => {
      const service = makeService();
      const event = {
        type: "RUN_STARTED",
        timestamp: 1000,
        batchRunId: "batch-1",
        scenarioId: "scen-1",
        scenarioRunId: "run-abc",
        scenarioSetId: "default",
      };

      const { rewrittenEvent, refs } = await extractInlineMediaFromEvent({
        ...BASE_PARAMS,
        event,
        service,
      });

      expect(rewrittenEvent).toBe(event);
      expect(refs).toHaveLength(0);
      expect(service.storeFromBytes).not.toHaveBeenCalled();
    });
  });

  describe("when an event has a text part", () => {
    it("returns the event unchanged and no refs", async () => {
      const service = makeService();
      const event = makeEventWithContent([
        { type: "text", text: "Hello, world!" },
      ]);

      const { rewrittenEvent, refs } = await extractInlineMediaFromEvent({
        ...BASE_PARAMS,
        event,
        service,
      });

      expect(refs).toHaveLength(0);
      expect(service.storeFromBytes).not.toHaveBeenCalled();
      // Content array must be identical
      const rewrittenMessage = (
        rewrittenEvent as { message: { content: unknown[] } }
      ).message;
      expect(rewrittenMessage.content).toEqual([
        { type: "text", text: "Hello, world!" },
      ]);
    });
  });

  describe("when an event has an audio part with source.type=data", () => {
    /** @scenario "Inline file part is externalized and the event payload is rewritten by id" */
    it("calls storeFromBytes with the decoded bytes and the mimeType, replaces the part with source.type=url referencing /api/files/{projectId}/{id}, and returns one ref", async () => {
      const base64Payload = makeBase64Payload("audio-data");
      const mimeType = "audio/mp3";
      const storedId = "stored-audio-id";

      const service = makeService({
        storeFromBytes: vi.fn().mockResolvedValue({
          id: storedId,
          mediaType: mimeType,
          isDuplicate: false,
        }),
      });

      const event = makeEventWithContent([
        {
          type: "audio",
          source: { type: "data", value: base64Payload, mimeType },
        },
      ]);

      const { rewrittenEvent, refs } = await extractInlineMediaFromEvent({
        ...BASE_PARAMS,
        event,
        service,
      });

      // storeFromBytes must have been called with the decoded bytes
      expect(service.storeFromBytes).toHaveBeenCalledOnce();
      expect(service.storeFromBytes).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "proj-1",
          purpose: "scenario_event",
          ownerKind: "scenario_run",
          ownerId: "run-abc",
          mediaType: mimeType,
          bytes: Buffer.from("audio-data"),
        }),
      );

      // The part must be rewritten to source.type="url"
      const content = (rewrittenEvent as { message: { content: unknown[] } })
        .message.content;
      expect(content).toHaveLength(1);
      expect(content[0]).toMatchObject({
        type: "audio",
        source: {
          type: "url",
          value: `/api/files/proj-1/${storedId}`,
          mimeType,
        },
      });

      // One ref returned
      expect(refs).toHaveLength(1);
      expect(refs[0]).toMatchObject({
        id: storedId,
        isDuplicate: false,
        purpose: "scenario_event",
        ownerKind: "scenario_run",
        ownerId: "run-abc",
      });
    });
  });

  describe("when an event has multiple media parts", () => {
    it("processes each part and returns one ref per part", async () => {
      const base64 = makeBase64Payload("data");
      let callCount = 0;

      const service = makeService({
        storeFromBytes: vi.fn().mockImplementation(() => {
          callCount++;
          return Promise.resolve({
            id: `stored-id-${callCount}`,
            mediaType: "image/png",
            isDuplicate: false,
          });
        }),
      });

      const event = makeEventWithContent([
        {
          type: "image",
          source: { type: "data", value: base64, mimeType: "image/png" },
        },
        {
          type: "video",
          source: { type: "data", value: base64, mimeType: "video/mp4" },
        },
      ]);

      const { rewrittenEvent, refs } = await extractInlineMediaFromEvent({
        ...BASE_PARAMS,
        event,
        service,
      });

      expect(service.storeFromBytes).toHaveBeenCalledTimes(2);
      expect(refs).toHaveLength(2);

      const content = (rewrittenEvent as { message: { content: unknown[] } })
        .message.content;
      expect(content).toHaveLength(2);
      expect((content[0] as { source: { value: string } }).source.value).toBe(
        "/api/files/proj-1/stored-id-1",
      );
      expect((content[1] as { source: { value: string } }).source.value).toBe(
        "/api/files/proj-1/stored-id-2",
      );
    });
  });

  describe("when an event has a binary part with data field", () => {
    /** @scenario "Binary part variant with inline data is externalized to id and url" */
    it("calls storeFromBytes, sets id and url, and clears data", async () => {
      const base64Payload = makeBase64Payload("binary-content");
      const mimeType = "application/octet-stream";
      const storedId = "stored-binary-id";

      const service = makeService({
        storeFromBytes: vi.fn().mockResolvedValue({
          id: storedId,
          mediaType: mimeType,
          isDuplicate: false,
        }),
      });

      const event = makeEventWithContent([
        {
          type: "binary",
          mimeType,
          data: base64Payload,
          filename: "file.bin",
        },
      ]);

      const { rewrittenEvent, refs } = await extractInlineMediaFromEvent({
        ...BASE_PARAMS,
        event,
        service,
      });

      expect(service.storeFromBytes).toHaveBeenCalledOnce();
      expect(service.storeFromBytes).toHaveBeenCalledWith(
        expect.objectContaining({
          mediaType: mimeType,
          bytes: Buffer.from("binary-content"),
        }),
      );

      const content = (rewrittenEvent as { message: { content: unknown[] } })
        .message.content;
      expect(content).toHaveLength(1);
      const part = content[0] as {
        type: string;
        id: string;
        url: string;
        data: unknown;
        filename: string;
      };
      expect(part.type).toBe("binary");
      expect(part.id).toBe(storedId);
      expect(part.url).toBe(`/api/files/proj-1/${storedId}`);
      expect(part.data).toBeUndefined();
      // Non-data fields preserved
      expect(part.filename).toBe("file.bin");

      expect(refs).toHaveLength(1);
      expect(refs[0]!.id).toBe(storedId);
    });
  });

  describe("when an event has an audio part already in source.type=url form", () => {
    it("returns the event unchanged and no refs for that part", async () => {
      const service = makeService();

      const event = makeEventWithContent([
        {
          type: "audio",
          source: {
            type: "url",
            value: "https://example.com/audio.mp3",
            mimeType: "audio/mp3",
          },
        },
      ]);

      const { refs } = await extractInlineMediaFromEvent({
        ...BASE_PARAMS,
        event,
        service,
      });

      expect(service.storeFromBytes).not.toHaveBeenCalled();
      expect(refs).toHaveLength(0);
    });
  });

  describe("when storeFromBytes throws", () => {
    it("propagates the error and stops processing further parts", async () => {
      const base64 = makeBase64Payload("data");
      const storageError = new Error("Storage failure");

      const service = makeService({
        storeFromBytes: vi.fn().mockRejectedValue(storageError),
      });

      const event = makeEventWithContent([
        {
          type: "image",
          source: { type: "data", value: base64, mimeType: "image/png" },
        },
        {
          type: "video",
          source: { type: "data", value: base64, mimeType: "video/mp4" },
        },
      ]);

      await expect(
        extractInlineMediaFromEvent({ ...BASE_PARAMS, event, service }),
      ).rejects.toThrow("Storage failure");

      // Only the first part was attempted before the throw
      expect(service.storeFromBytes).toHaveBeenCalledOnce();
    });
  });

  describe("when a content part has an unrecognised shape", () => {
    /** @scenario "Content parts with an unrecognised shape cause the message to pass through unchanged" */
    it("returns the event unchanged and no refs", async () => {
      const service = makeService();

      // Put an unrecognised part (unknown type) in the content array. The
      // walker falls through to its `unknown` handler (no-op) and leaves
      // the part untouched — "degraded, not broken".
      const event = makeEventWithContent([
        { type: "not-a-known-shape", someField: "value" },
      ]);

      const { rewrittenEvent, refs } = await extractInlineMediaFromEvent({
        ...BASE_PARAMS,
        event,
        service,
      });

      expect(rewrittenEvent).toBe(event);
      expect(refs).toHaveLength(0);
      expect(service.storeFromBytes).not.toHaveBeenCalled();
    });
  });

  describe("when an event has an image_url part with a base64 data URI (production shape)", () => {
    /** @scenario "OpenAI-shaped image_url parts with data: URIs are extracted to stored objects" */
    it("extracts the bytes and rewrites image_url.url to /api/files/<projectId>/<id>", async () => {
      const base64Payload = makeBase64Payload("image-bytes");
      const mimeType = "image/png";
      const service = makeService({
        storeFromBytes: vi.fn().mockResolvedValue({
          id: "so_image_url_one",
          mediaType: mimeType,
          isDuplicate: false,
        }),
      });

      const event = makeEventWithContent([
        {
          type: "image_url",
          image_url: {
            url: `data:${mimeType};base64,${base64Payload}`,
            detail: "high",
          },
        },
      ]);

      const { rewrittenEvent, refs } = await extractInlineMediaFromEvent({
        ...BASE_PARAMS,
        event,
        service,
      });

      expect(service.storeFromBytes).toHaveBeenCalledOnce();
      expect(service.storeFromBytes).toHaveBeenCalledWith(
        expect.objectContaining({
          mediaType: mimeType,
          bytes: Buffer.from("image-bytes"),
        }),
      );
      const rewritten = rewrittenEvent as {
        message: {
          content: Array<{
            type: string;
            image_url: { url: string; detail?: string };
          }>;
        };
      };
      expect(rewritten.message.content[0]).toEqual({
        type: "image_url",
        image_url: {
          url: "/api/files/proj-1/so_image_url_one",
          detail: "high",
        },
      });
      expect(refs).toEqual([
        expect.objectContaining({ id: "so_image_url_one", isDuplicate: false }),
      ]);
    });
  });

  describe("when an event has an image_url part with an http URL (not a data URI)", () => {
    /** @scenario "image_url parts with http(s) URLs pass through unchanged — not re-hosted" */
    it("returns the event unchanged and does not call the storage service", async () => {
      const service = makeService();

      const event = makeEventWithContent([
        {
          type: "image_url",
          image_url: { url: "https://cdn.example.com/image.png" },
        },
      ]);

      const { rewrittenEvent, refs } = await extractInlineMediaFromEvent({
        ...BASE_PARAMS,
        event,
        service,
      });

      expect(rewrittenEvent).toBe(event);
      expect(refs).toHaveLength(0);
      expect(service.storeFromBytes).not.toHaveBeenCalled();
    });
  });

  describe("when an event has an AI-SDK file+audio part (typescript scenario SDK shape)", () => {
    it("calls storeFromBytes with the audio mediaType and rewrites the part to {type:'input_audio', input_audio:{url, mimeType}}", async () => {
      const base64Payload = makeBase64Payload("PCM16_AUDIO_BYTES");
      const mimeType = "audio/pcm16";
      const storedId = "stored-file-audio-id";

      const service = makeService({
        storeFromBytes: vi.fn().mockResolvedValue({
          id: storedId,
          mediaType: mimeType,
          isDuplicate: false,
        }),
      });

      // Shape emitted by the typescript scenario SDK's `createAudioMessage`
      // (voice/messages.ts) before the SDK-side translation patch. Older
      // builds (and any future caller that ships raw AI-SDK file parts)
      // hit this branch; the extractor must externalise the bytes rather
      // than let them flow to ClickHouse Messages.Content inline.
      const event = makeEventWithContent([
        { type: "text", text: "Hi" },
        {
          type: "file",
          mediaType: "audio/pcm16",
          data: base64Payload,
        },
      ]);

      const { rewrittenEvent, refs } = await extractInlineMediaFromEvent({
        ...BASE_PARAMS,
        event,
        service,
      });

      expect(service.storeFromBytes).toHaveBeenCalledOnce();
      expect(service.storeFromBytes).toHaveBeenCalledWith(
        expect.objectContaining({
          mediaType: "audio/pcm16",
          bytes: Buffer.from("PCM16_AUDIO_BYTES"),
        }),
      );

      const content = (rewrittenEvent as { message: { content: unknown[] } })
        .message.content;
      expect(content).toHaveLength(2);
      expect(content[0]).toEqual({ type: "text", text: "Hi" });
      // File-shape inputs rewrite to a clean input_audio reference — NOT a
      // chimera of {type:"file", mediaType, input_audio:{...}}. The
      // downstream UI MediaPart consumes the input_audio shape.
      expect(content[1]).toEqual({
        type: "input_audio",
        input_audio: {
          data: undefined,
          url: `/api/files/proj-1/${storedId}`,
          mimeType: "audio/pcm16",
        },
      });

      expect(refs).toHaveLength(1);
      expect(refs[0]!.id).toBe(storedId);
    });
  });

  describe("when an event has an AI-SDK file+audio part with mixed-case mediaType", () => {
    it("normalises the mediaType for the audio/* check and routes to input_audio (not binary)", async () => {
      // MIME types are case-insensitive per RFC 2045 §5.1, so an `Audio/WAV`
      // file part should externalise via the audio path the same as
      // `audio/wav`. Before normalisation this fell into the binary branch
      // and produced a `type:"binary"` rewrite — silently wrong shape.
      const base64Payload = makeBase64Payload("WAV_BYTES");
      const storedId = "stored-mixedcase-audio-id";

      const service = makeService({
        storeFromBytes: vi.fn().mockResolvedValue({
          id: storedId,
          mediaType: "audio/wav",
          isDuplicate: false,
        }),
      });

      const event = makeEventWithContent([
        {
          type: "file",
          mediaType: "Audio/WAV",
          data: base64Payload,
        },
      ]);

      const { rewrittenEvent } = await extractInlineMediaFromEvent({
        ...BASE_PARAMS,
        event,
        service,
      });

      const content = (rewrittenEvent as { message: { content: unknown[] } })
        .message.content;
      expect(content[0]).toEqual({
        type: "input_audio",
        input_audio: {
          data: undefined,
          url: `/api/files/proj-1/${storedId}`,
          mimeType: "audio/wav",
        },
      });
    });
  });

  describe("when an event has an AI-SDK file part with a non-audio mediaType", () => {
    it("calls storeFromBytes and rewrites the part with id and url", async () => {
      const base64Payload = makeBase64Payload("PNG_BYTES");
      const mimeType = "image/png";
      const storedId = "stored-file-image-id";

      const service = makeService({
        storeFromBytes: vi.fn().mockResolvedValue({
          id: storedId,
          mediaType: mimeType,
          isDuplicate: false,
        }),
      });

      const event = makeEventWithContent([
        {
          type: "file",
          mediaType: "image/png",
          data: base64Payload,
          filename: "preview.png",
        },
      ]);

      const { rewrittenEvent, refs } = await extractInlineMediaFromEvent({
        ...BASE_PARAMS,
        event,
        service,
      });

      expect(service.storeFromBytes).toHaveBeenCalledOnce();
      expect(service.storeFromBytes).toHaveBeenCalledWith(
        expect.objectContaining({
          mediaType: "image/png",
          bytes: Buffer.from("PNG_BYTES"),
        }),
      );

      const content = (rewrittenEvent as { message: { content: unknown[] } })
        .message.content;
      const part = content[0] as {
        type: string;
        id: string;
        url: string;
        data: unknown;
        filename: string;
      };
      expect(part.type).toBe("binary");
      expect(part.id).toBe(storedId);
      expect(part.url).toBe(`/api/files/proj-1/${storedId}`);
      expect(part.data).toBeUndefined();
      expect(part.filename).toBe("preview.png");

      expect(refs).toHaveLength(1);
      expect(refs[0]!.id).toBe(storedId);
    });
  });

  describe("when the same content appears twice in one event", () => {
    it("returns two refs both pointing at the same id, second isDuplicate=true", async () => {
      const base64 = makeBase64Payload("same-data");
      const storedId = "deduped-id";
      let callIndex = 0;

      const service = makeService({
        storeFromBytes: vi.fn().mockImplementation(() => {
          callIndex++;
          return Promise.resolve({
            id: storedId,
            mediaType: "image/png",
            isDuplicate: callIndex > 1,
          });
        }),
      });

      const event = makeEventWithContent([
        {
          type: "image",
          source: { type: "data", value: base64, mimeType: "image/png" },
        },
        {
          type: "image",
          source: { type: "data", value: base64, mimeType: "image/png" },
        },
      ]);

      const { refs } = await extractInlineMediaFromEvent({
        ...BASE_PARAMS,
        event,
        service,
      });

      expect(refs).toHaveLength(2);
      expect(refs[0]!.id).toBe(storedId);
      expect(refs[0]!.isDuplicate).toBe(false);
      expect(refs[1]!.id).toBe(storedId);
      expect(refs[1]!.isDuplicate).toBe(true);
    });
  });

  describe("when the event is a MESSAGE_SNAPSHOT with messages[] containing inline media", () => {
    /** @scenario "Extractor handles MESSAGE_SNAPSHOT events with messages[] in addition to TEXT_MESSAGE_END events with single message" */
    it("walks every message in the messages array and rewrites inline parts", async () => {
      const base64 = makeBase64Payload("snapshot-payload");
      const service = makeService();

      // MESSAGE_SNAPSHOT shape: `messages` is the array of messages, and
      // the top-level `message` field is absent — the extractor must
      // route by shape, not by parse-fallback.
      const event = {
        type: "MESSAGE_SNAPSHOT",
        timestamp: 1000,
        batchRunId: "batch-1",
        scenarioId: "scen-1",
        scenarioRunId: "run-abc",
        scenarioSetId: "default",
        messages: [
          {
            role: "user",
            content: "no media here",
          },
          {
            role: "assistant",
            content: [
              {
                type: "audio",
                source: { type: "data", value: base64, mimeType: "audio/mpeg" },
              },
            ],
          },
        ],
      };

      const { rewrittenEvent, refs } = await extractInlineMediaFromEvent({
        ...BASE_PARAMS,
        event,
        service,
      });

      // Exactly one inline part across the two messages was externalized.
      expect(refs).toHaveLength(1);

      const rewritten = rewrittenEvent as { messages: unknown[] };
      // First message was a string — unchanged in place.
      expect(rewritten.messages[0]).toEqual({
        role: "user",
        content: "no media here",
      });

      // Second message's audio part is now a URL reference.
      const secondMsg = rewritten.messages[1] as {
        role: string;
        content: Array<{
          type: string;
          source: { type: string; value: string };
        }>;
      };
      expect(secondMsg.role).toBe("assistant");
      expect(secondMsg.content).toHaveLength(1);
      expect(secondMsg.content[0]!.type).toBe("audio");
      expect(secondMsg.content[0]!.source.type).toBe("url");
      expect(secondMsg.content[0]!.source.value).toBe(
        "/api/files/proj-1/stored-id-1",
      );
    });
  });

  describe("when a binary part declares both data and url (violating exactly-one-of)", () => {
    /** @scenario "Binary part variant rejects parts that carry data plus an explicit id or url" */
    it("passes the message through unchanged and does not call storeFromBytes", async () => {
      const service = makeService();
      const event = makeEventWithContent([
        {
          type: "binary",
          mimeType: "audio/mpeg",
          data: makeBase64Payload("ambiguous"),
          url: "/api/files/already-set",
        },
      ]);

      const { rewrittenEvent, refs } = await extractInlineMediaFromEvent({
        ...BASE_PARAMS,
        event,
        service,
      });

      expect(rewrittenEvent).toBe(event);
      expect(refs).toHaveLength(0);
      expect(service.storeFromBytes).not.toHaveBeenCalled();
    });
  });

  describe("when a document part has an unsafe MIME type (not in the read-path allowlist)", () => {
    it("passes through text/csv document parts unchanged and does not call storeFromBytes", async () => {
      const service = makeService();
      const event = makeEventWithContent([
        {
          type: "document",
          source: {
            type: "data",
            value: makeBase64Payload("col1,col2\nval1,val2"),
            mimeType: "text/csv",
          },
        },
      ]);

      const { rewrittenEvent, refs } = await extractInlineMediaFromEvent({
        ...BASE_PARAMS,
        event,
        service,
      });

      expect(rewrittenEvent).toBe(event);
      expect(refs).toHaveLength(0);
      expect(service.storeFromBytes).not.toHaveBeenCalled();
    });

    it("passes through application/json document parts unchanged and does not call storeFromBytes", async () => {
      const service = makeService();
      const event = makeEventWithContent([
        {
          type: "document",
          source: {
            type: "data",
            value: makeBase64Payload('{"key":"value"}'),
            mimeType: "application/json",
          },
        },
      ]);

      const { rewrittenEvent, refs } = await extractInlineMediaFromEvent({
        ...BASE_PARAMS,
        event,
        service,
      });

      expect(rewrittenEvent).toBe(event);
      expect(refs).toHaveLength(0);
      expect(service.storeFromBytes).not.toHaveBeenCalled();
    });
  });

  describe("when a document part has a safe MIME type (application/pdf)", () => {
    it("stores the bytes and rewrites the part to source.type=url", async () => {
      const base64Payload = makeBase64Payload("%PDF-1.4 fake pdf bytes");
      const mimeType = "application/pdf";
      const storedId = "stored-pdf-id";

      const service = makeService({
        storeFromBytes: vi.fn().mockResolvedValue({
          id: storedId,
          mediaType: mimeType,
          isDuplicate: false,
        }),
      });

      const event = makeEventWithContent([
        {
          type: "document",
          source: { type: "data", value: base64Payload, mimeType },
        },
      ]);

      const { rewrittenEvent, refs } = await extractInlineMediaFromEvent({
        ...BASE_PARAMS,
        event,
        service,
      });

      expect(service.storeFromBytes).toHaveBeenCalledOnce();
      expect(refs).toHaveLength(1);
      expect(refs[0]!.id).toBe(storedId);

      const content = (rewrittenEvent as { message: { content: unknown[] } })
        .message.content;
      expect(content).toHaveLength(1);
      expect(content[0]).toMatchObject({
        type: "document",
        source: {
          type: "url",
          value: `/api/files/proj-1/${storedId}`,
          mimeType,
        },
      });
    });
  });

  describe("when an event has an AI-SDK image part with a base64 data URI (typescript scenario SDK shape)", () => {
    it("extracts the bytes and rewrites image to /api/files/<projectId>/<id>", async () => {
      const base64Payload = makeBase64Payload("WEBP_BYTES");
      const storedId = "stored-image-id";

      const service = makeService({
        storeFromBytes: vi.fn().mockResolvedValue({
          id: storedId,
          mediaType: "image/webp",
          isDuplicate: false,
        }),
      });

      const event = makeEventWithContent([
        { type: "text", text: "What do you see in this image?" },
        { type: "image", image: `data:image/webp;base64,${base64Payload}` },
      ]);

      const { rewrittenEvent, refs } = await extractInlineMediaFromEvent({
        ...BASE_PARAMS,
        event,
        service,
      });

      expect(service.storeFromBytes).toHaveBeenCalledOnce();
      expect(service.storeFromBytes).toHaveBeenCalledWith(
        expect.objectContaining({
          mediaType: "image/webp",
          bytes: Buffer.from("WEBP_BYTES"),
        }),
      );

      const content = (rewrittenEvent as { message: { content: unknown[] } })
        .message.content;
      expect(content[0]).toEqual({
        type: "text",
        text: "What do you see in this image?",
      });
      expect(content[1]).toEqual({
        type: "image",
        image: `/api/files/proj-1/${storedId}`,
      });

      expect(refs).toHaveLength(1);
      expect(refs[0]!.id).toBe(storedId);
    });
  });

  describe("when an event has an AI-SDK image part with an http URL", () => {
    /** @scenario "AI-SDK image parts with http(s) URLs validate and pass through unchanged" */
    it("returns the event unchanged and does not call the storage service", async () => {
      const service = makeService();
      const event = makeEventWithContent([
        { type: "image", image: "https://example.com/cat.png" },
      ]);

      const { rewrittenEvent, refs } = await extractInlineMediaFromEvent({
        ...BASE_PARAMS,
        event,
        service,
      });

      expect(rewrittenEvent).toBe(event);
      expect(refs).toHaveLength(0);
      expect(service.storeFromBytes).not.toHaveBeenCalled();
    });
  });

  describe("when an event has an OpenAI file part with a data URI file_data (multimodal-files docs shape)", () => {
    it("extracts the bytes and rewrites the part to a binary reference preserving the filename", async () => {
      const base64Payload = makeBase64Payload("%PDF-1.4 fake pdf bytes");
      const storedId = "stored-openai-file-id";

      const service = makeService({
        storeFromBytes: vi.fn().mockResolvedValue({
          id: storedId,
          mediaType: "application/pdf",
          isDuplicate: false,
        }),
      });

      const event = makeEventWithContent([
        { type: "text", text: "Please summarize this document." },
        {
          type: "file",
          file: {
            filename: "document.pdf",
            file_data: `data:application/pdf;base64,${base64Payload}`,
          },
        },
      ]);

      const { rewrittenEvent, refs } = await extractInlineMediaFromEvent({
        ...BASE_PARAMS,
        event,
        service,
      });

      expect(service.storeFromBytes).toHaveBeenCalledOnce();
      expect(service.storeFromBytes).toHaveBeenCalledWith(
        expect.objectContaining({
          mediaType: "application/pdf",
          bytes: Buffer.from("%PDF-1.4 fake pdf bytes"),
        }),
      );

      const content = (rewrittenEvent as { message: { content: unknown[] } })
        .message.content;
      const part = content[1] as {
        type: string;
        id: string;
        url: string;
        data: unknown;
        filename: string;
      };
      expect(part.type).toBe("binary");
      expect(part.id).toBe(storedId);
      expect(part.url).toBe(`/api/files/proj-1/${storedId}`);
      expect(part.data).toBeUndefined();
      expect(part.filename).toBe("document.pdf");

      expect(refs).toHaveLength(1);
      expect(refs[0]!.id).toBe(storedId);
    });
  });

  describe("when an event has an OpenAI file part with raw base64 file_data (OpenAI API wire format)", () => {
    it("infers the mime type from the filename extension and externalizes the bytes", async () => {
      const base64Payload = makeBase64Payload("%PDF-1.4 raw base64 pdf");
      const storedId = "stored-raw-file-id";

      const service = makeService({
        storeFromBytes: vi.fn().mockResolvedValue({
          id: storedId,
          mediaType: "application/pdf",
          isDuplicate: false,
        }),
      });

      const event = makeEventWithContent([
        {
          type: "file",
          file: { filename: "report.pdf", file_data: base64Payload },
        },
      ]);

      const { rewrittenEvent, refs } = await extractInlineMediaFromEvent({
        ...BASE_PARAMS,
        event,
        service,
      });

      expect(service.storeFromBytes).toHaveBeenCalledWith(
        expect.objectContaining({
          mediaType: "application/pdf",
          bytes: Buffer.from("%PDF-1.4 raw base64 pdf"),
        }),
      );

      const content = (rewrittenEvent as { message: { content: unknown[] } })
        .message.content;
      expect(content[0]).toMatchObject({
        type: "binary",
        url: `/api/files/proj-1/${storedId}`,
        filename: "report.pdf",
      });
      expect(refs).toHaveLength(1);
    });
  });

  describe("when an event has an OpenAI file part carrying only a provider file_id", () => {
    /** @scenario "OpenAI file parts carrying only a provider file_id pass through unchanged" */
    it("returns the event unchanged and does not call the storage service", async () => {
      const service = makeService();
      const event = makeEventWithContent([
        { type: "file", file: { file_id: "file-abc123" } },
      ]);

      const { rewrittenEvent, refs } = await extractInlineMediaFromEvent({
        ...BASE_PARAMS,
        event,
        service,
      });

      expect(rewrittenEvent).toBe(event);
      expect(refs).toHaveLength(0);
      expect(service.storeFromBytes).not.toHaveBeenCalled();
    });
  });

  describe("when an event has an OpenAI file part with raw base64 audio file_data", () => {
    /** @scenario "Raw-base64 audio file payloads resolve a playable audio type from the filename" */
    it("infers the audio mime type from the filename and routes through input_audio so the rewrite stays playable", async () => {
      const base64Payload = makeBase64Payload("RAW_WAV_BYTES");
      const storedId = "stored-raw-audio-id";

      const service = makeService({
        storeFromBytes: vi.fn().mockResolvedValue({
          id: storedId,
          mediaType: "audio/wav",
          isDuplicate: false,
        }),
      });

      const event = makeEventWithContent([
        {
          type: "file",
          file: { filename: "recording.wav", file_data: base64Payload },
        },
      ]);

      const { rewrittenEvent, refs } = await extractInlineMediaFromEvent({
        ...BASE_PARAMS,
        event,
        service,
      });

      expect(service.storeFromBytes).toHaveBeenCalledWith(
        expect.objectContaining({
          mediaType: "audio/wav",
          bytes: Buffer.from("RAW_WAV_BYTES"),
        }),
      );

      const content = (rewrittenEvent as { message: { content: unknown[] } })
        .message.content;
      expect(content[0]).toEqual({
        type: "input_audio",
        input_audio: {
          data: undefined,
          url: `/api/files/proj-1/${storedId}`,
          mimeType: "audio/wav",
        },
      });
      expect(refs).toHaveLength(1);
    });
  });

  describe("when a data URI carries MIME parameters (RFC 2397)", () => {
    it("resolves the bare type before the first semicolon for OpenAI file parts", async () => {
      const base64Payload = makeBase64Payload("%PDF-1.4 parameterized");
      const storedId = "stored-param-file-id";

      const service = makeService({
        storeFromBytes: vi.fn().mockResolvedValue({
          id: storedId,
          mediaType: "application/pdf",
          isDuplicate: false,
        }),
      });

      const event = makeEventWithContent([
        {
          type: "file",
          file: {
            filename: "doc.pdf",
            file_data: `data:application/pdf;name=doc.pdf;base64,${base64Payload}`,
          },
        },
      ]);

      await extractInlineMediaFromEvent({ ...BASE_PARAMS, event, service });

      // Never "application/pdf;name=doc.pdf" — that fails the readback
      // allowlist and would leak parameters into storage Content-Type.
      expect(service.storeFromBytes).toHaveBeenCalledWith(
        expect.objectContaining({ mediaType: "application/pdf" }),
      );
    });

    it("resolves the bare type for bareImage data URIs (the twin parser path)", async () => {
      const base64Payload = makeBase64Payload("PNG_BYTES");
      const storedId = "stored-param-image-id";

      const service = makeService({
        storeFromBytes: vi.fn().mockResolvedValue({
          id: storedId,
          mediaType: "image/png",
          isDuplicate: false,
        }),
      });

      const event = makeEventWithContent([
        {
          type: "image",
          image: `data:image/png;name=x.png;base64,${base64Payload}`,
        },
      ]);

      await extractInlineMediaFromEvent({ ...BASE_PARAMS, event, service });

      expect(service.storeFromBytes).toHaveBeenCalledWith(
        expect.objectContaining({ mediaType: "image/png" }),
      );
    });
  });

  describe("when an OpenAI file part carries a non-readback-safe document type", () => {
    it("still externalizes it — the chip downloads bytes verbatim, so the octet-stream readback downgrade is acceptable", async () => {
      const base64Payload = makeBase64Payload("col1,col2\n1,2");
      const storedId = "stored-csv-id";

      const service = makeService({
        storeFromBytes: vi.fn().mockResolvedValue({
          id: storedId,
          mediaType: "text/csv",
          isDuplicate: false,
        }),
      });

      const event = makeEventWithContent([
        {
          type: "file",
          file: { filename: "report.csv", file_data: base64Payload },
        },
      ]);

      const { rewrittenEvent, refs } = await extractInlineMediaFromEvent({
        ...BASE_PARAMS,
        event,
        service,
      });

      expect(service.storeFromBytes).toHaveBeenCalledWith(
        expect.objectContaining({ mediaType: "text/csv" }),
      );
      const content = (rewrittenEvent as { message: { content: unknown[] } })
        .message.content;
      expect(content[0]).toMatchObject({
        type: "binary",
        filename: "report.csv",
        url: `/api/files/proj-1/${storedId}`,
      });
      expect(refs).toHaveLength(1);
    });
  });

  describe("when an OpenAI file part carries a malformed data URI", () => {
    it("passes through unchanged when the data URI has no comma", async () => {
      const service = makeService();
      const event = makeEventWithContent([
        {
          type: "file",
          file: { filename: "x.pdf", file_data: "data:application/pdf;base64" },
        },
      ]);

      const { rewrittenEvent, refs } = await extractInlineMediaFromEvent({
        ...BASE_PARAMS,
        event,
        service,
      });

      expect(rewrittenEvent).toBe(event);
      expect(refs).toHaveLength(0);
      expect(service.storeFromBytes).not.toHaveBeenCalled();
    });

    it("passes through unchanged when the data URI lacks the base64 marker", async () => {
      const service = makeService();
      const event = makeEventWithContent([
        {
          type: "file",
          file: { filename: "x.txt", file_data: "data:text/plain,hello" },
        },
      ]);

      const { rewrittenEvent, refs } = await extractInlineMediaFromEvent({
        ...BASE_PARAMS,
        event,
        service,
      });

      expect(rewrittenEvent).toBe(event);
      expect(refs).toHaveLength(0);
      expect(service.storeFromBytes).not.toHaveBeenCalled();
    });
  });

  describe("when a raw-base64 OpenAI file part has an unrecognized extension", () => {
    it("externalizes it as application/octet-stream (generic download)", async () => {
      const base64Payload = makeBase64Payload("mystery-bytes");
      const storedId = "stored-unknown-ext-id";

      const service = makeService({
        storeFromBytes: vi.fn().mockResolvedValue({
          id: storedId,
          mediaType: "application/octet-stream",
          isDuplicate: false,
        }),
      });

      const event = makeEventWithContent([
        {
          type: "file",
          file: { filename: "artifact.xyz", file_data: base64Payload },
        },
      ]);

      await extractInlineMediaFromEvent({ ...BASE_PARAMS, event, service });

      expect(service.storeFromBytes).toHaveBeenCalledWith(
        expect.objectContaining({ mediaType: "application/octet-stream" }),
      );
    });
  });

  describe("when an event has an OpenAI file part with an audio data URI", () => {
    it("routes to the input_audio externalization path so the rewrite stays playable", async () => {
      const base64Payload = makeBase64Payload("WAV_BYTES");
      const storedId = "stored-openai-audio-id";

      const service = makeService({
        storeFromBytes: vi.fn().mockResolvedValue({
          id: storedId,
          mediaType: "audio/wav",
          isDuplicate: false,
        }),
      });

      const event = makeEventWithContent([
        {
          type: "file",
          file: {
            filename: "recording.wav",
            file_data: `data:audio/wav;base64,${base64Payload}`,
          },
        },
      ]);

      const { rewrittenEvent, refs } = await extractInlineMediaFromEvent({
        ...BASE_PARAMS,
        event,
        service,
      });

      expect(service.storeFromBytes).toHaveBeenCalledWith(
        expect.objectContaining({
          mediaType: "audio/wav",
          bytes: Buffer.from("WAV_BYTES"),
        }),
      );

      const content = (rewrittenEvent as { message: { content: unknown[] } })
        .message.content;
      expect(content[0]).toEqual({
        type: "input_audio",
        input_audio: {
          data: undefined,
          url: `/api/files/proj-1/${storedId}`,
          mimeType: "audio/wav",
        },
      });
      expect(refs).toHaveLength(1);
    });
  });
});
