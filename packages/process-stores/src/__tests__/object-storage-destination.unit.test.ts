/**
 * @see specs/features/scenarios/externalize-event-byte-content.feature
 * @see specs/migration/object-storage-provider-migration.feature
 */
import { Temporal } from "@langwatch/time";
import { afterEach, describe, expect, it } from "vitest";

import type { ObjectStorageAzureConfig } from "../config.ts";
import { UnreachableStorageLocationError } from "../object-storage-backend.ts";
import { buildObjectStorage } from "../object-storage-member.ts";
import {
  azureBlock,
  completeAzure,
  openObjectStorage,
  type ObjectStorageSettings,
} from "./object-storage-stores.fixture.ts";

const accountKey = Buffer.from("an account key of some length").toString("base64");
const clock = { now: () => Temporal.Instant.from("2026-09-24T12:00:00Z") };
const expiresAt = Temporal.Instant.from("2026-09-24T12:15:00Z");
const at = { projectId: "project-1", key: "project-1/object-1" };
const s3Account = { region: "eu-west-1" };

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

async function destinationFor(options: {
  settings: Partial<ObjectStorageSettings>;
  accountKey?: string;
}) {
  const opened = await openObjectStorage(options);
  closers.push(opened.close);
  return opened.storage.destination("project-1");
}

describe("given STORED_OBJECTS_BACKEND is azure with complete Azure config and no private bucket", () => {
  /** @scenario "Operator selects Azure Blob as the stored-objects write backend" */
  it("resolves an azure destination carrying the account name and container", async () => {
    expect(
      await destinationFor({
        settings: { backend: "azure", azure: completeAzure },
        accountKey,
      }),
    ).toEqual({ kind: "azure", accountName: "lwacct", container: "lw-container" });
  });

  /** @scenario "The azure toggle beats the global S3 bucket but not a BYOC bucket" */
  it("resolves azure, not the global S3 bucket, when S3_BUCKET_NAME is also set", async () => {
    expect(
      await destinationFor({
        settings: {
          backend: "azure",
          azure: completeAzure,
          s3: { bucket: "global-bucket", endpoint: undefined, region: undefined },
        },
        accountKey,
      }),
    ).toMatchObject({ kind: "azure" });
  });
});

describe("given STORED_OBJECTS_BACKEND is azure with an incomplete Azure block", () => {
  /** @scenario "Azure backend selection fails loud when the Azure config is incomplete" */
  it.each([
    ["AZURE_BLOB_ACCOUNT_NAME", { accountName: undefined }, accountKey],
    ["AZURE_BLOB_CONTAINER", { container: undefined }, accountKey],
    ["AZURE_BLOB_ACCOUNT_KEY", {}, undefined],
  ] as const)("names %s and does not fall back to another backend", async (name, gap, key) => {
    const opened = await openObjectStorage({
      settings: {
        backend: "azure",
        s3: { bucket: "global-bucket", endpoint: undefined, region: undefined },
        azure: { ...completeAzure, ...gap },
      },
      ...(key ? { accountKey: key } : {}),
    });
    closers.push(opened.close);

    await expect(opened.storage.destination("project-1")).rejects.toMatchObject({
      name: "AzureBackendMisconfiguredError",
      missingVariables: [name],
    });
  });
});

describe("given Azure settings are present and STORED_OBJECTS_BACKEND is not set", () => {
  const azure = { ...completeAzure, accountName: "lwacct" };

  /** @scenario "Azure env vars alone never flip the write destination" */
  it("selects the global S3 bucket when one is configured, minting no azure destination", async () => {
    expect(
      await destinationFor({
        settings: {
          azure,
          s3: { bucket: "global-bucket", endpoint: undefined, region: undefined },
        },
        accountKey,
      }),
    ).toEqual({ kind: "s3", bucket: "global-bucket" });
  });

  /** @scenario "Azure env vars alone never flip the write destination" */
  it("selects the local filesystem when no global bucket is configured either", async () => {
    expect(
      await destinationFor({ settings: { azure, localRoot: "/data/objects" }, accountKey }),
    ).toEqual({ kind: "file", root: "/data/objects" });
  });
});

describe("given the legacy S3 selector with no global or private bucket", () => {
  /** @scenario "The legacy S3 selector keeps its existing fallback behavior" */
  it("keeps the local-filesystem fallback instead of refusing to boot", async () => {
    expect(
      await destinationFor({ settings: { backend: "s3", localRoot: "/data/objects" } }),
    ).toEqual({
      kind: "file",
      root: "/data/objects",
    });
  });
});

describe("given STORED_OBJECTS_BACKEND=azure with complete config and a private S3 account", () => {
  const directory = { organizationForTenant: () => Promise.resolve("organization-1") };

  /** @scenario "A per-project private dataplane bucket still beats the Azure backend toggle" */
  it("places the project on its private S3 bucket, not on Azure", async () => {
    const storage = buildObjectStorage({
      config: {
        backend: "azure",
        azure: azureBlock({ accountKey }),
        privateAccounts: [
          { ...s3Account, bucket: "dataplane-acme", organizationId: "organization-1" },
        ],
      },
      clock,
      directory,
    });

    expect(await storage.value.destination("project-1")).toEqual({
      kind: "s3",
      bucket: "dataplane-acme",
    });
    await storage.close?.();
  });
});

describe("given writes moved to S3 while the Azure settings stay for legacy reads", () => {
  const directory = { organizationForTenant: () => Promise.resolve("organization-1") };
  const recorded = {
    ...at,
    location: { kind: "azure", accountName: "lwacct", container: "historic" },
  } as const;

  const storageWith = (legacyAzure: ObjectStorageAzureConfig) =>
    buildObjectStorage({
      config: { backend: "s3", s3: { ...s3Account, bucket: "shared" }, legacyAzure },
      clock,
      directory,
    });

  /** @scenario "Choosing S3 for writes does not unregister the Azure driver" */
  it("writes to S3 while an object recorded on Azure is still reached, in the container it names", async () => {
    const storage = storageWith(azureBlock({ accountKey }));

    expect(await storage.value.destination("project-1")).toEqual({ kind: "s3", bucket: "shared" });
    const url = await storage.value.signDownload(recorded, { expiresAt });
    expect(url).toContain("/historic/project-1/object-1");
    await storage.close?.();
  });

  /** @scenario "Choosing S3 for writes does not unregister the Azure driver" */
  it("declines quietly when the retained block is unusable, leaving S3 traffic unaffected", async () => {
    const storage = storageWith(azureBlock());

    expect(await storage.value.destination("project-1")).toEqual({ kind: "s3", bucket: "shared" });
    await expect(storage.value.signDownload(recorded, { expiresAt })).rejects.toBeInstanceOf(
      UnreachableStorageLocationError,
    );
    await storage.close?.();
  });
});
