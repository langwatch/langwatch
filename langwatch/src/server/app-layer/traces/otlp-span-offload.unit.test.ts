import { describe, it, expect, vi } from "vitest";
import { offloadOtlpSpanAttributes } from "./otlp-span-offload";
import { BLOB_REF_ATTR_PREFIX } from "./blob-ref-attributes";
import type { BlobStore, TraceBlobRef } from "./blob-store.service";
import type { OtlpKeyValue } from "../../event-sourcing/pipelines/trace-processing/schemas/otlp";

function fakeBlobStore() {
  const put = vi.fn(
    async (a: {
      projectId: string;
      traceId: string;
      spanId: string;
      attrKey: string;
      value: string;
    }): Promise<TraceBlobRef> => ({
      key: `trace-blobs/${a.projectId}/${a.traceId}/${a.spanId}/${a.attrKey}`,
      size: Buffer.byteLength(a.value, "utf-8"),
      sha256: "sha",
      encoding: "utf-8",
    }),
  );
  return { put } as unknown as BlobStore & { put: typeof put };
}

const base = { projectId: "p", traceId: "t", spanId: "s" };

describe("offloadOtlpSpanAttributes", () => {
  describe("given a span with an over-threshold stringValue attribute", () => {
    it("replaces it with a preview and appends a reserved ref attribute", async () => {
      const blob = fakeBlobStore();
      const attributes: OtlpKeyValue[] = [
        { key: "langwatch.output", value: { stringValue: "Z".repeat(5000) } },
        { key: "gen_ai.system", value: { stringValue: "openai" } },
      ];

      const out = await offloadOtlpSpanAttributes({
        ...base,
        attributes,
        blobStore: blob,
        thresholdBytes: 100,
        previewBytes: 16,
      });

      const output = out.find((kv) => kv.key === "langwatch.output")!;
      expect(output.value.stringValue!.length).toBeLessThan(5000);
      // small attr untouched
      expect(out.find((kv) => kv.key === "gen_ai.system")!.value.stringValue).toBe("openai");
      // reserved ref appended with a parseable ref
      const refKv = out.find(
        (kv) => kv.key === `${BLOB_REF_ATTR_PREFIX}langwatch.output`,
      )!;
      expect(refKv).toBeDefined();
      const ref = JSON.parse(refKv.value.stringValue!);
      expect(ref.key).toBe("trace-blobs/p/t/s/langwatch.output");
      expect(ref.size).toBe(5000);
      expect(blob.put).toHaveBeenCalledTimes(1);
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
        key: "trace-blobs/victim-project/trace-x/span-x/langwatch.output",
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
});
