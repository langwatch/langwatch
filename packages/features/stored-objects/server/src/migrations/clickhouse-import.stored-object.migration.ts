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
} from "@langwatch/stored-objects-contract";
import type {
  SystemMigration,
  TenantMigrationOutcome,
} from "@langwatch/system-migrations";
import {
  StoredObjectLegacyLocationPort,
  StoredObjectLegacySourcePort,
  StoredObjectLegacyWriterDrainPort,
  StoredObjectProjectSourcePort,
  type LegacyStoredObjectRow,
} from "../ports/stored-object.port";
import {
  StoredObjectStore,
  type StoredObjectRecord,
} from "../stores/stored-object.store";

export const STORED_OBJECTS_CLICKHOUSE_IMPORT_MIGRATION_NAME =
  "stored-objects-clickhouse-import-v0" as const;

export type ClickHouseImportStoredObjectMigrationOptions = Readonly<{
  projects: StoredObjectProjectSourcePort;
  legacy: StoredObjectLegacySourcePort;
  locations: StoredObjectLegacyLocationPort;
  drain: StoredObjectLegacyWriterDrainPort;
  store: StoredObjectStore;
  pageSize?: number;
  now?: () => Date;
}>;

/** In-place, idempotent import driven by the shared system-migration runner. */
export class ClickHouseImportStoredObjectMigration implements SystemMigration {
  readonly name = STORED_OBJECTS_CLICKHOUSE_IMPORT_MIGRATION_NAME;

  static create(
    options: ClickHouseImportStoredObjectMigrationOptions,
  ): ClickHouseImportStoredObjectMigration {
    return new ClickHouseImportStoredObjectMigration(options);
  }

  private readonly now: () => Date;

  private constructor(
    private readonly options: ClickHouseImportStoredObjectMigrationOptions,
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async migrateTenant(input: {
    tenantId: string;
    signal?: AbortSignal;
  }): Promise<TenantMigrationOutcome> {
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

    const drain = await this.options.drain.get({
      organizationId: input.tenantId,
    });
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
      throw new TypeError(
        "Legacy Stored Object purpose has no delivery audience",
      );
    }
    const address = await this.options.locations.parse({
      projectId,
      storageUri: row.storageUri,
    });
    const fingerprint = this.fingerprint(row);
    const current = await this.options.store.find({ tenantId: projectId, id });
    if (
      current?.source === "canonical" ||
      current?.legacyFingerprint === fingerprint
    ) {
      return "unchanged";
    }
    const now = this.now();
    await this.options.store.save(
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
    now: Date;
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
          row.insertedAt.toISOString(),
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
