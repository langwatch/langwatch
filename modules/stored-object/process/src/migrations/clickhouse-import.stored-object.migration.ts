import { createHash } from "node:crypto";

import {
  mapLegacyStoredObjectPurposeToAudience,
  storedObjectIdSchema,
  storedObjectMediaTypeSchema,
  storedObjectProjectIdSchema,
  storedObjectSha256Schema,
  type StoredObjectDeliveryAudience,
  type StoredObjectId,
  type StoredObjectProjectId,
} from "@langwatch/stored-object-contract";
import type { TenantMigrationOutcome } from "@langwatch/system-migrations";
import { type Instant, nowInstant, toDate } from "@langwatch/time";
import { defineMigrationStep, type TenantMigrationStep } from "@langwatch/upgrade/step";

import type {
  LegacyStoredObjectRow,
  StoredObjectLegacySourceRepository,
} from "../repositories/stored-object-legacy-source.repository.ts";
import type {
  StoredObjectRecord,
  StoredObjectRecordRepository,
} from "../repositories/stored-object-record.repository.ts";
import { legacyStorageAddressOf } from "../rules/legacy-storage-address.rules.ts";

type ClickHouseImportStoredObjectMigrationOptions = Readonly<{
  legacy: StoredObjectLegacySourceRepository;
  records: StoredObjectRecordRepository;
  pageSize?: number;
  now?: () => Instant;
}>;

/** In-place, idempotent import of one project's legacy rows; the source stays intact. */
export class ClickHouseImportStoredObjectMigration {
  static create(
    options: ClickHouseImportStoredObjectMigrationOptions,
  ): ClickHouseImportStoredObjectMigration {
    return new ClickHouseImportStoredObjectMigration(options);
  }

  private readonly now: () => Instant;

  private constructor(private readonly options: ClickHouseImportStoredObjectMigrationOptions) {
    this.now = options.now ?? nowInstant;
  }

  /**
   * Per project, waiting until no old image serves: old images are the only legacy writers, so
   * the serving roster replaces a drain proof (Alex, 2026-10-09). Legacy reads stay in place.
   */
  step(): TenantMigrationStep {
    return defineMigrationStep({
      id: "stored-object:import-clickhouse-index",
      kind: "tenant",
      mode: "background",
      tenants: "project",
      needsOldWritersGone: true,
      title: "Stored Objects ClickHouse import",
      description:
        "Copies each project's latest Stored Object metadata from the ClickHouse index into Postgres.",
      requiresOperatorConfirmation: false,
      runsAutomaticallyOnSelfHosted: true,
      enrolledAutomatically: true,
      migrateTenant: (args) => this.migrateTenant(args),
    });
  }

  async migrateTenant({
    tenantId,
    signal,
  }: {
    tenantId: string;
    signal?: AbortSignal;
  }): Promise<TenantMigrationOutcome> {
    const counts = await this.importProject({ projectId: tenantId, signal });
    return { status: "finalized", report: { kind: "stored_objects_imported", ...counts } };
  }

  private async importProject({
    projectId,
    signal,
  }: {
    projectId: string;
    signal?: AbortSignal | undefined;
  }): Promise<{ scanned: number; imported: number; unchanged: number }> {
    const counts = { scanned: 0, imported: 0, unchanged: 0 };
    const limit = this.options.pageSize ?? 250;
    let afterId: string | undefined;
    let isFullPage: boolean;
    do {
      const query: { projectId: string; afterId?: string; limit: number } = { projectId, limit };
      if (afterId) query.afterId = afterId;
      const page = await this.options.legacy.findPage(query);
      for (const row of page) {
        this.assertActive(signal);
        counts.scanned += 1;
        const result = await this.importRow(row, projectId);
        if (result === "imported") counts.imported += 1;
        else counts.unchanged += 1;
      }
      isFullPage = page.length >= limit;
      afterId = page.at(-1)?.id;
    } while (isFullPage && afterId);
    return counts;
  }

  private async importRow(
    row: LegacyStoredObjectRow,
    expectedProjectId: string,
  ): Promise<"imported" | "unchanged"> {
    const projectId = storedObjectProjectIdSchema.parse(row.projectId);
    if (projectId !== expectedProjectId) {
      throw new TypeError("Legacy Stored Object crossed its project scope");
    }
    const id = storedObjectIdSchema.parse(row.id);
    const sha256 = storedObjectSha256Schema.parse(row.sha256);
    const mediaType = storedObjectMediaTypeSchema.parse(row.mediaType);
    if (!Number.isSafeInteger(row.sizeBytes) || row.sizeBytes < 0) {
      throw new TypeError("Legacy Stored Object byte length is invalid");
    }
    const audience = mapLegacyStoredObjectPurposeToAudience(row.purpose);
    if (!audience) {
      throw new TypeError("Legacy Stored Object purpose has no delivery audience");
    }
    const address = legacyStorageAddressOf({ projectId, storageUri: row.storageUri });
    const fingerprint = this.fingerprint(row);
    const current = await this.options.records.findById({ tenantId: projectId, id });
    if (current?.source === "canonical" || current?.legacyFingerprint === fingerprint) {
      return "unchanged";
    }
    const now = this.now();
    await this.options.records.upsert(
      this.importedRecord({
        row,
        projectId,
        id,
        sha256,
        mediaType,
        audience,
        fingerprint,
        current,
        now,
        address,
      }),
    );
    return "imported";
  }

  private importedRecord(input: {
    row: LegacyStoredObjectRow;
    projectId: StoredObjectProjectId;
    id: StoredObjectId;
    sha256: string;
    mediaType: string;
    audience: StoredObjectDeliveryAudience;
    fingerprint: string;
    current: StoredObjectRecord | null;
    now: Instant;
    address: StoredObjectRecord["storage"];
  }): StoredObjectRecord {
    return {
      tenantId: input.projectId,
      id: input.id,
      status: "available",
      purpose: input.row.purpose,
      ownerKind: input.row.ownerKind,
      ownerId: input.row.ownerId,
      filename: input.row.id,
      sha256: input.sha256,
      byteLength: input.row.sizeBytes,
      mediaType: input.mediaType,
      mediaTypeVerified: true,
      storage: input.address,
      generation: (input.current?.generation ?? 0) + 1,
      audiences: [input.audience],
      expiresAt: null,
      availableAt: input.row.createdAt,
      deletedAt: null,
      source: "imported",
      legacyFingerprint: input.fingerprint,
      createdAt: input.current?.createdAt ?? input.row.createdAt,
      updatedAt: input.now,
    };
  }

  private fingerprint(row: LegacyStoredObjectRow): string {
    return createHash("sha256")
      .update(
        JSON.stringify([
          row.id,
          row.projectId,
          row.purpose,
          row.ownerKind,
          row.ownerId,
          row.mediaType,
          row.sizeBytes,
          row.sha256,
          row.storageUri,
          toDate(row.insertedAt).toISOString(),
        ]),
      )
      .digest("hex");
  }

  private assertActive(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw signal.reason ?? new Error("Stored Objects migration aborted");
    }
  }
}
