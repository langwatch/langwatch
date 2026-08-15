import type { ClickHouseClient } from "@clickhouse/client";

const TABLE_NAME = "stored_objects";

export interface ClickHouseInstance {
  target: "shared" | string;
  client: ClickHouseClient;
}

/** Every configured ClickHouse instance — the shared one plus any
 *  private/BYOC ones. Distinct from `ClickHouseClientResolver`: this
 *  repository has no tenant to resolve by, which is the whole point of
 *  the lookup it runs. */
export type ClickHouseInstancesResolver = () => Promise<ClickHouseInstance[]>;

export interface StoredObjectOwnerHit {
  projectId: string;
  target: string;
}

export interface StoredObjectOwnerLookupResult {
  /** The first instance to answer with a match, or null if none did. */
  hit: StoredObjectOwnerHit | null;
  /** Instances whose query rejected, by target label. Empty when every
   *  instance answered, hit or not. */
  failedTargets: string[];
  /** How many instances this lookup fanned out to. */
  instancesSearched: number;
}

/**
 * Cross-tenant fan-out lookup of a stored object's owning project.
 *
 * No `TenantId` predicate, deliberately: the caller does not yet know which
 * tenant owns the row, which is the entire question this repository answers.
 * It queries every configured ClickHouse instance (shared + every
 * private/BYOC instance) in parallel — the service above decides what a
 * partial failure means (`StoredObjectOwnerLookupUnavailableError`), this
 * repository only reports which instances answered and which didn't.
 */
export class StoredObjectOwnerClickHouseRepository {
  constructor(private readonly resolveInstances: ClickHouseInstancesResolver) {}

  async findOwner(id: string): Promise<StoredObjectOwnerLookupResult> {
    const instances = await this.resolveInstances();
    if (instances.length === 0) {
      throw new Error(
        "ClickHouse is not configured — cannot resolve owner project for stored object",
      );
    }

    const lookups = instances.map(async ({ client, target }) => {
      const result = await client.query({
        query: `
          SELECT project_id
          FROM ${TABLE_NAME}
          WHERE id = {id:String}
          LIMIT 1
        `,
        query_params: { id },
        format: "JSONEachRow",
      });
      const rows = await result.json<{ project_id: string }>();
      return rows.length > 0
        ? { projectId: rows[0]!.project_id, target }
        : null;
    });

    const settled = await Promise.allSettled(lookups);

    const failedTargets: string[] = [];
    let hit: StoredObjectOwnerHit | null = null;
    settled.forEach((r, index) => {
      if (r.status === "fulfilled") {
        if (r.value !== null && hit === null) {
          hit = r.value;
        }
      } else {
        failedTargets.push(instances[index]!.target);
      }
    });

    return { hit, failedTargets, instancesSearched: instances.length };
  }
}
