import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Temporal } from "@langwatch/time";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  StoredObjectNotFoundError,
  UnreachableStorageLocationError,
} from "../object-storage-backend.ts";
import { buildObjectStorage } from "../object-storage-member.ts";

const clock = { now: () => Temporal.Instant.from("2026-09-24T12:00:00Z") };
const directory = { organizationForTenant: () => Promise.resolve("organization-1") };

async function* body(text: string): AsyncGenerator<Uint8Array> {
  yield new TextEncoder().encode(text);
}

async function textOf(stream: AsyncIterable<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of stream) text += decoder.decode(chunk, { stream: true });
  return text + decoder.decode();
}

describe("given an object recorded under an older filesystem root", () => {
  let olderRoot: string;
  let currentRoot: string;

  beforeEach(async () => {
    olderRoot = await mkdtemp(path.join(tmpdir(), "object-storage-older-"));
    currentRoot = await mkdtemp(path.join(tmpdir(), "object-storage-current-"));
  });

  afterEach(async () => {
    await rm(olderRoot, { recursive: true, force: true });
    await rm(currentRoot, { recursive: true, force: true });
  });

  describe("when the project now writes under a new root", () => {
    /** @scenario "An object keeps being read where it was recorded after the backend moves" */
    it("reads, digests and removes it at its recorded root", async () => {
      const older = buildObjectStorage({
        config: { backend: "file", root: olderRoot },
        clock,
        directory,
      });
      const at = { projectId: "project-1", key: "project-1/object-1" };
      const written = await older.value.write(at, body("kept"), {
        byteLength: 4,
        contentType: "text/plain",
      });

      const current = buildObjectStorage({
        config: { backend: "file", root: currentRoot },
        clock,
        directory,
      });
      const recorded = { ...at, location: { kind: "file", root: olderRoot } } as const;

      expect(await textOf(await current.value.read(recorded))).toBe("kept");
      expect(await current.value.digest(recorded)).toEqual(written);
      await current.value.remove(recorded);
      await expect(older.value.read(at)).rejects.toBeInstanceOf(StoredObjectNotFoundError);
    });
  });
});

describe("given an object recorded on an Azure container this deployment is not configured for", () => {
  describe("when it is read", () => {
    it("refuses by the location's kind rather than reading the current backend", async () => {
      const storage = buildObjectStorage({
        config: { backend: "s3", s3: { bucket: "shared" } },
        clock,
        directory,
      });

      await expect(
        storage.value.read({
          projectId: "project-1",
          key: "project-1/object-1",
          location: { kind: "azure", accountName: "old", container: "objects" },
        }),
      ).rejects.toBeInstanceOf(UnreachableStorageLocationError);
    });
  });
});
