/**
 * @vitest-environment node
 * The recorded address is caller data: every member call is held to the
 * project the caller asked about before the member is reached.
 */
import { memoryObjectStorage, type ObjectStorage } from "@langwatch/process-stores";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type { StoredObjectStorageAddress } from "../../app/stored-object.members.ts";
import { StoredObjectStorageService } from "../stored-object-storage.service.ts";

/** The memory twin, counting every call that reached it. */
function recordingStorage() {
  const inner = memoryObjectStorage();
  const reached: string[] = [];
  const objectStorage: ObjectStorage = {
    write: (at, body, facts) => {
      reached.push("write");
      return inner.write(at, body, facts);
    },
    read: (at) => {
      reached.push("read");
      return inner.read(at);
    },
    digest: (at) => {
      reached.push("digest");
      return inner.digest(at);
    },
    remove: (at) => {
      reached.push("remove");
      return inner.remove(at);
    },
    signUpload: (at, facts) => {
      reached.push("signUpload");
      return inner.signUpload(at, facts);
    },
    destination: (projectId) => inner.destination(projectId),
    probe: (projectId) => inner.probe(projectId),
  };

  return { reached, storage: StoredObjectStorageService.create({ objectStorage }) };
}

async function* bytes(text: string): AsyncGenerator<Uint8Array> {
  yield new TextEncoder().encode(text);
}

async function textOf(stream: AsyncIterable<Uint8Array> | null): Promise<string | null> {
  if (!stream) return null;
  let text = "";
  for await (const chunk of stream) text += new TextDecoder().decode(chunk);
  return text;
}

const otherProjects: readonly StoredObjectStorageAddress[] = [
  { provider: "memory", destinationId: "memory", relativeId: "project-2/object-1" },
  { provider: "memory", destinationId: "memory", relativeId: "object-1" },
];

describe("StoredObjectStorageService", () => {
  describe("given an object held for the requesting project", () => {
    it("reads it back at its recorded address", async () => {
      const { storage } = recordingStorage();
      const { address } = await storage.place({ projectId: "project-1", objectId: "object-1" });
      await storage.write({
        projectId: "project-1",
        address,
        body: bytes("hello"),
        byteLength: 5,
        mediaType: "text/plain",
      });

      await expect(
        textOf(await storage.tryRead({ projectId: "project-1", address })),
      ).resolves.toBe("hello");
    });
  });

  describe.each(otherProjects)("given an address outside the project ($relativeId)", (address) => {
    it("does not read another project through a caller-supplied project address", async () => {
      const { storage, reached } = recordingStorage();

      await expect(storage.tryRead({ projectId: "project-1", address })).rejects.toThrow(
        "outside the requested project",
      );
      await expect(storage.tryStat({ projectId: "project-1", address })).rejects.toThrow(
        "outside the requested project",
      );
      await expect(storage.delete({ projectId: "project-1", address })).rejects.toThrow(
        "outside the requested project",
      );
      await expect(
        storage.write({
          projectId: "project-1",
          address,
          body: bytes("hello"),
          byteLength: 5,
          mediaType: "text/plain",
        }),
      ).rejects.toThrow("outside the requested project");
      expect(reached).toEqual([]);
    });
  });

  describe.each([
    "project-1/../project-2/object-1",
    "project-1/%2e%2e/project-2/object-1",
    "project-1/%252e%252e/project-2/object-1",
    "project-1\\..\\project-2\\object-1",
    "project-1/\t../project-2/object-1",
    "project-1/../project-2/object?x=1",
    "project-1//object-1",
  ])("given the traversal address %s", (relativeId) => {
    it("refuses it before the member is reached", async () => {
      const { storage, reached } = recordingStorage();
      const address = { provider: "memory", destinationId: "memory", relativeId };

      await expect(storage.tryRead({ projectId: "project-1", address })).rejects.toThrow(
        "outside the requested project",
      );
      expect(reached).toEqual([]);
    });
  });

  describe("given an address naming a provider or destination nothing recorded", () => {
    it("rejects unknown providers and destination injection", async () => {
      const { storage, reached } = recordingStorage();
      const addresses: readonly StoredObjectStorageAddress[] = [
        { provider: "gcs", destinationId: "bucket", relativeId: "project-1/object-1" },
        { provider: "s3", destinationId: "bucket/other", relativeId: "project-1/object-1" },
        { provider: "s3", destinationId: "bucket?x=1", relativeId: "project-1/object-1" },
        { provider: "file", destinationId: "/objects//other", relativeId: "project-1/object-1" },
        {
          provider: "azure-blob",
          destinationId: "account/container/extra",
          relativeId: "project-1/object-1",
        },
        { provider: "azure-blob", destinationId: "account", relativeId: "project-1/object-1" },
      ];

      for (const address of addresses) {
        await expect(storage.tryRead({ projectId: "project-1", address })).rejects.toThrow(
          "invalid provider destination",
        );
        await expect(
          storage.signUpload({
            projectId: "project-1",
            address,
            byteLength: 5,
            mediaType: "text/plain",
            expiresAt: Temporal.Instant.from("2026-09-24T12:15:00Z"),
          }),
        ).rejects.toThrow("invalid provider destination");
      }
      expect(reached).toEqual([]);
    });
  });
});
