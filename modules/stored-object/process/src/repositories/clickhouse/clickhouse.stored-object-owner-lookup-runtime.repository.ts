import type { StoredObjectOwnerResolver } from "@langwatch/stored-object-contract";

import { type StoredObjectOwnerLookupTelemetry } from "../../app/stored-object.members.ts";
import { StoredObjectOwnerLookupService } from "../../services/stored-object-owner-lookup.service.ts";
import type { StoredObjectOwnerInstanceDirectoryRepository } from "../stored-object-owner-instance-directory.repository.ts";
import { ClickHouseStoredObjectOwnerRepository } from "./clickhouse.stored-object-owner.repository.ts";

/** Process-composed compatibility graph for legacy id-only stored-object URLs. */
export class ClickhouseStoredObjectOwnerLookupRuntimeRepository {
  static create(input: {
    instanceDirectory: StoredObjectOwnerInstanceDirectoryRepository;
    telemetry: StoredObjectOwnerLookupTelemetry;
  }): ClickhouseStoredObjectOwnerLookupRuntimeRepository {
    const repository = ClickHouseStoredObjectOwnerRepository.create(input.instanceDirectory);
    const resolver = StoredObjectOwnerLookupService.create({
      repository,
      telemetry: input.telemetry,
    });
    return new ClickhouseStoredObjectOwnerLookupRuntimeRepository(resolver);
  }

  private constructor(readonly resolver: StoredObjectOwnerResolver) {}
}
