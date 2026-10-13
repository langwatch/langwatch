/**
 * The two members that route themselves. Every test here stops before a socket: routing and
 * refusal are decided from the directory read and the config alone, which is the point of both.
 */
import { Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { UnknownStorageProjectError } from "../src/object-storage-backend.ts";
import { buildObjectStorage } from "../src/object-storage-member.ts";
import { cachedTenantDirectory } from "../src/tenant-directory.ts";

describe("given the directory both routed members place a tenant with", () => {
  describe("when the same tenant is placed twice", () => {
    it("reads the store once and answers the second from memory", async () => {
      const organizationForTenant = vi.fn().mockResolvedValue("organization-1");
      const directory = cachedTenantDirectory({ organizationForTenant });

      await directory.organizationForTenant("project-1");
      await directory.organizationForTenant("project-1");

      expect(organizationForTenant).toHaveBeenCalledOnce();
    });
  });

  describe("when a tenant this deployment cannot place is read", () => {
    it("answers null and remembers nothing, so a new project routes as soon as it exists", async () => {
      const organizationForTenant = vi.fn().mockResolvedValue(null);
      const directory = cachedTenantDirectory({ organizationForTenant });

      await expect(directory.organizationForTenant("project-1")).resolves.toBeNull();
      await expect(directory.organizationForTenant("project-1")).resolves.toBeNull();

      expect(organizationForTenant).toHaveBeenCalledTimes(2);
    });
  });

  describe("when more tenants are placed than the cache holds", () => {
    it("evicts the oldest answer rather than growing without bound", async () => {
      const organizationForTenant = vi.fn(async (tenantId: string) => `organization-${tenantId}`);
      const directory = cachedTenantDirectory({ organizationForTenant }, 1);

      await directory.organizationForTenant("a");
      await directory.organizationForTenant("b");
      await directory.organizationForTenant("a");

      expect(organizationForTenant).toHaveBeenCalledTimes(3);
    });

    it("refuses a cache size that is not a positive integer", () => {
      expect(() =>
        cachedTenantDirectory({ organizationForTenant: () => Promise.resolve(null) }, 0),
      ).toThrow(RangeError);
    });
  });
});

describe("given object storage with an organization on its own account", () => {
  const clock = { now: () => Temporal.Instant.from("2026-09-24T12:00:00Z") };
  const config = {
    backend: "s3",
    s3: { bucket: "shared" },
    privateAccounts: [{ organizationId: "organization-1", bucket: "private" }],
  } as const;

  describe("when a project this deployment cannot place writes an object", () => {
    /** @scenario "An unplaceable project is refused rather than written to the shared bucket" */
    it("refuses rather than falling back to the shared bucket", async () => {
      const storage = buildObjectStorage({
        config,
        clock,
        directory: { organizationForTenant: () => Promise.resolve(null) },
      });

      await expect(
        storage.value.write({ projectId: "unknown", key: "k" }, (async function* () {})(), {
          byteLength: 0,
          contentType: "text/plain",
        }),
      ).rejects.toBeInstanceOf(UnknownStorageProjectError);
    });

    it("refuses a call that names no project at all", async () => {
      const storage = buildObjectStorage({
        config,
        clock,
        directory: { organizationForTenant: () => Promise.resolve("organization-1") },
      });

      await expect(storage.value.read({ projectId: "", key: "k" })).rejects.toBeInstanceOf(
        UnknownStorageProjectError,
      );
    });
  });

  describe("when a project of that organization asks where its objects live", () => {
    it("answers the organization's own bucket, and the shared one for everyone else", async () => {
      const storage = buildObjectStorage({
        config,
        clock,
        directory: {
          organizationForTenant: (projectId) =>
            Promise.resolve(projectId === "own" ? "organization-1" : "organization-2"),
        },
      });

      await expect(storage.value.destination("own")).resolves.toEqual({
        kind: "s3",
        bucket: "private",
      });
      await expect(storage.value.destination("other")).resolves.toEqual({
        kind: "s3",
        bucket: "shared",
      });
    });
  });

  describe("when two accounts are configured for one organization", () => {
    it("refuses to build, naming the organization", () => {
      expect(() =>
        buildObjectStorage({
          config: {
            backend: "s3",
            s3: { bucket: "shared" },
            privateAccounts: [
              { organizationId: "organization-1", bucket: "one" },
              { organizationId: "organization-1", bucket: "two" },
            ],
          },
          clock,
          directory: { organizationForTenant: () => Promise.resolve(null) },
        }),
      ).toThrow("organization-1");
    });
  });

  describe("when no bucket is named", () => {
    it("refuses to build", () => {
      expect(() =>
        buildObjectStorage({
          config: { backend: "s3", s3: { bucket: "  " } },
          clock,
          directory: { organizationForTenant: () => Promise.resolve(null) },
        }),
      ).toThrow("without a bucket name");
    });
  });
});
