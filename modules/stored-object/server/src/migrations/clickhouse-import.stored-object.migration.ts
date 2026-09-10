import { createHash } from "node:crypto";
import {
  audienceForLegacyStoredObjectPurpose,
  storedObjectIdSchema,
  storedObjectMediaTypeSchema,
  storedObjectProjectIdSchema,
  storedObjectSha256Schema,
  type StoredObjectDeliveryAudience,
  type StoredObjectId,
  type StoredObjectProjectId,
} from "@langwatch/stored-object-contract";
import type { SystemMigration, TenantMigrationOutcome } from "@langwatch/system-migrations";
import { StoredObjectLegacyLocation } from "../repositories/stored-object-legacy-location.repository.ts";
import {
  StoredObjectLegacySource,
  type LegacyStoredObjectRow,
} from "../repositories/stored-object-legacy-source.repository.ts";
import { StoredObjectLegacyWriterDrain } from "../repositories/stored-object-legacy-writer-drain.repository.ts";
import { StoredObjectProjectSource } from "../repositories/stored-object-project-source.repository.ts";
import type {
  StoredObjectRecord,
  StoredObjectRecordRepository,
} from "../repositories/stored-object-record.repository.ts";
import { type Instant, nowInstant, toDate } from "@langwatch/time";

export const STORED_OBJECTS_CLICKHOUSE_IMPORT_MIGRATION_NAME =
  "stored-objects-clickhouse-import-v0" as const;

export type ClickHouseImportStoredObjectMigrationOptions = Readonly<{
  projects: StoredObjectProjectSource;
  legacy: StoredObjectLegacySource;
  locations: StoredObjectLegacyLocation;
  drain: StoredObjectLegacyWriterDrain;
  records: StoredObjectRecordRepository;
  pageSize?: number;
  now?: () => Instant;
}>;

/** In-place, idempotent import driven by the shared system-migration runner. */
export class ClickHouseImportStoredObjectMigration implements SystemMigration {
  readonly executionMode = "startup" as const;
  readonly name = STORED_OBJECTS_CLICKHOUSE_IMPORT_MIGRATION_NAME;
  readonly title = "Stored Objects ClickHouse import";
  readonly description =
    "Imports each organization's latest Stored Object metadata from " +
    "ClickHouse into Postgres, then waits for proof that legacy writers have " +
    "drained before allowing the tenant to cut over.";
  readonly requiresOperatorConfirmation = false;
  readonly runsAutomaticallyOnSelfHosted = true;
  readonly enrolledAutomatically = true;

  static create(
    options: ClickHouseImportStoredObjectMigrationOptions,
  ): ClickHouseImportStoredObjectMigration {
    return new ClickHouseImportStoredObjectMigration(options);
  }

  private readonly now: () => Instant;

  private constructor(private readonly options: ClickHouseImportStoredObjectMigrationOptions) {
    this.now = options.now ?? nowInstant;
  }

  async migrateTenant(input: {
    tenantId: string;
    signal?: AbortSignal;
  }): Promise<TenantMigrationOutcome> {
    const initialDrain = await this.options.drain.get({ organizationId: input.tenantId });
    const projects = await this.options.projects.listForOrganization({
      organizationId: input.tenantId,
    });
    let scanned = 0;
    let imported = 0;
    let unchanged = 0;
    for (const project of projects) {
      this.assertActive(input.signal);
      let afterId: string | undefined;
      for (;;) {
        const query: { projectId: string; afterId?: string; limit: number } = {
          projectId: project.id,
          limit: this.options.pageSize ?? 250,
        };
        if (afterId) query.afterId = afterId;
        const page = await this.options.legacy.findPage(query);
        for (const row of page) {
          this.assertActive(input.signal);
          scanned += 1;
          const result = await this.importRow(row, project.id);
          if (result === "imported") imported += 1;
          else unchanged += 1;
        }
        if (page.length < (this.options.pageSize ?? 250)) break;
        afterId = page.at(-1)?.id;
        if (!afterId) break;
      }
    }

    const drain = initialDrain.valid
      ? await this.options.drain.get({
          organizationId: input.tenantId,
        })
      : initialDrain;
    if (drain.valid) {
      return {
        status: "finalized",
        report: {
          kind: "stored_objects_imported",
          projects: projects.length,
          scanned,
          imported,
          unchanged,
          drainProved: true,
          minimumWriterGeneration: drain.minimumWriterGeneration,
        },
      };
    }
    return {
      status: "migrated",
      report: {
        kind: "stored_objects_held",
        projects: projects.length,
        scanned,
        imported,
        unchanged,
        drainProved: false,
      },
    };
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
    const audience = audienceForLegacyStoredObjectPurpose(row.purpose);
    if (!audience) {
      throw new TypeError("Legacy Stored Object purpose has no delivery audience");
    }
    const address = await this.options.locations.parse({
      projectId,
      storageUri: row.storageUri,
    });
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
