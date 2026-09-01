import {
  type StoredObjectOwnerClickHouseInstance,
  StoredObjectOwnerInstanceDirectoryPort,
} from "@langwatch/stored-object-server";

/**
 * App-owned directory adapter for the ClickHouse instances in this process.
 *
 * The lister arrives by injection rather than by import: ClickHouse client
 * access has two doors, and `presets.ts` is the one that resolves clients
 * (`src/server/clickhouse/__tests__/clientImportBoundary.unit.test.ts`).
 */
export class AppStoredObjectOwnerInstanceDirectory extends StoredObjectOwnerInstanceDirectoryPort {
  static create(options: {
    listInstances: () => Promise<ReadonlyArray<StoredObjectOwnerClickHouseInstance>>;
  }): AppStoredObjectOwnerInstanceDirectory {
    return new AppStoredObjectOwnerInstanceDirectory(options.listInstances);
  }

  static createUnavailableForTests(): AppStoredObjectOwnerInstanceDirectory {
    return new AppStoredObjectOwnerInstanceDirectory(async () => []);
  }

  private constructor(
    private readonly listInstancesInProcess: () => Promise<
      ReadonlyArray<StoredObjectOwnerClickHouseInstance>
    >,
  ) {
    super();
  }

  async listInstances(): Promise<ReadonlyArray<StoredObjectOwnerClickHouseInstance>> {
    return await this.listInstancesInProcess();
  }
}
