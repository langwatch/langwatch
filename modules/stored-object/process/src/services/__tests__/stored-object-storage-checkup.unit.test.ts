/**
 * @vitest-environment node
 * The storage checkup names a deployment that sends uploads through LangWatch
 * but gives clients no address to send them to.
 * @see modules/stored-object/specs/uploads-through-langwatch.feature
 */
import { memoryObjectStorage } from "@langwatch/process-stores";
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
});
