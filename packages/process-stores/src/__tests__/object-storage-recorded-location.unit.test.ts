import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Temporal } from "@langwatch/time";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ObjectStorageDestination } from "../members.ts";
import { UnreachableStorageLocationError } from "../object-storage-backend.ts";
import { buildObjectStorage } from "../object-storage-member.ts";

const clock = { now: () => Temporal.Instant.from("2026-09-24T12:00:00Z") };
const directory = { organizationForTenant: () => Promise.resolve("organization-1") };
const expiresAt = Temporal.Instant.from("2026-09-24T12:15:00Z");
const account = {
  region: "eu-west-1",
  credentials: { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "secret" },
};

async function* body(text: string): AsyncGenerator<Uint8Array> {
  yield new TextEncoder().encode(text);
}

async function textOf(stream: AsyncIterable<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of stream) text += decoder.decode(chunk, { stream: true });
  return text + decoder.decode();
}

/** Two organizations on their own S3 accounts; any other organization on the shared bucket. */
function multiTenantStorage() {
  const organizations: Record<string, string> = {
    "project-1": "organization-1",
    "project-2": "organization-2",
  };
  return buildObjectStorage({
    config: {
      backend: "s3",
      s3: { ...account, bucket: "shared-objects" },
      privateAccounts: [
        { ...account, bucket: "organization-1-objects", organizationId: "organization-1" },
        { ...account, bucket: "organization-2-objects", organizationId: "organization-2" },
      ],
    },
    clock,
    directory: {
      organizationForTenant: (tenant: string) =>
        Promise.resolve(organizations[tenant] ?? "organization-3"),
    },
  }).value;
}

function recordedOn(projectId: string, bucket: string) {
  const location: ObjectStorageDestination = { kind: "s3", bucket };
  return { projectId, key: `${projectId}/object-1`, location };
}

describe("given organizations on their own S3 accounts beside a shared bucket", () => {
  describe("when an object recorded on the project's own account is signed for download", () => {
    /** @scenario "A recorded location resolves to the project's own backend or the shared one" */
    it("signs it on the project's own bucket", async () => {
      const url = await multiTenantStorage().signDownload(
        recordedOn("project-1", "organization-1-objects"),
        { expiresAt },
      );

      expect(url).toContain("organization-1-objects");
    });
  });

  describe("when an object recorded on the shared bucket before the organization moved is signed", () => {
    /** @scenario "A recorded location resolves to the project's own backend or the shared one" */
    it("signs it on the shared bucket", async () => {
      const url = await multiTenantStorage().signDownload(
        recordedOn("project-1", "shared-objects"),
        { expiresAt },
      );

      expect(url).toContain("shared-objects");
    });
  });

  describe("when a project on the shared bucket names its recorded shared location", () => {
    it("signs it on the shared bucket", async () => {
      const url = await multiTenantStorage().signDownload(
        recordedOn("project-3", "shared-objects"),
        { expiresAt },
      );

      expect(url).toContain("shared-objects");
    });
  });

  describe("when a location belongs to another organization's account", () => {
    /** @scenario "A recorded location outside the project's own and shared backends is refused" */
    it("refuses read, digest, remove and download signing alike", async () => {
      const storage = multiTenantStorage();
      for (const at of [
        recordedOn("project-1", "organization-2-objects"),
        recordedOn("project-3", "organization-2-objects"),
      ]) {
        await expect(storage.read(at)).rejects.toBeInstanceOf(UnreachableStorageLocationError);
        await expect(storage.digest(at)).rejects.toBeInstanceOf(UnreachableStorageLocationError);
        await expect(storage.remove(at)).rejects.toBeInstanceOf(UnreachableStorageLocationError);
        await expect(storage.signDownload(at, { expiresAt })).rejects.toBeInstanceOf(
          UnreachableStorageLocationError,
        );
      }
    });
  });

  describe("when a location names a bucket this deployment is not configured for", () => {
    /** @scenario "A recorded location outside the project's own and shared backends is refused" */
    it("refuses rather than reaching it with the shared credentials", async () => {
      await expect(
        multiTenantStorage().signDownload(recordedOn("project-1", "elsewhere"), { expiresAt }),
      ).rejects.toBeInstanceOf(UnreachableStorageLocationError);
    });
  });
});

describe("given object storage on the local filesystem", () => {
  let root: string;
  let otherRoot: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "object-storage-current-"));
    otherRoot = await mkdtemp(path.join(tmpdir(), "object-storage-other-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(otherRoot, { recursive: true, force: true });
  });

  const storage = () =>
    buildObjectStorage({ config: { backend: "file", root }, clock, directory }).value;

  describe("when an object recorded at the configured root is read", () => {
    /** @scenario "A recorded location resolves to the project's own backend or the shared one" */
    it("reads, digests and removes it there", async () => {
      const at = { projectId: "project-1", key: "project-1/object-1" };
      const written = await storage().write(at, body("kept"), {
        byteLength: 4,
        contentType: "text/plain",
      });
      const recorded = { ...at, location: { kind: "file", root } } as const;

      expect(await textOf(await storage().read(recorded))).toBe("kept");
      expect(await storage().digest(recorded)).toEqual(written);
      await storage().remove(recorded);
    });
  });

  describe("when a location names a root other than the configured one", () => {
    /** @scenario "A recorded location outside the project's own and shared backends is refused" */
    it("refuses rather than opening that directory", async () => {
      const recorded = {
        projectId: "project-1",
        key: "project-1/object-1",
        location: { kind: "file", root: otherRoot },
      } as const;

      await expect(storage().read(recorded)).rejects.toBeInstanceOf(
        UnreachableStorageLocationError,
      );
    });
  });

  describe("when a key steps outside the storage root", () => {
    /** @scenario "An object key that leaves its root or container is refused" */
    it("refuses the read and the write", async () => {
      const at = { projectId: "project-1", key: "project-1/../../outside" };

      await expect(storage().read(at)).rejects.toThrow(/does not name a path/);
      await expect(
        storage().write(at, body("x"), { byteLength: 1, contentType: "text/plain" }),
      ).rejects.toThrow(/does not name a path/);
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
