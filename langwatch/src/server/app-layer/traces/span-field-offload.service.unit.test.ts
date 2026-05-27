import { describe, it, expect, vi } from "vitest";
import {
  SpanFieldOffloadService,
  utf8Preview,
  DEFAULT_PREVIEW_BYTES,
} from "./span-field-offload.service";
import type { BlobStore, TraceBlobRef } from "./blob-store.service";

function fakeBlobStore() {
  const put = vi.fn(
    async ({
      traceId,
      spanId,
      attrKey,
      value,
    }: {
      projectId: string;
      traceId: string;
      spanId: string;
      attrKey: string;
      value: string;
    }): Promise<TraceBlobRef> => ({
      key: `trace-blobs/p/${traceId}/${spanId}/${attrKey}`,
      size: Buffer.byteLength(value, "utf-8"),
      sha256: "deadbeef",
      encoding: "utf-8",
    }),
  );
  return { put } as unknown as BlobStore & { put: typeof put };
}

const coords = { projectId: "p", traceId: "t", spanId: "s" };

describe("SpanFieldOffloadService", () => {
  describe("given a threshold of 100 bytes", () => {
    describe("when a field exceeds the threshold", () => {
      it("offloads the value and replaces it with a bounded preview + records a ref", async () => {
        const blob = fakeBlobStore();
        const svc = new SpanFieldOffloadService(blob, {
          thresholdBytes: 100,
          previewBytes: 16,
        });
        const big = "X".repeat(5000);

        const { attributes, blobRefs } = await svc.offload({
          ...coords,
          attributes: { "langwatch.output": big, "gen_ai.system": "openai" },
        });

        // big value offloaded
        expect(blob.put).toHaveBeenCalledTimes(1);
        expect(blobRefs["langwatch.output"]).toBeDefined();
        expect(blobRefs["langwatch.output"]!.size).toBe(5000);
        // inline value is now a bounded preview, not the full text
        expect(attributes["langwatch.output"]!.length).toBeLessThan(big.length);
        expect(Buffer.byteLength(attributes["langwatch.output"]!, "utf-8"))
          .toBeLessThanOrEqual(16 + 4 /* ellipsis */);
        // small value untouched, no ref
        expect(attributes["gen_ai.system"]).toBe("openai");
        expect(blobRefs["gen_ai.system"]).toBeUndefined();
      });
    });

    describe("when all fields are under the threshold", () => {
      it("offloads nothing and passes attributes through unchanged", async () => {
        const blob = fakeBlobStore();
        const svc = new SpanFieldOffloadService(blob, { thresholdBytes: 100 });

        const attrs = { a: "small", b: "also small" };
        const { attributes, blobRefs } = await svc.offload({
          ...coords,
          attributes: attrs,
        });

        expect(blob.put).not.toHaveBeenCalled();
        expect(attributes).toEqual(attrs);
        expect(blobRefs).toEqual({});
      });
    });

    describe("when multiple fields exceed the threshold", () => {
      it("offloads each independently with its own ref", async () => {
        const blob = fakeBlobStore();
        const svc = new SpanFieldOffloadService(blob, { thresholdBytes: 100 });

        const { blobRefs } = await svc.offload({
          ...coords,
          attributes: {
            "langwatch.input": "I".repeat(2000),
            "langwatch.output": "O".repeat(2000),
          },
        });

        expect(blob.put).toHaveBeenCalledTimes(2);
        expect(Object.keys(blobRefs).sort()).toEqual([
          "langwatch.input",
          "langwatch.output",
        ]);
      });
    });
  });

  describe("utf8Preview", () => {
    it("returns the value unchanged when within the byte budget", () => {
      expect(utf8Preview("hello", 100)).toBe("hello");
    });

    it("truncates to the byte budget without splitting a multibyte codepoint", () => {
      // "🌍" is 4 UTF-8 bytes; budget of 2 must not emit a broken codepoint
      const out = utf8Preview("🌍🌍🌍", 2);
      expect(out.endsWith("…")).toBe(true);
      // valid UTF-8 (no U+FFFD replacement chars from a mid-codepoint cut)
      expect(out).not.toContain("�");
    });

    it("defaults preview budget to 2 KB", () => {
      const out = utf8Preview("Z".repeat(10_000), DEFAULT_PREVIEW_BYTES);
      expect(Buffer.byteLength(out, "utf-8")).toBeLessThanOrEqual(
        DEFAULT_PREVIEW_BYTES + 4,
      );
    });
  });
});
