import { beforeEach, describe, expect, it, vi } from "vitest";

const mockedEnv = vi.hoisted(() => ({
  LANGWATCH_QUEUE_PAYLOAD_BUCKET: undefined as string | undefined,
  LANGWATCH_QUEUE_PAYLOAD_PREFIX: undefined as string | undefined,
}));
const resolveProjectStorageDestination = vi.hoisted(() => vi.fn());

vi.mock("~/env.mjs", () => ({ env: mockedEnv }));
vi.mock("~/server/stored-objects/project-storage-destination", () => ({
  resolveProjectStorageDestination,
}));

import {
  mintGroupQueueStorageUri,
  mintLegacyGroupQueueStorageUri,
  resolveGroupQueueStorageDestination,
} from "../groupQueueStorage";

const DEFAULT_PREFIX = "temp-tier-3-offload/";

describe("GroupQueue storage", () => {
  beforeEach(() => {
    mockedEnv.LANGWATCH_QUEUE_PAYLOAD_BUCKET = undefined;
    mockedEnv.LANGWATCH_QUEUE_PAYLOAD_PREFIX = undefined;
    resolveProjectStorageDestination.mockReset();
  });

  describe("given a dedicated queue bucket is configured", () => {
    /** @scenario "A very large payload offloads to the dedicated GroupQueue durable storage namespace" */
    it("uses the dedicated bucket and prefix without consulting tenant storage", async () => {
      mockedEnv.LANGWATCH_QUEUE_PAYLOAD_BUCKET = "langwatch-prod-group-queue";
      mockedEnv.LANGWATCH_QUEUE_PAYLOAD_PREFIX = "/temp-tier-3-offload/";

      const destination = await resolveGroupQueueStorageDestination("tenant-1");
      const uri = mintGroupQueueStorageUri({
        destination,
        tenantId: "tenant-1",
        hash: "abc123",
      });

      expect(uri).toBe(
        "s3://langwatch-prod-group-queue/temp-tier-3-offload/tenant-1/abc123",
      );
      expect(resolveProjectStorageDestination).not.toHaveBeenCalled();
    });
  });

  describe("given no dedicated queue bucket is configured", () => {
    it("falls back to the project destination", async () => {
      resolveProjectStorageDestination.mockResolvedValue({
        kind: "file",
        root: "/var/lib/langwatch/objects",
      });

      await expect(
        resolveGroupQueueStorageDestination("tenant-2"),
      ).resolves.toEqual({
        kind: "file",
        root: "/var/lib/langwatch/objects",
        prefix: DEFAULT_PREFIX,
      });
      expect(resolveProjectStorageDestination).toHaveBeenCalledWith("tenant-2");
    });
  });

  // Durable-tier bytes reclaim through the storage lifecycle rather than through
  // lease release, so a payload written outside a nameable prefix is retained
  // forever — and at the destination root it is indistinguishable from
  // stored_objects content, which such a rule must spare. The prefix therefore
  // holds on EVERY destination, not only the dedicated-bucket one.
  describe("when a payload is offloaded to the durable tier", () => {
    /** @scenario "A durable queue payload is namespaced under the queue prefix" */
    it.each([
      {
        destination: "a dedicated queue bucket",
        bucket: "langwatch-prod-group-queue",
        project: undefined,
        expected:
          "s3://langwatch-prod-group-queue/temp-tier-3-offload/tenant-1/abc123",
      },
      {
        destination: "the shared deployment bucket",
        bucket: undefined,
        project: { kind: "s3", bucket: "langwatch-runtime-storage" },
        expected:
          "s3://langwatch-runtime-storage/temp-tier-3-offload/tenant-1/abc123",
      },
      {
        destination: "a tenant's own BYOC bucket",
        bucket: undefined,
        project: { kind: "s3", bucket: "customer-private" },
        expected: "s3://customer-private/temp-tier-3-offload/tenant-1/abc123",
      },
      {
        destination: "a local filesystem root",
        bucket: undefined,
        project: { kind: "file", root: "/var/lib/langwatch/objects" },
        expected:
          "file:///var/lib/langwatch/objects/temp-tier-3-offload/tenant-1/abc123",
      },
    ])(
      "namespaces the object under the queue prefix on $destination",
      async ({ bucket, project, expected }) => {
        mockedEnv.LANGWATCH_QUEUE_PAYLOAD_BUCKET = bucket;
        if (project) resolveProjectStorageDestination.mockResolvedValue(project);

        const destination =
          await resolveGroupQueueStorageDestination("tenant-1");
        const uri = mintGroupQueueStorageUri({
          destination,
          tenantId: "tenant-1",
          hash: "abc123",
        });

        expect(uri).toBe(expected);
        expect(uri).toContain(`/${DEFAULT_PREFIX}tenant-1/`);
      },
    );

    it("does not double up separators when the root or prefix carries slashes", async () => {
      mockedEnv.LANGWATCH_QUEUE_PAYLOAD_PREFIX = "/queue-payloads/";
      resolveProjectStorageDestination.mockResolvedValue({
        kind: "file",
        root: "/var/lib/langwatch/objects/",
      });

      const destination = await resolveGroupQueueStorageDestination("tenant-1");

      expect(
        mintGroupQueueStorageUri({
          destination,
          tenantId: "tenant-1",
          hash: "abc123",
        }),
      ).toBe("file:///var/lib/langwatch/objects/queue-payloads/tenant-1/abc123");
    });
  });

  // Deployments without the dedicated bucket wrote at the destination root
  // until the prefix became unconditional. A decode miss discards the job
  // permanently (#5538), so the read path must still find those objects.
  describe("when a payload predates the prefix", () => {
    /** @scenario "A payload written before the prefix existed is still readable" */
    it.each([
      {
        destination: "the shared deployment bucket",
        project: { kind: "s3", bucket: "langwatch-runtime-storage" },
        expected: "s3://langwatch-runtime-storage/tenant-1/abc123",
      },
      {
        destination: "a local filesystem root",
        project: { kind: "file", root: "/var/lib/langwatch/objects" },
        expected: "file:///var/lib/langwatch/objects/tenant-1/abc123",
      },
    ])(
      "mints the pre-prefix location on $destination",
      async ({ project, expected }) => {
        resolveProjectStorageDestination.mockResolvedValue(project);

        const destination =
          await resolveGroupQueueStorageDestination("tenant-1");

        expect(
          mintLegacyGroupQueueStorageUri({
            destination,
            tenantId: "tenant-1",
            hash: "abc123",
          }),
        ).toBe(expected);
      },
    );
  });
});
