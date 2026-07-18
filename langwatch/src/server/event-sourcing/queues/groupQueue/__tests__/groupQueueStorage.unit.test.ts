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
  resolveGroupQueueStorageDestination,
} from "../groupQueueStorage";

describe("GroupQueue storage", () => {
  beforeEach(() => {
    mockedEnv.LANGWATCH_QUEUE_PAYLOAD_BUCKET = undefined;
    mockedEnv.LANGWATCH_QUEUE_PAYLOAD_PREFIX = undefined;
    resolveProjectStorageDestination.mockReset();
  });

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

  it("keeps the existing destination fallback when the dedicated bucket is disabled", async () => {
    resolveProjectStorageDestination.mockResolvedValue({
      kind: "file",
      root: "/var/lib/langwatch/objects",
    });

    await expect(
      resolveGroupQueueStorageDestination("tenant-2"),
    ).resolves.toEqual({
      kind: "file",
      root: "/var/lib/langwatch/objects",
    });
    expect(resolveProjectStorageDestination).toHaveBeenCalledWith("tenant-2");
  });
});
