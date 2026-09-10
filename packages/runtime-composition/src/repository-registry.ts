/**
 * The two tiers every module's repositories come in, and the one word a
 * process says to choose between them.
 *
 * The words are `"live"` and `"memory"`, and they say what a process chooses:
 * whether live stores are reached at all. No module ever chooses between
 * Postgres and ClickHouse — each repository has exactly one live store,
 * already stated by the folder it sits in and by what its factory requires.
 * Naming the tier after a database was broken rather than merely misnamed: one
 * string was looked up for the whole process, so presence (Redis) and
 * coding-agent (ClickHouse) refused with `No "postgres" repository
 * implementation exists`, and trace had to call its nine-ClickHouse-repository
 * tier "postgres" to fit.
 *
 * {@link defineRepositories} demands both keys in the type, so a live tier with
 * no memory twin is a compile error in the module file rather than a process
 * that boots and answers empty lists.
 */
import { snapshotRepositories } from "./repository-ownership.ts";
import type { Tier } from "./tiers.ts";

type RepositoryProvider = Readonly<{
  readonly requires: readonly string[];
  readonly create: (...arguments_: never[]) => unknown;
  readonly repositories?: import("./repository-ownership.ts").FeatureRepositories;
}>;

/** The tiers a registry must declare, both of them. */
export interface RepositoryTiers<Live extends RepositoryProvider, Memory extends RepositoryProvider> {
  readonly live: Live;
  readonly memory: Memory;
}

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

type MemberKeysMatch<Provider, Members> =
  | Exclude<keyof Members, ProviderRequirements<Provider>>
  | Exclude<ProviderRequirements<Provider>, keyof Members>;

type ValidMembers<Provider, Members> = Members extends object
  ? MemberKeysMatch<Provider, Members> extends never
    ? Provider
    : never
  : never;

/**
 * A provider whose `create` takes either nothing or exactly one record, whose
 * keys are exactly the members it declared it requires. A mismatch resolves to
 * `never`, which is what makes a factory reaching for an undeclared member a
 * compile error in the registry rather than a runtime `undefined`.
 */
type ValidProvider<Provider> =
  ProviderArguments<Provider> extends []
    ? ProviderRequirements<Provider> extends never
      ? Provider
      : never
    : ProviderArguments<Provider> extends [infer Members]
      ? ValidMembers<Provider, Members>
      : never;

/** Which tier a process asked for, and the members that tier may read. */
export type RepositorySelection = Readonly<{
  readonly tier: Tier;
  readonly members: Readonly<Record<string, unknown>>;
}>;

type ProviderResult<Provider> =
  Provider extends Readonly<{
    create: (...arguments_: never[]) => infer Repository;
  }>
    ? Repository
    : never;

export type RepositoryRegistry<
  Live extends RepositoryProvider,
  Memory extends RepositoryProvider,
> = Readonly<{
  readonly definitions: RepositoryTiers<Live, Memory>;
}>;

/** Any registry, for the runtime that reads one it knows nothing else about. */
export type AnyRepositoryRegistry = RepositoryRegistry<RepositoryProvider, RepositoryProvider>;

/** The repositories one tier of a registry hands a module. */
export type RepositoriesFor<Registry, Selected extends Tier> =
  Registry extends RepositoryRegistry<infer Live, infer Memory>
    ? Selected extends "live"
      ? ProviderResult<Live>
      : ProviderResult<Memory>
    : never;

/**
 * A module's repositories, in both tiers.
 *
 * Both keys are required by the type. The memory twin is not a convenience for
 * tests: it is the twin of `unregistered-channels`, the thing that stops a
 * module shipping a live tier nothing can stand in for.
 */
export function defineRepositories<
  const Live extends RepositoryProvider,
  const Memory extends RepositoryProvider,
>(
  definitions: RepositoryTiers<Live, Memory> & {
    readonly live: ValidProvider<Live>;
    readonly memory: ValidProvider<Memory>;
  },
): RepositoryRegistry<Live, Memory> {
  const captured = {
    live: freezeProvider(definitions.live),
    memory: freezeProvider(definitions.memory),
  } as RepositoryTiers<Live, Memory>;

  return Object.freeze({ definitions: Object.freeze(captured) });
}

function freezeProvider<Provider extends RepositoryProvider>(provider: Provider): Provider {
  const snapshot = {
    ...provider,
    requires: Object.freeze([...provider.requires]),
    repositories: snapshotRepositories(provider.repositories),
    create: provider.create.bind(provider),
  };
  return Object.freeze(snapshot) as unknown as Provider;
}

export function instantiateRepositories<
  Live extends RepositoryProvider,
  Memory extends RepositoryProvider,
  Selected extends Tier,
>(
  registry: RepositoryRegistry<Live, Memory>,
  selection: RepositorySelection & Readonly<{ tier: Selected }>,
): RepositoriesFor<RepositoryRegistry<Live, Memory>, Selected> {
  validateRepositorySelection(registry, selection);
  const provider = registry.definitions[selection.tier];
  const members: Record<string, unknown> = {};
  for (const key of provider.requires) members[key] = selection.members[key];
  return Reflect.apply(provider.create, provider, [members]) as RepositoriesFor<
    RepositoryRegistry<Live, Memory>,
    Selected
  >;
}

/** Every member the chosen tier reads, for the union boot builds up front. */
export function repositoriesRequire(
  registry: AnyRepositoryRegistry,
  tier: Tier,
): readonly string[] {
  return registry.definitions[tier].requires;
}

export function validateRepositorySelection(
  registry: AnyRepositoryRegistry,
  selection: RepositorySelection,
): void {
  const provider = registry.definitions[selection.tier];
  if (!provider) throw new Error(`No "${selection.tier}" repository tier exists.`);
  for (const key of provider.requires) {
    const value = selection.members[key];
    const present = Object.hasOwn(selection.members, key) && value !== null && value !== void 0;
    if (!present) {
      throw new Error(`The "${selection.tier}" repository tier requires the "${key}" member.`);
    }
  }
}

export function selectedRepositoryOwnership(
  registry: AnyRepositoryRegistry,
  selection: RepositorySelection,
): import("./repository-ownership.ts").FeatureRepositories | undefined {
  return registry.definitions[selection.tier]?.repositories;
}
