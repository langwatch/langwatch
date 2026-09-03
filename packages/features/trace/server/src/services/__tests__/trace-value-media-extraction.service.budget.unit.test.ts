/**
 * @vitest-environment node
 *
 * The generic value media walker's BUDGET and MARKER GATE
 * (specs/trace-processing/trace-media-blob-extraction.feature).
 *
 * A fake media store records every storeFromBytes call and returns
 * deterministic ids; the walker, the visitor dispatch, and the per-part
 * rewriting are the production code.
 */
import { containsMediaMarkers } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import type { TraceMediaStorePort } from "../../ports/trace-media-store.port";
import {
  createExtractionBudget,
  extractInlineMediaFromValue,
  MAX_MEDIA_PARTS_PER_SPAN,
} from "../trace-value-media-extraction.service";

interface StoredCall {
  mediaType: string;
  bytes: Buffer;
}

function makeFakeService(): { service: TraceMediaStorePort; calls: StoredCall[] } {
  const calls: StoredCall[] = [];
  const service = {
    storeFromBytes: async ({ mediaType, bytes }: { mediaType: string; bytes: Buffer }) => {
      calls.push({ mediaType, bytes });
      return { id: `so-${calls.length}`, mediaType, isDuplicate: false };
    },
  } as unknown as TraceMediaStorePort;
  return { service, calls };
}

const PARAMS = {
  projectId: "proj-1",
  purpose: "trace_content",
  ownerKind: "trace",
  ownerId: "trace-1",
} as const;

describe("extraction budget", () => {
  const imagePart = (i: number) => ({
    type: "image_url",
    image_url: { url: `data:image/png;base64,QUJD${i}A` },
  });
  const contentWith = (count: number) => [
    {
      role: "user",
      content: Array.from({ length: count }, (_, i) => imagePart(i)),
    },
  ];

  describe("given more inline parts than the per-span cap", () => {
    /** @scenario Extraction cost inside the collector request is bounded */
    it("externalizes at most the cap and leaves the rest inline, counted", async () => {
      const { service, calls } = makeFakeService();
      const budget = createExtractionBudget();
      const value = contentWith(MAX_MEDIA_PARTS_PER_SPAN + 4);

      const result = await extractInlineMediaFromValue({
        value,
        service,
        budget,
        ...PARAMS,
      } as never);

      expect(calls).toHaveLength(MAX_MEDIA_PARTS_PER_SPAN);
      expect(result.refs).toHaveLength(MAX_MEDIA_PARTS_PER_SPAN);
      expect(budget.droppedByCap).toBe(4);
      const parts = (result.value as Array<{ content: Array<{ image_url: { url: string } }> }>)[0]!
        .content;
      const externalized = parts.filter((p) => p.image_url.url.startsWith("/api/files/"));
      const inline = parts.filter((p) => p.image_url.url.startsWith("data:"));
      expect(externalized).toHaveLength(MAX_MEDIA_PARTS_PER_SPAN);
      expect(inline).toHaveLength(4);
    });
  });
});

describe("the marker gate", () => {
  describe("given an attribute value that carries no media-part vocabulary", () => {
    /** @scenario Attributes without media markers are never parsed or rewritten */
    it("never trips the marker gate, stores nothing and hands the value back by identity", async () => {
      const { service, calls } = makeFakeService();
      const plain = [{ role: "user", content: 'just words, and a nested string: {"answer": 42}' }];
      const serialized = JSON.stringify(plain);

      expect(containsMediaMarkers(serialized)).toBe(false);

      const result = await extractInlineMediaFromValue({
        value: plain,
        service,
        ...PARAMS,
      } as never);

      expect(calls).toHaveLength(0);
      expect(result.refs).toEqual([]);
      expect(result.value).toBe(plain);
    });
  });
});
