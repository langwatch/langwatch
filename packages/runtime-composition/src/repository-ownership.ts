/** Inert storage identities declared by a private repository. */
export interface RepositoryTables {
  readonly store: string;
  readonly tables: readonly string[];
}

export interface RepositoryDeclaration {
  readonly tables: RepositoryTables;
}

export type FeatureRepositories = Readonly<Record<string, RepositoryDeclaration>>;

export interface FeatureRepositoryClaims {
  readonly name: string;
  readonly repositories?: FeatureRepositories;
}

export class RepositoryOwnershipConflictError extends Error {
  constructor(
    readonly store: string,
    readonly table: string,
    readonly owners: readonly [string, string],
  ) {
    super(
      `Table ${store}/${table} is claimed by both ${owners[0]} and ${owners[1]}. ` +
        "Keep one feature owner and call its API from the other feature.",
    );
    this.name = "RepositoryOwnershipConflictError";
  }
}

/** Snapshot at declaration time so later mutation cannot change a boot's claims. */
export function snapshotRepositories(repositories: FeatureRepositories = {}): FeatureRepositories {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(repositories).map(([name, repository]) => [
        name,
        Object.freeze({
          tables: Object.freeze({
            store: repository.tables.store,
            tables: Object.freeze([...repository.tables.tables]),
          }),
        }),
      ]),
    ),
  );
}

export function assertRepositoryOwnership(features: readonly FeatureRepositoryClaims[]): void {
  const stores = new Map<string, Map<string, string>>();

  for (const feature of features) {
    for (const repository of Object.values(feature.repositories ?? {})) {
      claimRepository(stores, feature.name, repository.tables);
    }
  }
}

function claimRepository(
  stores: Map<string, Map<string, string>>,
  owner: string,
  { store, tables }: RepositoryTables,
): void {
  const canonicalStore = store === "prisma" ? "postgres" : store;
  if (canonicalStore.trim().length === 0 || tables.length === 0) {
    throw new Error(`Feature ${owner} declared an empty repository ownership claim.`);
  }

  let owners = stores.get(canonicalStore);
  if (!owners) {
    owners = new Map();
    stores.set(canonicalStore, owners);
  }

  for (const table of tables) {
    if (table.trim().length === 0) {
      throw new Error(`Feature ${owner} declared an empty table identity.`);
    }
    const previous = owners.get(table);
    if (previous && previous !== owner) {
      throw new RepositoryOwnershipConflictError(canonicalStore, table, [previous, owner]);
    }
    owners.set(table, owner);
  }
}
