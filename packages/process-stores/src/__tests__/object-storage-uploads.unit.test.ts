/**
 * @see modules/stored-object/specs/uploads-through-langwatch.feature
 */
import { parseProcessConfig } from "@langwatch/config";
import { createTestLogger } from "@langwatch/test-harness";
import { nowInstant } from "@langwatch/time";
import { afterEach, describe, expect, it } from "vitest";

import { storesOwner } from "../config-owner.ts";
import { buildObjectStorage } from "../object-storage-member.ts";
import { objectStoragePrivateAccountsOf } from "../object-storage-private-accounts.ts";
import { openObjectStorage, PLATFORM_TENANT_ID } from "./object-storage-stores.fixture.ts";

/** openStores signs on the wall clock, so the upload window is measured from now. */
const clock = { now: nowInstant };
const facts = {
  byteLength: 5,
  contentType: "text/csv",
  expiresAt: nowInstant().add({ minutes: 15 }),
};
const S3_KEYS = { S3_ACCESS_KEY_ID: "AKIDEXAMPLE", S3_SECRET_ACCESS_KEY: "content-marker" };
const sharedS3 = {
  STORED_OBJECTS_BACKEND: "s3",
  S3_BUCKET_NAME: "objects",
  S3_ENDPOINT: "http://s3.managed.svc.cluster.local:9000",
  S3_REGION: "eu-west-1",
};
const accountKey = Buffer.from("an account key of some length").toString("base64");

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

/** The upload a deployment booted with this environment hands a client of the platform tenant. */
async function uploadUnder(environment: Record<string, string>) {
  const settings = parseProcessConfig({ owners: [storesOwner], environment }).stores.objectStorage;
  const opened = await openObjectStorage({ settings, environment });
  closers.push(opened.close);
  return opened.storage.signUpload(
    { projectId: PLATFORM_TENANT_ID, key: `${PLATFORM_TENANT_ID}/object-1` },
    facts,
  );
}

describe("given the shared backend is S3", () => {
  describe("when no upload setting is named", () => {
    /** @scenario "An S3 account hands out a direct upload address by default" */
    it("hands out a URL signed on the bucket's endpoint", async () => {
      const upload = await uploadUnder({ ...sharedS3, ...S3_KEYS });

      if (upload.kind !== "direct")
        throw new Error(`Expected a direct upload, got ${upload.kind}.`);
      expect(new URL(upload.url).host).toBe("s3.managed.svc.cluster.local:9000");
      expect(new URL(upload.url).searchParams.has("X-Amz-Signature")).toBe(true);
    });
  });

  describe("when the upload setting is blank", () => {
    /** @scenario "An S3 account hands out a direct upload address by default" */
    it("keeps the direct default", async () => {
      const upload = await uploadUnder({ ...sharedS3, ...S3_KEYS, STORED_OBJECTS_UPLOADS: "" });

      expect(upload.kind).toBe("direct");
    });
  });

  describe("when uploads are set to through-langwatch", () => {
    /** @scenario "An S3 account set to upload through LangWatch hands out LangWatch's signed route" */
    it("hands out the process's own route and no address on the bucket", async () => {
      const upload = await uploadUnder({
        ...sharedS3,
        ...S3_KEYS,
        STORED_OBJECTS_UPLOADS: "through-langwatch",
      });

      expect(upload).toEqual({ kind: "through-process" });
    });
  });
});

describe("given the shared backend is Azure Blob", () => {
  describe("when uploads are set to through-langwatch", () => {
    /** @scenario "An Azure account set to upload through LangWatch hands out LangWatch's signed route" */
    it("hands out the process's own route instead of a SAS", async () => {
      const upload = await uploadUnder({
        STORED_OBJECTS_BACKEND: "azure",
        AZURE_BLOB_ACCOUNT_NAME: "lwacct",
        AZURE_BLOB_CONTAINER: "lw-container",
        AZURE_BLOB_ACCOUNT_KEY: accountKey,
        STORED_OBJECTS_UPLOADS: "through-langwatch",
      });

      expect(upload).toEqual({ kind: "through-process" });
    });

    /** @scenario "The storage checkup reads where uploads go from the account's setting" */
    it("says uploads go through the process without signing one", async () => {
      const environment = {
        STORED_OBJECTS_BACKEND: "azure",
        AZURE_BLOB_ACCOUNT_NAME: "lwacct",
        AZURE_BLOB_CONTAINER: "lw-container",
        AZURE_BLOB_ACCOUNT_KEY: accountKey,
        STORED_OBJECTS_UPLOADS: "through-langwatch",
      };
      const settings = parseProcessConfig({ owners: [storesOwner], environment }).stores
        .objectStorage;
      const opened = await openObjectStorage({ settings, environment });
      closers.push(opened.close);

      await expect(opened.storage.uploadRoute(PLATFORM_TENANT_ID)).resolves.toBe("through-process");
    });
  });
});

