/**
 * Builds {@link StoredObjectInfrastructure} over the process's `objectStorage`
 * member (ADR-158 §1). Omits legacy owner lookup (see stored-object-composition-green).
 */
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { Logger } from "@langwatch/observability";
import type { Encryption, ObjectStorage } from "@langwatch/process-stores/members";
import {
  StoredObjectOwnerResolver,
  StoredObjectCapabilityUnavailableError,
  type StoredObjectDeliveryCapability,
  mintStoredObjectUri,
} from "@langwatch/stored-object-contract";

import { ClickHouseStoredObjectsRepository } from "../repositories/clickhouse/stored-objects.repository.ts";
import { ObjectStorageStoredObjectStorageRepository } from "../repositories/object-storage/object-storage.stored-object-storage.repository.ts";
import { PrometheusStoredObjectsTelemetryAdapter } from "../services/prometheus.stored-objects-telemetry.service.ts";
import { StoredObjectStorageService } from "../services/stored-object-storage.service.ts";
import { StoredObjectUploadSignerService } from "../services/stored-object-upload-signer.service.ts";
import { StoredObjectsService } from "../services/stored-objects.service.ts";
import type { StoredObjectInfrastructure } from "./stored-object.app.ts";
import {
  StoredObjectDelivery,
  type StoredObjectsClickHouse,
  type StoredObjectsClickHouseClient,
} from "./stored-object.members.ts";

/** What `buildStoredObjectInfrastructure` reads off the process's own members. */
export type StoredObjectProcessMembers = Readonly<{
  clickhouse: ClickHouseQueryClient;
  logger: Logger;
  objectStorage: ObjectStorage;
  encryption: Encryption;
  publicBaseUrl: string | undefined;
}>;

/** The in-process write ceiling, and the 15-minute pending-upload TTL (ADR-158 §4). */
const MAXIMUM_UPLOAD_BYTES = 100 * 1024 * 1024;
const UPLOAD_EXPIRY_MS = 15 * 60 * 1000;

/**
 * The delivery capability, absent. Minting one signs a URL against a policy
 * this process composes no signer for, so the operation refuses by name
 * rather than answering a link nothing honours.
 */
class UnavailableStoredObjectDelivery extends StoredObjectDelivery {
  async mint(): Promise<StoredObjectDeliveryCapability> {
    throw new StoredObjectCapabilityUnavailableError("Stored-object delivery");
  }
}

/**
 * The routed ClickHouse member, adapted to the low-level driver shape the
 * stored-objects repository asks for. One tenant per resolution, exactly as
 * the table's own rule requires (every statement names its tenant).
 */
class MemberStoredObjectsClickHouseClient implements StoredObjectsClickHouseClient {
  constructor(
    private readonly clickhouse: ClickHouseQueryClient,
    private readonly tenantId: string,
  ) {}

  async insert(input: {
    table: string;
    values: readonly Record<string, unknown>[];
    clickhouse_settings?: Record<string, unknown>;
  }): Promise<unknown> {
    return this.clickhouse.insert({
      tenantId: this.tenantId,
      table: input.table,
      rows: input.values,
      ...(input.clickhouse_settings
        ? { settings: input.clickhouse_settings as Record<string, string | number> }
        : {}),
    });
  }

  async query(input: {
    query: string;
    query_params: Record<string, unknown>;
  }): Promise<{ json<Result>(): Promise<Result[]> }> {
    const result = await this.clickhouse.query({
      tenantId: this.tenantId,
      sql: input.query,
      params: input.query_params,
    });
    return { json: async <Result>() => result.rows as Result[] };
  }

  async exec(input: {
    query: string;
    query_params: Record<string, unknown>;
    clickhouse_settings?: Record<string, unknown>;
  }): Promise<unknown> {
    return this.clickhouse.command({
      tenantId: this.tenantId,
      sql: input.query,
      params: input.query_params,
      ...(input.clickhouse_settings
        ? { settings: input.clickhouse_settings as Record<string, string | number> }
        : {}),
    });
  }
}

/** Resolves the routed ClickHouse client one project's stored-object rows live on. */
class MemberStoredObjectsClickHouse implements StoredObjectsClickHouse {
  constructor(private readonly clickhouse: ClickHouseQueryClient) {}

  async resolveClient(projectId: string): Promise<StoredObjectsClickHouseClient> {
    return new MemberStoredObjectsClickHouseClient(this.clickhouse, projectId);
  }
}

/**
 * The legacy id-only owner lookup, absent. Resolving a project from an object
 * id alone means scanning every ClickHouse instance the deployment operates;
 * this process composes no such directory (tracked gap, see the handoff).
 */
class StoredObjectOwnerAbsence extends StoredObjectOwnerResolver {
  constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  async tryResolve(input: { id: string }): Promise<{ projectId: string } | null> {
    this.logger.warn(
      { storedObjectId: input.id },
      "API process composed no stored-object owner directory: an id-only stored-object reference cannot be resolved to a project here.",
    );
    return null;
  }
}

/** Builds the {@link StoredObjectInfrastructure} `StoredObjectApp.create` composes over. */
export function buildStoredObjectInfrastructure(input: {
  members: StoredObjectProcessMembers;
}): StoredObjectInfrastructure {
  const { members } = input;
  const objectStorage = members.objectStorage;

  const bytes = StoredObjectsService.create({
    repository: ClickHouseStoredObjectsRepository.create(
      new MemberStoredObjectsClickHouse(members.clickhouse),
    ),
    registry: (projectId: string) =>
      ObjectStorageStoredObjectStorageRepository.create({ objectStorage, projectId }),
    mintStorageUri: async ({ projectId, sha256 }) => {
      const destination = await objectStorage.destination(projectId);
      if (destination.kind === "memory") {
        throw new Error("The legacy index names no URI for in-memory object storage.");
      }
      return mintStoredObjectUri({ destination, objectPath: `${projectId}/${sha256}` });
    },
    telemetry: PrometheusStoredObjectsTelemetryAdapter.create(),
  });

  return {
    storage: StoredObjectStorageService.create({ objectStorage }),
    delivery: new UnavailableStoredObjectDelivery(),
    signer: StoredObjectUploadSignerService.create({
      encryption: members.encryption,
      publicBaseUrl: members.publicBaseUrl,
    }),
    maximumUploadBytes: MAXIMUM_UPLOAD_BYTES,
    uploadExpiryMs: UPLOAD_EXPIRY_MS,
    files: bytes,
    owners: new StoredObjectOwnerAbsence(members.logger),
  } satisfies StoredObjectInfrastructure;
}
