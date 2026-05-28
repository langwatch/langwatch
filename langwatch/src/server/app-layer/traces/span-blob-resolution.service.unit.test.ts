import { describe, it, expect, vi } from "vitest";
import { SpanBlobResolutionService } from "./span-blob-resolution.service";
import type { BlobStore, TraceBlobRef } from "./blob-store.service";

function fakeBlobStore(contents: Record<string, string>) {
  const get = vi.fn(
    async ({ ref }: { projectId: string; ref: TraceBlobRef }) => {
      // Keyed by field value, not manifest key, for test simplicity
      const full = contents[ref.field];
      if (full === undefined) throw new Error(`NoSuchKey: ${ref.field}`);
      return full;
    },
  );
  return { get } as unknown as BlobStore & { get: typeof get };
}

const ref = (field: string): TraceBlobRef => ({
  // All refs for the same span share the same manifest key
  key: "trace-blobs/p/trace-1/span-1",
  field,
  size: 1,
  sha256: "x",
  encoding: "utf-8",
});

describe("SpanBlobResolutionService", () => {
  describe("given attributes with previews and blob refs", () => {
    describe("when resolving", () => {
      it("replaces previewed fields with their full values, leaving others intact", async () => {
        const blob = fakeBlobStore({ "langwatch.output": "F".repeat(40_000) });
        const svc = new SpanBlobResolutionService(blob);

        const out = await svc.resolve({
          projectId: "p",
          attributes: {
            "langwatch.output": "Fpreview… (offloaded)",
            "gen_ai.system": "openai",
          },
          blobRefs: { "langwatch.output": ref("langwatch.output") },
        });

        expect(out["langwatch.output"]).toBe("F".repeat(40_000));
        expect(out["gen_ai.system"]).toBe("openai");
      });
    });
  });

  describe("given no blob refs", () => {
    it("returns attributes unchanged without touching storage", async () => {
      const blob = fakeBlobStore({});
      const svc = new SpanBlobResolutionService(blob);
      const attrs = { a: "1", b: "2" };

      const out = await svc.resolve({
        projectId: "p",
        attributes: attrs,
        blobRefs: {},
      });

      expect(blob.get).not.toHaveBeenCalled();
      expect(out).toEqual(attrs);
    });
  });

  describe("given multiple refs from the same span (same manifest key)", () => {
    describe("when resolving", () => {
      it("calls BlobStore.get once per field (manifest cache is passed for coalescing)", async () => {
        // The manifest cache lives inside SpanBlobResolutionService.resolve;
        // we can only observe the call count, not the cache directly.
        // With a shared manifest cache, a smart BlobStore would only fetch once.
        // Here we assert the get spy call count is exactly 2 (one per field).
        const blob = fakeBlobStore({
          "langwatch.input": "full input value",
          "langwatch.output": "full output value",
        });
        const svc = new SpanBlobResolutionService(blob);

        const out = await svc.resolve({
          projectId: "p",
          attributes: {
            "langwatch.input": "input preview…",
            "langwatch.output": "output preview…",
          },
          blobRefs: {
            "langwatch.input": ref("langwatch.input"),
            "langwatch.output": ref("langwatch.output"),
          },
        });

        // Both fields are resolved correctly
        expect(out["langwatch.input"]).toBe("full input value");
        expect(out["langwatch.output"]).toBe("full output value");

        // get is called once per field (the manifest cache is passed through to
        // BlobStore, which deduplicates the S3 fetch — here get is called per ref
        // but all share the cache so only one network call goes out in the real impl)
        expect(blob.get).toHaveBeenCalledTimes(2);
      });

      it("passes a manifestCache arg so a real BlobStore would coalesce to one S3 fetch", async () => {
        const getCalls: Array<{ ref: TraceBlobRef; manifestCache?: unknown }> = [];
        const stubbedGet = vi.fn(
          async (args: { projectId: string; ref: TraceBlobRef; manifestCache?: unknown }) => {
            getCalls.push(args);
            return `full value for ${args.ref.field}`;
          },
        );
        const blob = { get: stubbedGet } as unknown as BlobStore;
        const svc = new SpanBlobResolutionService(blob);

        await svc.resolve({
          projectId: "p",
          attributes: {
            "langwatch.input": "input preview…",
            "langwatch.output": "output preview…",
          },
          blobRefs: {
            "langwatch.input": ref("langwatch.input"),
            "langwatch.output": ref("langwatch.output"),
          },
        });

        // manifestCache must be passed to every get call — same Map instance
        expect(stubbedGet).toHaveBeenCalledTimes(2);
        const caches = getCalls.map((c) => c.manifestCache);
        // Both calls receive a Map (not undefined)
        expect(caches[0]).toBeInstanceOf(Map);
        // Both calls receive the SAME Map instance
        expect(caches[0]).toBe(caches[1]);
      });
    });
  });
});
