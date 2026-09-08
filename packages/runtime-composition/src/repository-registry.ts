import { snapshotRepositories } from "./repository-ownership.ts";

type RepositoryProvider = Readonly<{
  readonly requires: readonly string[];
  readonly create: (...arguments_: never[]) => unknown;
  readonly repositories?: import("./repository-ownership.ts").FeatureRepositories;
}>;

type ProviderArguments<Provider> =
  Provider extends Readonly<{
    create: (...arguments_: infer Arguments) => unknown;
  }>
    ? Arguments
    : never;

type ProviderRequirements<Provider> =
  Provider extends Readonly<{
    requires: readonly (infer Key extends PropertyKey)[];
  }>
    ? Key
    : never;

type InfrastructureKeysMatch<Provider, Infrastructure> =
  | Exclude<keyof Infrastructure, ProviderRequirements<Provider>>
  | Exclude<ProviderRequirements<Provider>, keyof Infrastructure>;

type ValidInfrastructure<Provider, Infrastructure> = Infrastructure extends object
  ? InfrastructureKeysMatch<Provider, Infrastructure> extends never
    ? Provider
    : never
  : never;

type ValidProvider<Provider> =
  ProviderArguments<Provider> extends []
    ? ProviderRequirements<Provider> extends never
      ? Provider
      : never
    : ProviderArguments<Provider> extends [infer Infrastructure]
      ? ValidInfrastructure<Provider, Infrastructure>
      : never;

export type PersistenceSelection = Readonly<{
  readonly backend: string;
  readonly infrastructure: Readonly<Record<string, unknown>>;
}>;

type ProviderResult<Provider> =
  Provider extends Readonly<{
    create: (...arguments_: never[]) => infer Repository;
  }>
    ? Repository
    : never;

export type RepositoryBackends<Registry> =
  Registry extends RepositoryRegistry<infer Definitions> ? keyof Definitions : never;

export type RepositoriesFor<Registry, Backend extends PropertyKey> =
  Registry extends RepositoryRegistry<infer Definitions>
    ? Backend extends keyof Definitions
      ? ProviderResult<Definitions[Backend]>
      : never
    : never;

export type RepositoryRegistry<Definitions extends Record<string, RepositoryProvider>> = Readonly<{
  readonly definitions: Definitions;
}>;

export function defineRepositories<const Definitions extends Record<string, RepositoryProvider>>(
  definitions: Definitions & {
    readonly [Backend in keyof Definitions]: ValidProvider<Definitions[Backend]>;
  },
): RepositoryRegistry<Definitions> {
  const captured = { ...definitions };
  for (const backend in definitions) {
    if (!Object.hasOwn(definitions, backend)) continue;
    const provider = definitions[backend];
    const snapshot = {
      ...provider,
      requires: Object.freeze([...provider.requires]),
      repositories: snapshotRepositories(provider.repositories),
      create: provider.create.bind(provider),
    };
    Object.freeze(snapshot);
    captured[backend] = snapshot;
  }

  return Object.freeze({ definitions: Object.freeze(captured) });
}

export function instantiateRepositories<
  Definitions extends Record<string, RepositoryProvider>,
  Backend extends keyof Definitions,
>(
  registry: RepositoryRegistry<Definitions>,
  persistence: PersistenceSelection & Readonly<{ backend: Backend }>,
): RepositoriesFor<RepositoryRegistry<Definitions>, Backend> {
  validateRepositorySelection(registry, persistence);
  const provider = registry.definitions[persistence.backend];
  if (!provider) throw new Error(`Persistence "${persistence.backend}" was not validated.`);
  const infrastructure: Record<string, unknown> = {};
  for (const key of provider.requires) infrastructure[key] = persistence.infrastructure[key];
  return Reflect.apply(provider.create, provider, [infrastructure]) as RepositoriesFor<
    RepositoryRegistry<Definitions>,
    Backend
  >;
}

export function validateRepositorySelection(
  registry: RepositoryRegistry<Record<string, RepositoryProvider>>,
  persistence: PersistenceSelection,
): void {
  const provider = registry.definitions[persistence.backend];
  if (!provider) throw new Error(`No "${persistence.backend}" repository implementation exists.`);
  for (const key of provider.requires) {
    const value = persistence.infrastructure[key];
    const present =
      Object.hasOwn(persistence.infrastructure, key) && value !== null && value !== void 0;
    if (!present) {
      throw new Error(`Persistence "${persistence.backend}" requires infrastructure "${key}".`);
    }
  }
}

export function selectedRepositoryOwnership(
  registry: RepositoryRegistry<Record<string, RepositoryProvider>>,
  persistence: PersistenceSelection,
): import("./repository-ownership.ts").FeatureRepositories | undefined {
  return registry.definitions[persistence.backend]?.repositories;
}
