import { containsMediaMarkers } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

/**
 * @vitest-environment node
 * Spec: specs/trace-processing/trace-media-blob-extraction.feature
 * Tests BUDGET and MARKER GATE; production code with a faked media store.
 */
import {
  MAX_MEDIA_PARTS_PER_SPAN,
  TraceMediaExtractionService,
} from "../trace-media-extraction.service.ts";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import type { TraceMediaStore } from "../trace-media-store.service.ts";

interface StoredCall {
  mediaType: string;
  bytes: Buffer;
}

function makeFakeService(): { service: TraceMediaStore; calls: StoredCall[] } {
  const calls: StoredCall[] = [];
  const service: TraceMediaStore = {
    purpose: "trace_content",
    ownerKind: "trace",
    storeFromBytes: async ({ mediaType, bytes }: { mediaType: string; bytes: Buffer }) => {
      calls.push({ mediaType, bytes });
      return { id: `so-${calls.length}`, isDuplicate: false };
    },
  };
  return { service, calls };
}

const PARAMS = { projectId: "proj-1", ownerId: "trace-1" } as const;

function extractionOver(store: TraceMediaStore): TraceMediaExtractionService {
  return TraceMediaExtractionService.create({ store });
}

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
      const budget = extractionOver(service).createExtractionBudget();
      const value = contentWith(MAX_MEDIA_PARTS_PER_SPAN + 4);

      const result = await extractionOver(service).extractFromValue({
        value,
        budget,
        ...PARAMS,
      });

      expect(calls).toHaveLength(MAX_MEDIA_PARTS_PER_SPAN);
      expect(result.refs).toHaveLength(MAX_MEDIA_PARTS_PER_SPAN);
      expect(budget.droppedByCap).toBe(4);
      const parts = (result.value as { content: { image_url: { url: string } }[] }[])[0]!.content;
      const externalized = parts.filter((p) => p.image_url.url.startsWith("/api/files/"));
      const inline = parts.filter((p) => p.image_url.url.startsWith("data:"));
      expect(externalized).toHaveLength(MAX_MEDIA_PARTS_PER_SPAN);
      expect(inline).toHaveLength(4);
    });
  });

  describe("given a large store still in flight when the span's deadline passes", () => {
    /** @scenario A recording that takes longer to store than the span's deadline is kept */
    it("waits for it within the store ceiling and keeps its reference", async () => {
      const store: TraceMediaStore = {
        purpose: "trace_content",
        ownerKind: "trace",
        storeFromBytes: async () => {
          await new Promise((resolve) => setTimeout(resolve, 80));
          return { id: "so-large", isDuplicate: false };
        },
      };
      const extraction = extractionOver(store);
      const budget = { ...extraction.createExtractionBudget(), deadlineAt: Date.now() + 20 };

      const result = await extraction.extractFromValue({
        value: contentWith(1),
        budget,
        ...PARAMS,
      });

      expect(budget.droppedByDeadline).toBe(0);
      expect(result.refs.map((ref) => ref.id)).toEqual(["so-large"]);
      const parts = (result.value as { content: { image_url: { url: string } }[] }[])[0]!.content;
      expect(parts[0]!.image_url.url).toMatch(/^\/api\/files\//);
    });
  });

  describe("given a store still in flight past the store ceiling", () => {
    /** @scenario Extraction cost inside the collector request is bounded */
    it("leaves that part inline, counts it as a deadline drop and ignores its late answer", async () => {
      let finishLate: () => void = () => {};
      let calls = 0;
      const store: TraceMediaStore = {
        purpose: "trace_content",
        ownerKind: "trace",
        storeFromBytes: async () => {
          calls += 1;
          const id = `so-${calls}`;
          if (calls === 2) await new Promise<void>((resolve) => (finishLate = resolve));
          return { id, isDuplicate: false };
        },
      };
      const extraction = extractionOver(store);
      const budget = {
        ...extraction.createExtractionBudget(),
        deadlineAt: Date.now() + 50,
        storeCeilingMs: 50,
      };

      const result = await extraction.extractFromValue({
        value: contentWith(2),
        budget,
        ...PARAMS,
      });
      finishLate();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(budget.droppedByDeadline).toBe(1);
      expect(result.refs.map((ref) => ref.id)).toEqual(["so-1"]);
      const parts = (result.value as { content: { image_url: { url: string } }[] }[])[0]!.content;
      expect(parts[0]!.image_url.url).toMatch(/^\/api\/files\//);
      expect(parts[1]!.image_url.url).toMatch(/^data:/);
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

      const result = await extractionOver(service).extractFromValue({
        value: plain,
        ...PARAMS,
      });

      expect(calls).toHaveLength(0);
      expect(result.refs).toEqual([]);
      expect(result.value).toBe(plain);
    });
  });
});
