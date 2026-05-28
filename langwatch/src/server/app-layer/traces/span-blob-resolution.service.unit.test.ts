import { describe, it, expect, vi } from "vitest";
import { SpanBlobResolutionService } from "./span-blob-resolution.service";
import type { BlobStore, TraceBlobRef } from "./blob-store.service";

function fakeBlobStore(contents: Record<string, string>) {
  const get = vi.fn(
    async ({ ref }: { projectId: string; ref: TraceBlobRef }) => {
      const full = contents[ref.key];
      if (full === undefined) throw new Error(`NoSuchKey: ${ref.key}`);
      return full;
    },
  );
  return { get } as unknown as BlobStore & { get: typeof get };
}

const ref = (key: string): TraceBlobRef => ({
  key,
  size: 1,
  sha256: "x",
  encoding: "utf-8",
});

describe("SpanBlobResolutionService", () => {
  describe("given attributes with previews and blob refs", () => {
    describe("when resolving", () => {
      it("replaces previewed fields with their full values, leaving others intact", async () => {
        const blob = fakeBlobStore({ "k/out": "F".repeat(40_000) });
        const svc = new SpanBlobResolutionService(blob);

        const out = await svc.resolve({
          projectId: "p",
          attributes: {
            "langwatch.output": "Fpreview… (offloaded)",
            "gen_ai.system": "openai",
          },
          blobRefs: { "langwatch.output": ref("k/out") },
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
});
