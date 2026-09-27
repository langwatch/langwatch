import { defineServerModule } from "@langwatch/kernel";

import { StoredObjectApp } from "#app/stored-object.app";
import type { StoredObjectsTelemetry } from "#app/stored-object.members";
import type { PayloadStagingRepository } from "#repositories/payload-staging.repository";
import { storedObjectRepositories } from "#repositories/stored-object-repositories.registry";
import { AbsentPayloadStagingService } from "#services/absent-payload-staging.service";
import { AzureBlobCredentialsService } from "#services/azure-blob-credentials.service";
import type {
  AzureBlobCredentialsConfig,
  AzureCredentials,
  AzureInjectedIdentity,
} from "#services/azure-blob-credentials.service";
import { StoredObjectDestinationPolicyService } from "#services/stored-object-destination-policy.service";
import type {
  StoredObjectProjectS3Config,
  StoredObjectStorageSelection,
} from "#services/stored-object-destination-policy.service";
import { StoredObjectStorageRuntimeService } from "#services/stored-object-storage-runtime.service";
import type {
  StoredObjectProjectDestinationResolver,
  StoredObjectStorageRuntimeOptions,
} from "#services/stored-object-storage-runtime.service";
import { StoredObjectsTelemetryService } from "#services/stored-objects-telemetry.service";
import { StoredObjectsService } from "#services/stored-objects.service";
import type { StoredObjectsServiceOptions } from "#services/stored-objects.service";
import { storedObjectFileRest } from "#transport/stored-object-file.rest";
import { storedObjectImageProxyRest } from "#transport/stored-object-image-proxy.rest";
import { storedObjectRest } from "#transport/stored-object.rest";
import { storedObjectTrpcTransport } from "#transport/stored-object.trpc";

export const storedObjectServer = defineServerModule("stored-object")
  .withRepositories(storedObjectRepositories)
  .withApp(StoredObjectApp)
  .withTransports(
    storedObjectRest,
    storedObjectFileRest,
    storedObjectImageProxyRest,
    storedObjectTrpcTransport,
  );

/**
 * Runtime storage and telemetry seams for a composing process: thin
 * factories over this feature's private `services/` adapters, so a
 * composition root never names one directly (private-runtime-export drive).
 */
export function createAbsentPayloadStaging(): PayloadStagingRepository {
  return AbsentPayloadStagingService.create();
}

/** Wraps the static credential resolver so a caller never names the adapter class. */
export function resolveAzureBlobCredentials(options: {
  config: AzureBlobCredentialsConfig;
  purpose?: "read" | "write";
  identity?: AzureInjectedIdentity;
}): AzureCredentials {
  return AzureBlobCredentialsService.create().resolve(options);
}

export function createPrometheusStoredObjectsTelemetry(): StoredObjectsTelemetry {
  return StoredObjectsTelemetryService.create();
}

export function createStoredObjectDestinationPolicy(options: {
  selection: StoredObjectStorageSelection;
  projects: StoredObjectProjectS3Config;
}): StoredObjectProjectDestinationResolver {
  return StoredObjectDestinationPolicyService.create(options);
}

export function createStoredObjectStorageRuntime(
  options: StoredObjectStorageRuntimeOptions,
): StoredObjectStorageRuntimeService {
  return StoredObjectStorageRuntimeService.create(options);
}

export function createStoredObjectsService(
  options: StoredObjectsServiceOptions,
): StoredObjectsService {
  return StoredObjectsService.create(options);
}
