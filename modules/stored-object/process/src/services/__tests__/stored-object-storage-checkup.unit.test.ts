/**
 * @vitest-environment node
 * The storage checkup names a deployment that sends uploads through LangWatch
 * but gives clients no address to send them to.
 * @see modules/stored-object/specs/uploads-through-langwatch.feature
 */
import { memoryObjectStorage, type ObjectStorage } from "@langwatch/process-stores";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import {
  FixedStoredObjectDelivery,
  GrantedStoredObjectPermissions,
  MemoryStoredObjectFiles,
  MemoryStoredObjectStorage,
} from "../../app/__tests__/stored-object.fixture.ts";
import { MemoryStoredObjectRecordRepository } from "../../repositories/memory/memory.stored-object-record.repository.ts";
import { MemoryStoredObjectSealRepository } from "../../repositories/memory/memory.stored-object-seal.repository.ts";
import { ObjectStorageStoredObjectBytesRepository } from "../../repositories/object-storage/object-storage.stored-object-bytes.repository.ts";
import type { StoredObjectBytesRepository } from "../../repositories/stored-object-bytes.repository.ts";
import { StoredObjectUploadSignerService } from "../stored-object-upload-signer.service.ts";
import { StoredObjectService } from "../stored-object.service.ts";

const PROJECT_ID = "project_1";

function serviceOver({
  storage,
  publicBaseUrl,
}: {
  storage: StoredObjectBytesRepository;
  publicBaseUrl: string | undefined;
}): StoredObjectService {
  return StoredObjectService.create({
    records: MemoryStoredObjectRecordRepository.create(),
    permissions: new GrantedStoredObjectPermissions(),
    storage,
    signer: StoredObjectUploadSignerService.create({
      seals: MemoryStoredObjectSealRepository.create(),
      publicBaseUrl,
    }),
    legacy: new MemoryStoredObjectFiles(),
    delivery: new FixedStoredObjectDelivery(),
    maximumUploadBytes: 1024,
    uploadExpiryMs: 15 * 60 * 1000,
  });
}

/** The memory twin answers every upload through the process, as "through-langwatch" does. */
function throughLangWatch(): StoredObjectBytesRepository {
  return ObjectStorageStoredObjectBytesRepository.create({ objectStorage: memoryObjectStorage() });
}

/**
 * A member under a given upload setting that answers only what a checkup may ask: the probe's
 * write and remove, the upload route, and signing. Each signed key is recorded; route and
 * signing answer for the checked project only, so a call for any other project fails the test.
 */
function memberUnder(route: "direct" | "through-process", { refusal }: { refusal?: Error } = {}) {
  const signed: string[] = [];
  const twin = memoryObjectStorage();
  const objectStorage = createApiFixture<ObjectStorage>(
    {
      write: (at, body, facts) => twin.write(at, body, facts),
      remove: (at) => twin.remove(at),
      uploadRoute: async (projectId) => {
        if (projectId !== PROJECT_ID) throw new Error(`Asked the route of ${projectId}.`);
        return route;
      },
      signUpload: async (at) => {
        if (at.projectId !== PROJECT_ID) throw new Error(`Signed for ${at.projectId}.`);
        signed.push(at.key);
        if (refusal) throw refusal;
        return { kind: "direct", url: `https://bucket.example/${at.key}`, headers: {} };
      },
    },
    "objectStorage",
  );

  return { signed, storage: ObjectStorageStoredObjectBytesRepository.create({ objectStorage }) };
}

describe("StoredObjectService.probeStorage", () => {
  describe("given an account set to upload through LangWatch", () => {
    describe("when the deployment names no public base URL", () => {
      /** @scenario "The storage checkup fails when uploads go through LangWatch but no public address is set" */
      it("fails with direct_upload_unavailable", async () => {
        const service = serviceOver({ storage: throughLangWatch(), publicBaseUrl: undefined });

        await expect(service.probeStorage({ projectId: PROJECT_ID })).rejects.toMatchObject({
          code: "direct_upload_unavailable",
        });
      });
    });

    describe("when the deployment names a public base URL", () => {
      it("passes", async () => {
        const service = serviceOver({
          storage: throughLangWatch(),
          publicBaseUrl: "https://app.example",
        });

        await expect(service.probeStorage({ projectId: PROJECT_ID })).resolves.toBeUndefined();
      });
    });
  });

  describe("given an account that hands out direct upload addresses", () => {
    describe("when the deployment names no public base URL", () => {
      it("passes, since no client is sent to LangWatch", async () => {
        const storage = new MemoryStoredObjectStorage();
        const service = serviceOver({ storage, publicBaseUrl: undefined });

        await expect(service.probeStorage({ projectId: PROJECT_ID })).resolves.toBeUndefined();
        expect(storage.probes).toBe(1);
      });
    });
  });
  describe("given a member that refuses to sign any upload", () => {
    describe("when the account is set to upload through LangWatch and no public base URL is named", () => {
      /** @scenario "The storage checkup reads where uploads go from the account's setting" */
      it("still names the missing address, from the setting alone", async () => {
        const { signed, storage } = memberUnder("through-process", {
          refusal: new Error("This member's credentials cannot sign an upload."),
        });
        const service = serviceOver({ storage, publicBaseUrl: undefined });

        await expect(service.probeStorage({ projectId: PROJECT_ID })).rejects.toMatchObject({
          code: "direct_upload_unavailable",
        });
        expect(signed).toEqual([]);
      });
    });

    describe("when the account is set to upload through LangWatch and a public base URL is named", () => {
      /** @scenario "The storage checkup reads where uploads go from the account's setting" */
      it("passes without signing anything", async () => {
        const { signed, storage } = memberUnder("through-process", {
          refusal: new Error("This member's credentials cannot sign an upload."),
        });
        const service = serviceOver({ storage, publicBaseUrl: "https://app.example" });

        await expect(service.probeStorage({ projectId: PROJECT_ID })).resolves.toBeUndefined();
        expect(signed).toEqual([]);
      });
    });

    describe("when the account is set to upload directly", () => {
      /** @scenario "The storage checkup reads where uploads go from the account's setting" */
      it("fails, since clients could not be handed an upload address", async () => {
        const refusal = new Error("This member's credentials cannot sign an upload.");
        const { signed, storage } = memberUnder("direct", { refusal });
        const service = serviceOver({ storage, publicBaseUrl: undefined });

        await expect(service.probeStorage({ projectId: PROJECT_ID })).rejects.toBe(refusal);
        expect(signed).toHaveLength(1);
      });
    });
  });

  describe("given a member whose account uploads directly and can sign", () => {
    describe("when the storage checkup runs", () => {
      /** @scenario "The storage checkup reads where uploads go from the account's setting" */
      it("signs one throwaway upload under the checkup prefix and passes", async () => {
        const { signed, storage } = memberUnder("direct");
        const service = serviceOver({ storage, publicBaseUrl: undefined });

        await expect(service.probeStorage({ projectId: PROJECT_ID })).resolves.toBeUndefined();
        expect(signed).toEqual([expect.stringMatching(new RegExp(`^${PROJECT_ID}/checkup/`))]);
      });
    });
  });
});
