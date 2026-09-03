import {
  type StoredObjectOwnerClickHouseInstance,
  StoredObjectOwnerInstanceDirectoryPort,
} from "../../ports/stored-object-owner-instance-directory.port";
import {
  StoredObjectOwnerRepository,
  type StoredObjectOwnerHit,
  type StoredObjectOwnerLookupResult,
} from "../../ports/stored-object-owner.repository";

type StoredObjectOwnerRow = Readonly<{
  project_id: string;
}>;

/** Private ClickHouse adapter for the legacy id-only file delivery lookup. */
export class ClickHouseStoredObjectOwnerRepository extends StoredObjectOwnerRepository {
  static create(
    instanceDirectory: StoredObjectOwnerInstanceDirectoryPort,
  ): ClickHouseStoredObjectOwnerRepository {
    return new ClickHouseStoredObjectOwnerRepository(instanceDirectory);
  }

  private constructor(private readonly instanceDirectory: StoredObjectOwnerInstanceDirectoryPort) {
    super();
  }

  async findOwner(id: string): Promise<StoredObjectOwnerLookupResult> {
    const instances = await this.instanceDirectory.listInstances();
    if (instances.length === 0) {
      throw new Error(
        "ClickHouse is not configured — cannot resolve owner project for stored object",
      );
    }

    const lookups = instances.map(
      async ({ client, target }): Promise<StoredObjectOwnerHit | null> => {
        const result = await client.query({
          query: `
          SELECT project_id
          FROM stored_objects
          WHERE id = {id:String}
          LIMIT 1
        `,
          query_params: { id },
          format: "JSONEachRow",
        });
        const rows = await result.json<StoredObjectOwnerRow>();
        const row = rows[0];
        return row ? { projectId: row.project_id, target } : null;
      },
    );

    const settled = await Promise.allSettled(lookups);
    const failedTargets: string[] = [];
    let hit: StoredObjectOwnerHit | null = null;

    settled.forEach((result, index) => {
      if (result.status === "fulfilled") {
        if (result.value && !hit) hit = result.value;
        return;
      }
      failedTargets.push(instances[index]!.target);
    });

    return { hit, failedTargets, instancesSearched: instances.length };
  }
}
