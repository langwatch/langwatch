/**
 * The sweep's memory backends, store path and clock, shared by the retention unit tests.
 * @see modules/stored-object/specs/stored-object-reuse-and-retention.feature
 */
import { memoryObjectStorage } from "@langwatch/process-stores";
import type {
  StoreStoredObjectFromBytesInput,
  StoredObjectId,
  StoredObjectProjectId,
} from "@langwatch/stored-object-contract";
import { type Instant, Temporal } from "@langwatch/time";

import {
  FixedStoredObjectDelivery,
  GrantedStoredObjectPermissions,
  MemoryStoredObjectFiles,
  createStoredObjectTestSigner,
} from "../../../app/__tests__/stored-object.fixture.ts";
import { MemoryStoredObjectOwnerLinkRepository } from "../../../repositories/memory/memory.stored-object-owner-link.repository.ts";
import { MemoryStoredObjectRecordRepository } from "../../../repositories/memory/memory.stored-object-record.repository.ts";
import { ObjectStorageStoredObjectBytesRepository } from "../../../repositories/object-storage/object-storage.stored-object-bytes.repository.ts";
import type { StoredObjectOwnerLinkRepository } from "../../../repositories/stored-object-owner-link.repository.ts";
import { StoredObjectCleanupService } from "../../stored-object-cleanup.service.ts";
import { StoredObjectRetentionService } from "../../stored-object-retention.service.ts";
import { StoredObjectUploadReapService } from "../../stored-object-upload-reap.service.ts";
import { StoredObjectService } from "../../stored-object.service.ts";

export const PROJECT = "project_sweep" as StoredObjectProjectId;
export const OTHER_PROJECT = "project_other" as StoredObjectProjectId;
const DAY_0 = Temporal.Instant.from("2026-11-16T00:00:00.000Z");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 8, 7]);

export function dayOf(day: number): Instant {
  return DAY_0.add({ hours: day * 24 });
}

export function retentionFixture(
  input: { sweepPageSize?: number; sweepBudgetMs?: number; sweepTenantLimit?: number } = {},
) {
  const memoryLinks = MemoryStoredObjectOwnerLinkRepository.create();
  const records = MemoryStoredObjectRecordRepository.create([], memoryLinks);
  const clock = { now: DAY_0 };
  const retention = { days: 30 };
  const race: { beforeRaise?: () => Promise<unknown>; afterRaise?: () => Promise<unknown> } = {};
  const storage = ObjectStorageStoredObjectBytesRepository.create({
    objectStorage: memoryObjectStorage(),
  });
  const cleanup = { refuses: false };
  const deleteBytes = storage.delete.bind(storage);
  storage.delete = async (target) => {
    if (cleanup.refuses) throw new Error("the provider refused the delete");
    await deleteBytes(target);
  };
  const sweepPages = {
    msEach: 0,
    refuseTenant: undefined as StoredObjectProjectId | undefined,
    refuseObject: undefined as StoredObjectId | undefined,
    beforeDelete: undefined as (() => Promise<unknown>) | undefined,
  };
  const markDeletedIfUnheld = records.markDeletedIfUnheld.bind(records);
  records.markDeletedIfUnheld = async (query) => {
    if (query.id === sweepPages.refuseObject) throw new Error("the row update failed");
    return markDeletedIfUnheld(query);
  };
  const ownerLinks: StoredObjectOwnerLinkRepository = {
    raise: async (link) => {
      const before = race.beforeRaise;
      const after = race.afterRaise;
      race.beforeRaise = undefined;
      race.afterRaise = undefined;
      await before?.();
      await memoryLinks.raise(link);
      await after?.();
    },
    countLive: (query) => memoryLinks.countLive(query),
    countAll: (query) => memoryLinks.countAll(query),
    deleteForTenant: (query) => memoryLinks.deleteForTenant(query),
    findTenantsWithExpired: (query) => memoryLinks.findTenantsWithExpired(query),
    findExpired: async (query) => {
      clock.now = clock.now.add({ milliseconds: sweepPages.msEach });
      return memoryLinks.findExpired(query);
    },
    deleteExpired: async (query) => {
      if (query.tenantId === sweepPages.refuseTenant) throw new Error("interrupted");
      const before = sweepPages.beforeDelete;
      sweepPages.beforeDelete = undefined;
      await before?.();
      return memoryLinks.deleteExpired(query);
    },
    retime: (query) => memoryLinks.retime(query),
  };
  const service = StoredObjectService.create({
    records,
    ownerLinks,
    permissions: new GrantedStoredObjectPermissions(),
    storage,
    signer: createStoredObjectTestSigner(),
    legacy: new MemoryStoredObjectFiles(),
    delivery: new FixedStoredObjectDelivery(),
    maximumUploadBytes: 1024 * 1024,
    uploadExpiryMs: 15 * 60 * 1000,
    now: () => clock.now,
  });
  const sweeper = StoredObjectRetentionService.create({
    records,
    ownerLinks,
    cleanup: StoredObjectCleanupService.create({
      records,
      ownerLinks,
      storage,
      deleteObject: (target) => service.delete(target),
      now: () => clock.now,
    }),
    now: () => clock.now,
    ...(input.sweepPageSize ? { sweepPageSize: input.sweepPageSize } : {}),
    ...(input.sweepBudgetMs ? { sweepBudgetMs: input.sweepBudgetMs } : {}),
    ...(input.sweepTenantLimit ? { sweepTenantLimit: input.sweepTenantLimit } : {}),
  });

  const reaper = StoredObjectUploadReapService.create({ records, storage, now: () => clock.now });

  function store(overrides: Partial<StoreStoredObjectFromBytesInput> = {}) {
    return service.storeFromBytes({
      projectId: PROJECT,
      purpose: "trace_content",
      ownerKind: "trace",
      ownerId: "t1",
      filename: "image.png",
      mediaType: "image/png",
      audience: "traces:view",
      bytes: PNG,
      retentionDays: retention.days,
      ...overrides,
    });
  }

  async function rowOf(id: string, projectId: StoredObjectProjectId = PROJECT) {
    return records.findById({ tenantId: projectId, id: id as StoredObjectId });
  }

  async function linksOf(id: string, projectId: StoredObjectProjectId = PROJECT) {
    const all = await memoryLinks.findExpired({
      tenantId: projectId,
      before: dayOf(100_000),
      limit: 1_000,
    });
    return all.filter((link) => link.objectId === id);
  }

  return {
    service,
    sweeper,
    reaper,
    storage,
    records,
    memoryLinks,
    clock,
    retention,
    race,
    cleanup,
    sweepPages,
    store,
    rowOf,
    linksOf,
  };
}

export type RetentionFixture = ReturnType<typeof retentionFixture>;
