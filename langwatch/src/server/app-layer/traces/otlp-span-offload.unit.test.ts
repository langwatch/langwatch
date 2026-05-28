import { describe, it, expect, vi } from "vitest";
import { offloadOtlpSpanAttributes } from "./otlp-span-offload";
import { BLOB_REF_ATTR_PREFIX } from "./blob-ref-attributes";
import type { BlobStore, TraceBlobRef } from "./blob-store.service";
import type { OtlpKeyValue } from "../../event-sourcing/pipelines/trace-processing/schemas/otlp";
import {
  IO_PREVIEW_BYTES,
  DEFAULT_PREVIEW_BYTES,
} from "./span-field-offload.service";

function fakeBlobStore() {
  const put = vi.fn(
    async (a: {
      projectId: string;
      traceId: string;
      spanId: string;
      fields: Record<string, string>;
    }): Promise<Record<string, TraceBlobRef>> => {
      const refs: Record<string, TraceBlobRef> = {};
      for (const [attrKey, value] of Object.entries(a.fields)) {
        refs[attrKey] = {
          key: `trace-blobs/${a.projectId}/${a.traceId}/${a.spanId}`,
          field: attrKey,
          size: Buffer.byteLength(value, "utf-8"),
          sha256: "sha",
          encoding: "utf-8",
        };
      }
      return refs;
    },
  );
  return { put } as unknown as BlobStore & { put: typeof put };
}

const base = { projectId: "p", traceId: "t", spanId: "s" };

