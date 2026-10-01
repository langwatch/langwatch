import { createHash } from "node:crypto";
import { chmod, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Temporal } from "@langwatch/time";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ObjectBodyShortError,
  ObjectBodyTooLargeError,
  StorageNotWritableError,
  StoredObjectNotFoundError,
} from "../object-storage-backend.ts";
import { filesystemBackend } from "../object-storage-filesystem.ts";

const CHUNK = 64 * 1024;

async function* bytes(total: number): AsyncGenerator<Uint8Array> {
  for (let sent = 0; sent < total; sent += CHUNK) {
    yield new Uint8Array(Math.min(CHUNK, total - sent)).fill(sent % 251);
  }
}

async function hashOf(stream: AsyncIterable<Uint8Array>): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex");
}

async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
}

describe("given object storage on the local filesystem", () => {
  let root: string;
  const at = { projectId: "project-1", key: "project-1/object-1" };

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "object-storage-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  describe("when a module writes a body of many megabytes", () => {
    /** @scenario "A write counts and hashes a body larger than any buffer while it streams" */
    /** @scenario "Datasets work on a minimal self-hosted install" */
    /** @scenario "A large file uploads on a self-hosted install with no object storage" */
    it("answers its length and SHA-256, and reads the same bytes back", async () => {
      const backend = filesystemBackend({ root });
      const size = 24 * 1024 * 1024 + 7;

      const written = await backend.write(at, bytes(size), {
        byteLength: size,
        contentType: "application/octet-stream",
      });

      expect(written).toEqual({ byteLength: size, sha256: await hashOf(bytes(size)) });
      expect(await hashOf(await backend.read(at))).toBe(written.sha256);
    });
  });

  describe("when the body runs past its declared length", () => {
    /** @scenario "A body longer than its declared length is refused and leaves no file" */
    it("refuses and leaves nothing behind", async () => {
      const backend = filesystemBackend({ root });

      await expect(
        backend.write(at, bytes(CHUNK + 1), { byteLength: CHUNK, contentType: "text/plain" }),
      ).rejects.toBeInstanceOf(ObjectBodyTooLargeError);
      expect(await filesUnder(root)).toEqual([]);
    });

    it("refuses a body that ends early", async () => {
      const backend = filesystemBackend({ root });

      await expect(
        backend.write(at, bytes(10), { byteLength: 11, contentType: "text/plain" }),
      ).rejects.toBeInstanceOf(ObjectBodyShortError);
      expect(await filesUnder(root)).toEqual([]);
    });
  });

  describe("when the digest of a written object is asked for", () => {
    /** @scenario "Confirm reads the digest the filesystem write kept" */
    it("answers the digest the write kept", async () => {
      const backend = filesystemBackend({ root });
      const written = await backend.write(at, bytes(1000), {
        byteLength: 1000,
        contentType: "text/plain",
      });

      await expect(backend.digest(at)).resolves.toEqual(written);
      expect(await filesUnder(path.join(root, ".digests"))).toEqual(["object-1"]);
    });
  });

  describe("when the object is removed", () => {
    it("reads as absent afterwards, and removing again is not an error", async () => {
      const backend = filesystemBackend({ root });
      await backend.write(at, bytes(10), { byteLength: 10, contentType: "text/plain" });

      await backend.remove(at);
      await backend.remove(at);

      await expect(backend.read(at)).rejects.toBeInstanceOf(StoredObjectNotFoundError);
      expect(await filesUnder(root)).toEqual([]);
    });
  });

  describe("when a key would leave the root", () => {
    it.each(["../escape", "project-1/../../escape", ".digests/project-1/object-1", "a//b"])(
      "refuses %s",
      async (key) => {
        const backend = filesystemBackend({ root });

        await expect(backend.read({ projectId: "project-1", key })).rejects.toThrow(
          "does not name a path under the storage root",
        );
      },
    );
  });

  describe("when an upload URL is asked for", () => {
    it("answers that the upload goes through the process", async () => {
      const backend = filesystemBackend({ root });

      await expect(
        backend.signUpload(at, {
          byteLength: 1,
          contentType: "text/plain",
          expiresAt: Temporal.Now.instant().add({ seconds: 60 }),
        }),
      ).resolves.toEqual({ kind: "through-process" });
    });
  });

  describe("when a download URL is asked for", () => {
    /** @scenario "Filesystem storage refuses to sign a download URL" */
    it("refuses, since no remote reader can reach the directory", async () => {
      const backend = filesystemBackend({ root });

      await expect(
        backend.signDownload(at, { expiresAt: Temporal.Now.instant().add({ seconds: 60 }) }),
      ).rejects.toMatchObject({ name: "UnsignableDownloadError", locationKind: "file" });
    });
  });

  describe("when the root refuses writes", () => {
    const runsAsRoot = process.getuid?.() === 0;

    async function refusal(): Promise<unknown> {
      await chmod(root, 0o500);
      try {
        await filesystemBackend({ root }).write(at, bytes(5), {
          byteLength: 5,
          contentType: "text/plain",
        });
        return undefined;
      } catch (error) {
        return error;
      } finally {
        await chmod(root, 0o700);
      }
    }

    /** @scenario "The refusal carries the storage_not_writable code" */
    it.skipIf(runsAsRoot)("refuses with storage_not_writable, a platform fault", async () => {
      const error = await refusal();

      expect(error).toBeInstanceOf(StorageNotWritableError);
      expect(error).toMatchObject({ code: "storage_not_writable", fault: "platform" });
    });

    /** @scenario "The message names no environment variable and no path" */
    it.skipIf(runsAsRoot)("ships a message naming neither the root nor a setting", async () => {
      const error = await refusal();

      if (!(error instanceof Error)) throw new Error("The write was expected to refuse.");
      expect(error.message).not.toContain(root);
      expect(error.message).not.toContain("/");
      expect(error.message).not.toMatch(/[A-Z]+_[A-Z_]+/);
    });
  });

  describe("when the root fails for a reason other than permissions", () => {
    /** @scenario "A permission failure that is not a write refusal stays unknown" */
    it("rethrows the original failure unchanged", async () => {
      const file = path.join(root, "not-a-directory");
      await writeFile(file, "occupied");

      const error: unknown = await filesystemBackend({ root: file })
        .write(at, bytes(5), { byteLength: 5, contentType: "text/plain" })
        .then(
          () => undefined,
          (failure: unknown) => failure,
        );

      expect(error).not.toBeInstanceOf(StorageNotWritableError);
      expect(error).toMatchObject({ code: expect.stringMatching(/^(ENOTDIR|EEXIST)$/) });
    });
  });
});
