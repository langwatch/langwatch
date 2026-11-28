/**
 * @vitest-environment node
 * The installed module over memory twins, its storage answering uploads through
 * the process: create, send to the address handed out, confirm.
 * @see modules/stored-object/specs/uploads-through-langwatch.feature
 */
import { createHash } from "node:crypto";

import { AuthzApi } from "@langwatch/authz-contract";
import { bootInstalledProcess } from "@langwatch/process";
import {
  memoryStores,
  type ObjectStorage,
  type StoresMemberSource,
} from "@langwatch/process-stores";
import { testPeer } from "@langwatch/process/testing";
import { StoredObjectApi } from "@langwatch/stored-object-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { storedObjectProcessModule } from "../../stored-object.module.ts";

const PROJECT_ID = "project_1";
const FILE = new TextEncoder().encode("a dataset row's attachment, sent through LangWatch");

/** The memory stores, their object storage counting every read-back of an object. */
function countingStores(): { stores: StoresMemberSource; readBacks: string[] } {
  const memory = memoryStores();
  const inner = memory.read("objectStorage") as ObjectStorage;
  const readBacks: string[] = [];
  const objectStorage: ObjectStorage = {
    ...inner,
    digest: (at) => {
      readBacks.push(`digest:${at.key}`);
      return inner.digest(at);
    },
    read: (at) => {
      readBacks.push(`read:${at.key}`);
      return inner.read(at);
    },
  };

  return {
    readBacks,
    stores: {
      ...memory,
      read: (name: string) => (name === "objectStorage" ? objectStorage : memory.read(name)),
    },
  };
}

function boot(stores: StoresMemberSource) {
  return bootInstalledProcess({
    role: "api",
    modules: [storedObjectProcessModule],
    config: {
      "stored-object": {
        objectRetentionConfirmed: false,
        legacySpoolRetentionConfirmed: undefined,
        blockLocalHttpCalls: true,
        allowedProxyHosts: [],
        isSaas: false,
        publicBaseUrl: "https://app.example",
      },
    },
    stores,
    peers: [testPeer({ token: AuthzApi, instance: createApiFixture<AuthzApi>() })],
  });
}

describe("stored-object uploads through LangWatch, installed over memory twins", () => {
  describe("given an account set to upload through LangWatch", () => {
    describe("when a client creates an upload, sends the file to the address it was given and confirms", () => {
      /** @scenario "A file sent to LangWatch's signed route is stored in the bucket and confirms" */
      it("stores the object with the file's length and SHA-256 without reading it back", async () => {
        const { stores, readBacks } = countingStores();
        const runtime = await boot(stores);

        try {
          const app = runtime.service(StoredObjectApi);
          const created = await app.createUpload({
            projectId: PROJECT_ID,
            purpose: "dataset_attachment",
            filename: "attachment.txt",
            mediaType: "text/plain",
            byteLength: FILE.byteLength,
          });
          const address = new URL(created.uploadUrl);
          expect(address.origin).toBe("https://app.example");
          expect(address.pathname).toBe(`/api/stored-objects/uploads/${created.objectId}/content`);

          await app.writeUpload({
            objectId: created.objectId,
            signature: address.searchParams.get("sig") ?? "",
            contentLength: FILE.byteLength,
            body: new Blob([FILE]).stream(),
          });
          const confirmed = await app.confirmUpload({
            projectId: PROJECT_ID,
            objectId: created.objectId,
          });

          const sha256 = createHash("sha256").update(FILE).digest("hex");
          expect(confirmed).toMatchObject({ byteLength: FILE.byteLength, sha256 });
          await expect(
            app.getMetadata({ projectId: PROJECT_ID, id: created.objectId }),
          ).resolves.toMatchObject({ status: "available", byteLength: FILE.byteLength, sha256 });
          expect(readBacks).toEqual([]);
        } finally {
          await runtime.stop();
        }
      });
    });
  });
});