describe("offloadOtlpSpanAttributes", () => {
  describe("given a span with an over-threshold stringValue attribute", () => {
    it("replaces it with a preview and appends a reserved ref attribute", async () => {
      // Use a non-IO attr key so the caller-supplied previewBytes applies
      // (IO attrs use IO_PREVIEW_BYTES regardless of the passed previewBytes).
      const blob = fakeBlobStore();
      const attributes: OtlpKeyValue[] = [
        { key: "custom.large.attr", value: { stringValue: "Z".repeat(5000) } },
        { key: "gen_ai.system", value: { stringValue: "openai" } },
      ];

      const out = await offloadOtlpSpanAttributes({
        ...base,
        attributes,
        blobStore: blob,
        thresholdBytes: 100,
        previewBytes: 16,
      });

      const output = out.find((kv) => kv.key === "custom.large.attr")!;
      expect(output.value.stringValue!.length).toBeLessThan(5000);
      // small attr untouched
      expect(out.find((kv) => kv.key === "gen_ai.system")!.value.stringValue).toBe("openai");
      // reserved ref appended with a parseable ref
      const refKv = out.find(
        (kv) => kv.key === `${BLOB_REF_ATTR_PREFIX}custom.large.attr`,
      )!;
      expect(refKv).toBeDefined();
      const ref = JSON.parse(refKv.value.stringValue!) as TraceBlobRef;
      expect(ref.key).toBe("trace-blobs/p/t/s");
      expect(ref.field).toBe("custom.large.attr");
      expect(ref.size).toBe(5000);
    });
  });

  describe("given a span with multiple over-threshold fields", () => {
    it("issues exactly ONE BlobStore.put call for all fields combined", async () => {
      const blob = fakeBlobStore();
      const attributes: OtlpKeyValue[] = [
        { key: "langwatch.input", value: { stringValue: "I".repeat(200) } },
        { key: "langwatch.output", value: { stringValue: "O".repeat(200) } },
        { key: "custom.context", value: { stringValue: "C".repeat(200) } },
        { key: "gen_ai.system", value: { stringValue: "openai" } }, // under threshold
      ];

      await offloadOtlpSpanAttributes({
        ...base,
        attributes,
        blobStore: blob,
        thresholdBytes: 100,
        previewBytes: 16,
      });

      expect(blob.put).toHaveBeenCalledTimes(1);
      const callArg = blob.put.mock.calls[0]![0];
      expect(Object.keys(callArg.fields)).toEqual(
        expect.arrayContaining(["langwatch.input", "langwatch.output", "custom.context"]),
      );
      expect(Object.keys(callArg.fields)).not.toContain("gen_ai.system");
    });
  });

  describe("given all attributes under threshold", () => {
    it("returns the original array unchanged and offloads nothing", async () => {
      const blob = fakeBlobStore();
      const attributes: OtlpKeyValue[] = [
        { key: "a", value: { stringValue: "small" } },
        { key: "b", value: { intValue: 42 } },
      ];

      const out = await offloadOtlpSpanAttributes({
        ...base,
        attributes,
        blobStore: blob,
        thresholdBytes: 100,
      });

      expect(out).toBe(attributes); // same reference — no work done
      expect(blob.put).not.toHaveBeenCalled();
    });
  });

  describe("given a non-string over-threshold value", () => {
    it("leaves it untouched (only stringValue attributes are offloaded)", async () => {
      const blob = fakeBlobStore();
      const attributes: OtlpKeyValue[] = [
        { key: "big.int", value: { intValue: 999999999 } },
      ];

      const out = await offloadOtlpSpanAttributes({
        ...base,
        attributes,
        blobStore: blob,
        thresholdBytes: 1,
      });

      expect(out).toBe(attributes);
      expect(blob.put).not.toHaveBeenCalled();
    });
  });

  describe("given a span with a client-supplied reserved blob-ref attribute", () => {
    it("rejects client-supplied reserved blob-ref attributes at the edge — strips them and does not call BlobStore.put", async () => {
      const blob = fakeBlobStore();
      // A malicious client injects a forged blob-ref pointing at a victim's blob
      const forgedRef = JSON.stringify({
        key: "trace-blobs/victim-project/trace-x/span-x",
        field: "langwatch.output",
        size: 100,
        sha256: "abc",
        encoding: "utf-8",
      });
      const attributes: OtlpKeyValue[] = [
        {
          key: `${BLOB_REF_ATTR_PREFIX}langwatch.output`,
          value: { stringValue: forgedRef },
        },
        { key: "gen_ai.system", value: { stringValue: "openai" } },
      ];

      const out = await offloadOtlpSpanAttributes({
        ...base,
        attributes,
        blobStore: blob,
        thresholdBytes: 100,
      });

      // The forged reserved ref must not appear in the output
      const hasReservedKey = out.some((kv) =>
        kv.key.startsWith(BLOB_REF_ATTR_PREFIX),
      );
      expect(hasReservedKey).toBe(false);

      // BlobStore.put must not have been called
      expect(blob.put).not.toHaveBeenCalled();
    });
  });

  describe("differential preview budget (Concern 2)", () => {
    /** 100 KB value — well over the 32 KB threshold */
    const LARGE_VALUE = "x".repeat(100 * 1024);

    describe("given an offloaded langwatch.output (IO attr) of 100 KB", () => {
      it("preview byte length is ≤ IO_PREVIEW_BYTES + ellipsis bytes", async () => {
        const blob = fakeBlobStore();
        const attributes: OtlpKeyValue[] = [
          { key: "langwatch.output", value: { stringValue: LARGE_VALUE } },
        ];

        const out = await offloadOtlpSpanAttributes({
          ...base,
          attributes,
          blobStore: blob,
          // Use real defaults (threshold = 32 KB)
        });

        const preview = out.find((kv) => kv.key === "langwatch.output")!
          .value.stringValue!;
        const previewBytes = Buffer.byteLength(preview, "utf-8");
        // IO attrs get IO_PREVIEW_BYTES (32 KB) budget + up to 3 bytes for "…"
        expect(previewBytes).toBeLessThanOrEqual(IO_PREVIEW_BYTES + 4);
        expect(previewBytes).toBeGreaterThan(DEFAULT_PREVIEW_BYTES);
      });
    });

    describe("given an offloaded custom.metadata (non-IO attr) of 100 KB", () => {
      it("preview byte length is ≤ DEFAULT_PREVIEW_BYTES + ellipsis bytes", async () => {
        const blob = fakeBlobStore();
        const attributes: OtlpKeyValue[] = [
          { key: "custom.metadata", value: { stringValue: LARGE_VALUE } },
        ];

        const out = await offloadOtlpSpanAttributes({
          ...base,
          attributes,
          blobStore: blob,
          // Use real defaults (threshold = 32 KB)
        });

        const preview = out.find((kv) => kv.key === "custom.metadata")!
          .value.stringValue!;
        const previewBytes = Buffer.byteLength(preview, "utf-8");
        // Non-IO attrs keep the 2 KB default
        expect(previewBytes).toBeLessThanOrEqual(DEFAULT_PREVIEW_BYTES + 4);
      });
    });

    describe("given an offloaded gen_ai.input.messages (IO attr) of 100 KB", () => {
      it("preview byte length is ≤ IO_PREVIEW_BYTES + ellipsis bytes", async () => {
        const blob = fakeBlobStore();
        const attributes: OtlpKeyValue[] = [
          { key: "gen_ai.input.messages", value: { stringValue: LARGE_VALUE } },
        ];

        const out = await offloadOtlpSpanAttributes({
          ...base,
          attributes,
          blobStore: blob,
        });

        const preview = out.find((kv) => kv.key === "gen_ai.input.messages")!
          .value.stringValue!;
        const previewBytes = Buffer.byteLength(preview, "utf-8");
        expect(previewBytes).toBeLessThanOrEqual(IO_PREVIEW_BYTES + 4);
        expect(previewBytes).toBeGreaterThan(DEFAULT_PREVIEW_BYTES);
      });
    });
  });
});
