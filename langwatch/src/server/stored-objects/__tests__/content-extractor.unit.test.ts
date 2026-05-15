/**
 * @vitest-environment node
 *
 * Unit tests for extractInlineMediaFromEvent.
 */
import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before any imports that trigger module load
// ---------------------------------------------------------------------------

vi.mock("~/utils/logger/server", () => ({
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
function makeService(overrides: {
  storeFromBytes?: StoredObjectsService["storeFromBytes"];
} = {}): StoredObjectsService {
  return {
    storeFromBytes: overrides.storeFromBytes ?? vi.fn().mockResolvedValue({
      id: "stored-id-1",
      mediaType: "audio/mp3",
      isDuplicate: false,
    }),
    getById: vi.fn(),
    cascadeDeleteProject: vi.fn(),
    cascadeDeleteOwner: vi.fn(),
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
      const rewrittenMessage = (rewrittenEvent as { message: { content: unknown[] } }).message;
      expect(rewrittenMessage.content).toEqual([{ type: "text", text: "Hello, world!" }]);
    });
  });

  describe("when an event has an audio part with source.type=data", () => {
    /** @scenario "Inline file part is externalized and the event payload is rewritten by id" */
    it("calls storeFromBytes with the decoded bytes and the mimeType, replaces the part with source.type=url referencing /api/files/{id}, and returns one ref", async () => {
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
      const content = (rewrittenEvent as { message: { content: unknown[] } }).message.content;
      expect(content).toHaveLength(1);
      expect(content[0]).toMatchObject({
        type: "audio",
        source: { type: "url", value: `/api/files/${storedId}`, mimeType },
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

      const content = (rewrittenEvent as { message: { content: unknown[] } }).message.content;
      expect(content).toHaveLength(2);
      expect((content[0] as { source: { value: string } }).source.value).toBe("/api/files/stored-id-1");
      expect((content[1] as { source: { value: string } }).source.value).toBe("/api/files/stored-id-2");
    });
  });

  describe("when an event has a binary part with data field", () => {
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

      const content = (rewrittenEvent as { message: { content: unknown[] } }).message.content;
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
      expect(part.url).toBe(`/api/files/${storedId}`);
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
          source: { type: "url", value: "https://example.com/audio.mp3", mimeType: "audio/mp3" },
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

  describe("when the event message content fails AG-UI parse", () => {
    it("returns the event unchanged and no refs", async () => {
      const service = makeService();

      // Put an invalid part (unknown type) in the content array
      const event = makeEventWithContent([
        { type: "not-a-valid-ag-ui-type", someField: "value" },
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
});