describe("given an organisation with its own S3 account", () => {
  const accountOf = (extra: Record<string, string>) =>
    JSON.stringify({
      endpoint: "https://s3.acme.invalid",
      bucket: "acme-dataplane",
      accessKeyId: "AKIDEXAMPLE",
      secretAccessKey: "content-marker",
      ...extra,
    });

  /** Projects "acme-project" and "other-project" belong to org123 and org456. */
  const memberWith = (options: {
    shared: "direct" | "through-langwatch";
    entry: Record<string, string>;
  }) => {
    const { logger } = createTestLogger();
    const privateAccounts = objectStoragePrivateAccountsOf({
      family: new Map([["DATAPLANE_S3__acme__org123", accountOf(options.entry)]]),
      uploads: options.shared,
      logger,
    });
    const organizations: Record<string, string> = {
      "acme-project": "org123",
      "other-project": "org456",
    };
    const built = buildObjectStorage({
      config: {
        backend: "s3",
        s3: {
          bucket: "shared-bucket",
          endpoint: "https://s3.shared.invalid",
          region: "eu-west-1",
          credentials: { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "content-marker" },
          uploads: options.shared,
        },
        privateAccounts,
      },
      clock,
      directory: {
        organizationForTenant: (projectId) => Promise.resolve(organizations[projectId] ?? null),
      },
    });
    closers.push(async () => built.close?.());
    return built.value;
  };
  const storageWith = (options: Parameters<typeof memberWith>[0]) => {
    const member = memberWith(options);
    return (projectId: string) =>
      member.signUpload({ projectId, key: `${projectId}/object-1` }, facts);
  };

  describe("when a checkup asks where each project's uploads go", () => {
    /** @scenario "The storage checkup reads where uploads go from the account's setting" */
    it("answers from each account's own setting", async () => {
      const member = memberWith({ shared: "direct", entry: { uploads: "through-langwatch" } });

      await expect(member.uploadRoute("acme-project")).resolves.toBe("through-process");
      await expect(member.uploadRoute("other-project")).resolves.toBe("direct");
    });
  });

  describe("when the shared account uploads directly and the organisation's is set to through-langwatch", () => {
    /** @scenario "A per-organisation S3 account keeps its own upload setting" */
    it("routes the organisation's uploads through the process and keeps others direct", async () => {
      const signUpload = storageWith({
        shared: "direct",
        entry: { uploads: "through-langwatch" },
      });

      expect(await signUpload("acme-project")).toEqual({ kind: "through-process" });
      const other = await signUpload("other-project");
      if (other.kind !== "direct") throw new Error(`Expected a direct upload, got ${other.kind}.`);
      expect(new URL(other.url).host).toBe("s3.shared.invalid");
    });
  });

  describe("when the organisation's account names no upload setting", () => {
    /** @scenario "A per-organisation S3 account keeps its own upload setting" */
    it("inherits the shared setting", async () => {
      const signUpload = storageWith({ shared: "through-langwatch", entry: {} });

      expect(await signUpload("acme-project")).toEqual({ kind: "through-process" });
    });
  });

  describe("when the organisation's account sets uploads to direct under a through-langwatch default", () => {
    /** @scenario "A per-organisation S3 account keeps its own upload setting" */
    it("hands out a URL on the organisation's own endpoint", async () => {
      const signUpload = storageWith({ shared: "through-langwatch", entry: { uploads: "direct" } });

      const upload = await signUpload("acme-project");
      if (upload.kind !== "direct")
        throw new Error(`Expected a direct upload, got ${upload.kind}.`);
      expect(new URL(upload.url).host).toBe("s3.acme.invalid");
    });
  });

  describe("when the organisation's account names an unknown upload setting", () => {
    /** @scenario "A per-organisation S3 account keeps its own upload setting" */
    it("skips the entry by its variable name, as any other invalid field", () => {
      const { logger, lines } = createTestLogger();
      const accounts = objectStoragePrivateAccountsOf({
        family: new Map([["DATAPLANE_S3__acme__org123", accountOf({ uploads: "sideways" })]]),
        logger,
      });

      expect(accounts).toEqual([]);
      expect(lines.findLine("warn", "invalid fields")).toMatchObject({
        envVar: "DATAPLANE_S3__acme__org123",
        fields: ["uploads"],
      });
    });
  });
});

describe("given the upload setting names a value nothing implements", () => {
  /** @scenario "An unknown upload setting is refused at boot by name" */
  it("refuses the boot naming STORED_OBJECTS_UPLOADS and its allowed values", () => {
    const boot = () =>
      parseProcessConfig({
        owners: [storesOwner],
        environment: { STORED_OBJECTS_UPLOADS: "sideways" },
      });

    expect(boot).toThrow(
      expect.objectContaining({
        code: "config_refused",
        refusals: [expect.stringMatching(/STORED_OBJECTS_UPLOADS.*"direct".*"through-langwatch"/)],
      }),
    );
  });
});
