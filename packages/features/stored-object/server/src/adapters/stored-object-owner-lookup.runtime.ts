import { ClickHouseStoredObjectOwnerRepository } from "../repositories/clickhouse/clickhouse.stored-object-owner.repository";
import { StoredObjectOwnerLookupService } from "../services/stored-object-owner-lookup.service";
import { StoredObjectOwnerLookupTelemetryPort } from "../ports/stored-object-owner-lookup-telemetry.port";
import { StoredObjectOwnerInstanceDirectoryPort } from "../ports/stored-object-owner-instance-directory.port";
import type { StoredObjectOwnerResolver } from "@langwatch/stored-object-contract";

/** Process-composed compatibility graph for legacy id-only stored-object URLs. */
export class StoredObjectOwnerLookupRuntime {
  static create(input: {
    instanceDirectory: StoredObjectOwnerInstanceDirectoryPort;
    telemetry: StoredObjectOwnerLookupTelemetryPort;
  }): StoredObjectOwnerLookupRuntime {
    const repository = ClickHouseStoredObjectOwnerRepository.create(input.instanceDirectory);
    const resolver = StoredObjectOwnerLookupService.create({
      repository,
      telemetry: input.telemetry,
    });
    return new StoredObjectOwnerLookupRuntime(resolver);
  }

  private constructor(readonly resolver: StoredObjectOwnerResolver) {}
}
