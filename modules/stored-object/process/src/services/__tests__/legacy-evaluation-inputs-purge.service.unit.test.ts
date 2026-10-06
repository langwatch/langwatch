/**
 * @vitest-environment node
 * @see modules/stored-object/specs/stored-objects.feature
 */
import type { StoredObjectId, StoredObjectProjectId } from "@langwatch/stored-object-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryStoredObjectRecordRepository } from "../../repositories/memory/memory.stored-object-record.repository.ts";
import {
  StoredObjectBytesRepository,
  type StoredObjectStorageAddress,
} from "../../repositories/stored-object-bytes.repository.ts";
import type { StoredObjectRecord } from "../../repositories/stored-object-record.repository.ts";
import { LegacyEvaluationInputsPurgeService } from "../legacy-evaluation-inputs-purge.service.ts";

const AT = Temporal.Instant.from("2026-08-22T00:00:00.000Z");
const signal = new AbortController().signal;

function row(id: string, tenantId: string, purpose: string): StoredObjectRecord {
  return {
    tenantId: tenantId as StoredObjectProjectId,
    id: id as StoredObjectId,
    status: "available",
    purpose,
    ownerKind: "evaluation",
    ownerId: "run-1",
    filename: "inputs.json",
    sha256: "a".repeat(64),
    byteLength: 3,
    mediaType: "application/json",
    mediaTypeVerified: true,
    storage: { provider: "s3", destinationId: "primary", relativeId: `${tenantId}/${id}` },
    generation: 0,
    audiences: ["evaluations:view"],
    expiresAt: null,
    availableAt: AT,
    deletedAt: null,
    source: "canonical",
    legacyFingerprint: null,
    createdAt: AT,
    updatedAt: AT,
  };
}

class RecordingBytes extends StoredObjectBytesRepository {
  constructor(
    private readonly deleted: string[],
    private readonly failOn?: string,
  ) {
    super();
  }

  async delete({ address }: { address: StoredObjectStorageAddress }): Promise<void> {
    if (address.relativeId === this.failOn) throw new Error("storage down");
    this.deleted.push(address.relativeId);
  }

  async place(): Promise<never> {
    throw new Error("not used");
  }
  async write(): Promise<never> {
    throw new Error("not used");
  }
  async signUpload(): Promise<never> {
    throw new Error("not used");
  }
  async getStat(): Promise<never> {
    throw new Error("not used");
  }
  async getBytes(): Promise<never> {
    throw new Error("not used");
  }
  async resolveDestination(): Promise<never> {
    throw new Error("not used");
  }
  async probe(): Promise<never> {
    throw new Error("not used");
  }
}

function bytesRecording(deleted: string[], failOn?: string): StoredObjectBytesRepository {
  return new RecordingBytes(deleted, failOn);
}

describe("LegacyEvaluationInputsPurgeService", () => {
  describe("given main-era evaluation_inputs rows beside other purposes", () => {
    /** @scenario "The purge removes main-era evaluation input objects and keeps every other purpose" */
    it("deletes their bytes and rows across pages and keeps the rest", async () => {
      const records = MemoryStoredObjectRecordRepository.create([
        row("so_1", "p1", "evaluation_inputs"),
        row("so_2", "p1", "trace_content"),
        row("so_3", "p2", "evaluation_inputs"),
        row("so_4", "p3", "evaluation_inputs"),
      ]);
      const deleted: string[] = [];
      const service = LegacyEvaluationInputsPurgeService.create({
        records,
        bytes: bytesRecording(deleted),
        pageSize: 2,
      });

      const report = await service.purge({ apply: true, signal });

      expect(report).toEqual({ scanned: 3, bytesDeleted: 3, rowsDeleted: 3, failed: 0 });
      expect(deleted).toEqual(["p1/so_1", "p2/so_3", "p3/so_4"]);
      await expect(
        records.findById({ tenantId: "p1" as StoredObjectProjectId, id: "so_2" as StoredObjectId }),
      ).resolves.not.toBeNull();
    });

    /** @scenario "The purge removes main-era evaluation input objects and keeps every other purpose" */
    it("only counts on a dry run", async () => {
      const records = MemoryStoredObjectRecordRepository.create([
        row("so_1", "p1", "evaluation_inputs"),
      ]);
      const deleted: string[] = [];
      const service = LegacyEvaluationInputsPurgeService.create({
        records,
        bytes: bytesRecording(deleted),
      });

      const report = await service.purge({ apply: false, signal });

      expect(report).toEqual({ scanned: 1, bytesDeleted: 0, rowsDeleted: 0, failed: 0 });
      expect(deleted).toEqual([]);
    });
  });

  describe("given storage refuses one delete", () => {
    /** @scenario "A purge that cannot delete an object's bytes keeps its row for the next run" */
    it("keeps that row, deletes the others and reports the failure", async () => {
      const records = MemoryStoredObjectRecordRepository.create([
        row("so_1", "p1", "evaluation_inputs"),
        row("so_2", "p1", "evaluation_inputs"),
      ]);
      const service = LegacyEvaluationInputsPurgeService.create({
        records,
        bytes: bytesRecording([], "p1/so_1"),
      });

      const report = await service.purge({ apply: true, signal });

      expect(report).toEqual({ scanned: 2, bytesDeleted: 1, rowsDeleted: 1, failed: 1 });
      await expect(
        records.findById({ tenantId: "p1" as StoredObjectProjectId, id: "so_1" as StoredObjectId }),
      ).resolves.not.toBeNull();
    });
  });
});
