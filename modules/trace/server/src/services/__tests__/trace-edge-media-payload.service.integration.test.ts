// The store content-addresses bytes the way the real one does and the spool is
// the real `TraceEdgeSpoolService` over a spy `putSpool`, so what is asserted
// is the ORDER of two real services rather than a mock's canned answer.

/**
 * @vitest-environment node
 * Payload preparation with both halves composed: extraction, then the spool.
 * Spec: specs/trace-processing/trace-media-blob-extraction.feature
 */
import { createHash } from "node:crypto";
import { COMMAND_INLINE_THRESHOLD, type RecordSpanCommandData } from "@langwatch/trace-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { describe, expect, it, vi } from "vitest";

import type { TraceMediaStorePort } from "../../ports/trace-media-store.port.ts";
import { TraceEdgeMediaPayloadService } from "../trace-edge-media-payload.service.ts";
import { TraceEdgeSpoolService } from "../trace-edge-spool.service.ts";

function fakeStore(): TraceMediaStorePort {
  const byHash = new Map<string, string>();
  return {
    storeFromBytes: async ({ mediaType, bytes }) => {
      const hash = createHash("sha256").update(bytes).digest("hex");
      const existing = byHash.get(hash);
      if (existing) return { id: existing, mediaType, isDuplicate: true };
      const id = `so-${hash.slice(0, 12)}`;
      byHash.set(hash, id);
      return { id, mediaType, isDuplicate: false };
    },
  };
}

/** A span whose only oversized content is one inline audio part. */
function commandWithAudio(bytes: number): RecordSpanCommandData {
  const messages = [
    {
      role: "user",
      content: [
        { type: "text", text: "transcribe this" },
        {
          type: "file",
          mediaType: "audio/pcm16",
          data: Buffer.alloc(bytes, 7).toString("base64"),
        },
      ],
    },
  ];
  return {
    tenantId: "project-1",
    span: {
      traceId: "trace-1",
      spanId: "span-1",
      name: "llm-call",
      kind: 1,
      startTimeUnixNano: { low: 0, high: 0 },
      endTimeUnixNano: { low: 0, high: 0 },
      attributes: [{ key: "langwatch.input", value: { stringValue: JSON.stringify(messages) } }],
      events: [],
      links: [],
      status: { message: null, code: null },
      droppedAttributesCount: 0,
      droppedEventsCount: 0,
      droppedLinksCount: 0,
    } as RecordSpanCommandData["span"],
    resource: null,
    instrumentationScope: null,
    occurredAt: Date.now(),
  };
}

const sizeOf = (data: RecordSpanCommandData) => Buffer.byteLength(JSON.stringify(data), "utf8");

describe("the ingest path's payload preparation", () => {
  describe("given a span whose only oversized content is a 2 MB inline audio part", () => {
    /** @scenario "Extraction before the spool check keeps the queue light" */
    it("externalizes the media first, so the spool never has to write anything", async () => {
      const command = commandWithAudio(2 * 1024 * 1024);
      expect(sizeOf(command)).toBeGreaterThan(COMMAND_INLINE_THRESHOLD);

      const putSpool = vi.fn();
      const prepared = await TraceEdgeMediaPayloadService.create({
        deps: {
          featureFlags: { isEnabled: async () => true } as never as FeatureFlagApi,
          hasContentDropRules: async () => false,
          service: fakeStore(),
        },
        logger: { info: vi.fn(), warn: vi.fn() },
        next: TraceEdgeSpoolService.create({
          spool: { putSpool },
          logger: { warn: vi.fn() } as never,
        }),
      }).prepare(command);

      expect(sizeOf(prepared)).toBeLessThan(COMMAND_INLINE_THRESHOLD);
      // The whole point of the order: the transient spool object is never
      // written, so the queue carries a reference to durable storage instead
      // of a second, throwaway copy of the same bytes.
      expect(putSpool).not.toHaveBeenCalled();
      expect(prepared.span.attributes).not.toEqual(command.span.attributes);
    });
  });
});
