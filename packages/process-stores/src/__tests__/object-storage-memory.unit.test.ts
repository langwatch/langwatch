import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { memoryObjectStorage } from "../object-storage-memory.ts";

async function* bytes(values: number[]): AsyncIterable<Uint8Array> {
  yield new Uint8Array(values);
}

async function readAll(stream: AsyncIterable<Uint8Array>): Promise<number[]> {
  const out: number[] = [];
  for await (const chunk of stream) out.push(...chunk);
  return out;
}

describe("given the memory object storage", () => {
  describe("when two projects write the same key", () => {
    /** @scenario "Object storage is addressed by project and key together" */
    it("keeps them apart, as the routed member does", async () => {
      const storage = memoryObjectStorage();
      const facts = { byteLength: 1, contentType: "application/octet-stream" };

      await storage.write({ projectId: "one", key: "report" }, bytes([1]), facts);
      await storage.write({ projectId: "two", key: "report" }, bytes([2]), facts);

      await expect(
        readAll(await storage.read({ projectId: "one", key: "report" })),
      ).resolves.toEqual([1]);
      await storage.remove({ projectId: "one", key: "report" });
      await expect(storage.read({ projectId: "one", key: "report" })).rejects.toMatchObject({
        name: "StoredObjectNotFoundError",
      });
      await expect(
        readAll(await storage.read({ projectId: "two", key: "report" })),
      ).resolves.toEqual([2]);
    });
  });

  describe("when a download URL is asked for", () => {
    /** @scenario "The memory twin answers a deterministic download URL" */
    it("answers the same URL for the same address and expiry", async () => {
      const storage = memoryObjectStorage();
      const at = { projectId: "project-1", key: "staged/payload.json" };
      const facts = { expiresAt: Temporal.Instant.from("2026-09-24T12:15:00Z") };

      const url = await storage.signDownload(at, facts);

      await expect(storage.signDownload(at, facts)).resolves.toBe(url);
      expect(url).toBe(
        "memory://object-storage/project-1/staged/payload.json?expires=2026-09-24T12%3A15%3A00Z",
      );
    });
  });
});
