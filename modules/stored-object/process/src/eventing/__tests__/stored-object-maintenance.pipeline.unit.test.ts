/**
 * @vitest-environment node
 * The worker's scheduled reaper: pending uploads nobody confirmed lose their
 * bytes and are marked failed, across every project, in bounded batches.
 * @see modules/stored-object/specs/uploads-through-langwatch.feature
 */
import { InMemoryProcessStore } from "@langwatch/eventing";
import { memoryObjectStorage } from "@langwatch/process-stores";
import type { StoredObjectId, StoredObjectProjectId } from "@langwatch/stored-object-contract";
import { type Instant, nowInstant } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { MemoryStoredObjectRepositories } from "../../repositories/memory/memory.stored-object.repositories.ts";
import type { StoredObjectRecord } from "../../repositories/stored-object-record.repository.ts";
import { storedObjectProcessModule } from "../../stored-object.module.ts";
import {
  STORED_OBJECT_MAINTENANCE_PIPELINE_NAME,
  buildStoredObjectMaintenance,
  storedObjectEventing,
} from "../stored-object-maintenance.pipeline.ts";
import { UPLOAD_REAP_PROCESS_NAME } from "../upload-reap.intent.ts";
import { UPLOAD_REAP_INTERVAL_MS } from "../upload-reap.process.ts";

const FILE = new TextEncoder().encode("abandoned bytes");

function built() {
  const repositories = MemoryStoredObjectRepositories.create({
    objectStorage: memoryObjectStorage(),
  });
  const processStore = InMemoryProcessStore.createForTesting();
  const definition = buildStoredObjectMaintenance({
    participation: "consume",
    repositories,
    app: undefined,
    processStore,
  });
  const process = definition.processManagers.get(UPLOAD_REAP_PROCESS_NAME);
  if (!process) throw new Error("the declaration built no upload reap process manager");

  return { repositories, processStore, process };
}

async function pendingUpload({
  repositories,
  projectId,
  objectId,
  expiresAt,
}: {
  repositories: ReturnType<typeof built>["repositories"];
  projectId: string;
  objectId: string;
  expiresAt: Instant;
}): Promise<StoredObjectRecord> {
  const { address } = await repositories.bytes.place({ projectId, objectId });
  await repositories.bytes.write({
    projectId,
    address,
    body: (async function* () {
      yield FILE;
    })(),
    byteLength: FILE.byteLength,
    mediaType: "text/plain",
  });
  const createdAt = expiresAt.subtract({ minutes: 15 });
  const record: StoredObjectRecord = {
    tenantId: projectId as StoredObjectProjectId,
    id: objectId as StoredObjectId,
    status: "pending",
    purpose: "dataset_attachment",
    ownerKind: "project",
    ownerId: projectId,
    filename: "notes.txt",
    sha256: "",
    byteLength: FILE.byteLength,
    mediaType: "text/plain",
    mediaTypeVerified: false,
    storage: address,
    generation: 0,
    audiences: ["datasets:view"],
    expiresAt,
    availableAt: null,
    deletedAt: null,
    source: "canonical",
    legacyFingerprint: null,
    createdAt,
    updatedAt: createdAt,
  };
  await repositories.records.upsert(record);

  return record;
}

describe("given stored-object's eventing declaration", () => {
  describe("when the module is declared", () => {
    /** @scenario "Expired pending uploads are reaped on a schedule" */
    it("carries the scheduled upload reaper onto the installable module", () => {
      expect(storedObjectProcessModule.eventing?.pipeline).toContain(
        STORED_OBJECT_MAINTENANCE_PIPELINE_NAME,
      );
      expect(storedObjectEventing.pipeline).toBe(STORED_OBJECT_MAINTENANCE_PIPELINE_NAME);
      expect(UPLOAD_REAP_INTERVAL_MS).toBe(15 * 60 * 1000);
    });
  });

  describe("given a pending upload whose window expired an hour ago, with bytes in the bucket", () => {
    describe("when the scheduled reaper wakes", () => {
      /** @scenario "Expired pending uploads are reaped on a schedule" */
      it("deletes its bytes, marks it failed and leaves an upload inside its window alone", async () => {
        const { repositories, processStore, process } = built();
        const now = nowInstant();
        const expired = await pendingUpload({
          repositories,
          projectId: "project_a",
          objectId: "so_expired",
          expiresAt: now.subtract({ hours: 1 }),
        });
        const elsewhere = await pendingUpload({
          repositories,
          projectId: "project_b",
          objectId: "so_expired_elsewhere",
          expiresAt: now.subtract({ hours: 1 }),
        });
        const open = await pendingUpload({
          repositories,
          projectId: "project_a",
          objectId: "so_open",
          expiresAt: now.add({ minutes: 10 }),
        });
        const deleteDispatchedBefore = vi.spyOn(processStore, "deleteDispatchedBefore");

        await process.config.intents!.reap!.run(
          { scheduledFor: 0 },
          {
            processName: UPLOAD_REAP_PROCESS_NAME,
            projectId: "global",
            processKey: "global",
            tenantId: "global",
            messageKey: `${UPLOAD_REAP_PROCESS_NAME}:0`,
            attempt: 1,
          },
        );

        for (const reaped of [expired, elsewhere]) {
          await expect(
            repositories.bytes.exists({ projectId: reaped.tenantId, address: reaped.storage! }),
          ).resolves.toBe(false);
          await expect(
            repositories.records.findById({ tenantId: reaped.tenantId, id: reaped.id }),
          ).resolves.toMatchObject({ status: "failed", storage: null });
        }
        await expect(
          repositories.bytes.exists({ projectId: open.tenantId, address: open.storage! }),
        ).resolves.toBe(true);
        await expect(
          repositories.records.findById({ tenantId: open.tenantId, id: open.id }),
        ).resolves.toMatchObject({ status: "pending", storage: open.storage });
        expect(deleteDispatchedBefore.mock.calls[0]![0]).toMatchObject({
          processName: UPLOAD_REAP_PROCESS_NAME,
        });
      });
    });
  });
});
