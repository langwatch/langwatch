/**
 * Channel tiers: "live" (reaches the vendor, bus or peer) vs "memory" (records in-process).
 * The container builds the tier the stores state, as it does repositories (record §3.2, §5).
 */
import { ModuleApiToken, type TokenIdentity } from "@langwatch/module";
import type { ScopedSecrets } from "@langwatch/secrets";

import type { Tier } from "./tiers.ts";

/** The `*Api` tokens a tier binds, by key: never `static dependencies`, so never an edge. */
type ChannelBindings = Readonly<Record<string, ModuleApiToken<unknown>>>;

type ChannelProvider = Readonly<{
  readonly requires: readonly string[];
  readonly binds?: ChannelBindings;
  readonly create: (...arguments_: never[]) => unknown;
}>;

/** What the container hands a channel tier beside the stores it named in `requires`. */
type ChannelContext<Provider> =
  | "config"
  | "secrets"
  | (Provider extends Readonly<{ binds: ChannelBindings }> ? "bound" : never);

/**
 * Each bound token's implementation, typed as its `*Api`. The reference is live once
 * every module has resolved; calling it while the process is constructing refuses by name.
 */
export type BoundApis<Binds extends ChannelBindings> = {
  readonly [Key in keyof Binds]: Binds[Key] extends ModuleApiToken<infer Api> ? Api : never;
};

/** The tiers a channel registry must declare, both of them. */
export interface ChannelTiers<Live extends ChannelProvider, Memory extends ChannelProvider> {
  readonly live: Live;
  readonly memory: Memory;
}

type ProviderArguments<Provider> =
  Provider extends Readonly<{ create: (...arguments_: infer Arguments) => unknown }>
    ? Arguments
    : never;

type ProviderRequirements<Provider> =
  Provider extends Readonly<{ requires: readonly (infer Key extends PropertyKey)[] }> ? Key : never;

type KeysMismatch<Provider, Input> =
  | Exclude<keyof Input, ProviderRequirements<Provider> | ChannelContext<Provider>>
  | Exclude<ProviderRequirements<Provider>, keyof Input>;

/**
 * A tier whose `create` takes nothing, or one record naming every store it requires plus,
 * optionally, `config`, `secrets` and (when it `binds`) `bound`. Anything else is `never`.
 */
type ValidChannelProvider<Provider> =
  ProviderArguments<Provider> extends []
    ? ProviderRequirements<Provider> extends never
      ? Provider
      : never
    : ProviderArguments<Provider> extends [infer Input extends object]
      ? ValidInput<Provider, Input>
      : never;

type ValidInput<Provider, Input> = KeysMismatch<Provider, Input> extends never ? Provider : never;

type ProviderResult<Provider> =
  Provider extends Readonly<{ create: (...arguments_: never[]) => infer Built }>
    ? Awaited<Built>
    : never;

export type ChannelRegistry<
  Live extends ChannelProvider,
  Memory extends ChannelProvider,
> = Readonly<{
  readonly kind: "channels";
  readonly definitions: ChannelTiers<Live, Memory>;
}>;

/** Any channel registry, for the runtime that reads one it knows nothing else about. */
export type AnyChannelRegistry = ChannelRegistry<ChannelProvider, ChannelProvider>;

/** The channels a module class is handed, whichever tier the process chose. */
export type ChannelsFor<Registry> =
  Registry extends ChannelRegistry<infer Live, infer Memory>
    ? ProviderResult<Live> | ProviderResult<Memory>
    : never;

/** Which tier the process chose, the stores it opened, and the module's own config and secrets. */
export type ChannelSelection = Readonly<{
  readonly tier: Tier;
  readonly members: Readonly<Record<string, unknown>>;
  readonly config: unknown;
  readonly secrets: ScopedSecrets;
  /** The process's token resolver: a bound `*Api` arrives as its lazy reference. */
  readonly resolve: (token: TokenIdentity) => unknown;
}>;

/**
 * A module's channels, in both tiers, named on its installer with `.withChannels(...)`.
 * The memory twin is required: it is what an installation test boots over (record §13).
 */
export function defineChannels<
  const Live extends ChannelProvider,
  const Memory extends ChannelProvider,
>(
  definitions: ChannelTiers<Live, Memory> & {
    readonly live: ValidChannelProvider<Live>;
    readonly memory: ValidChannelProvider<Memory>;
  },
): ChannelRegistry<Live, Memory> {
  const captured = {
    live: freezeProvider(definitions.live),
    memory: freezeProvider(definitions.memory),
  } as ChannelTiers<Live, Memory>;
  return Object.freeze({ kind: "channels", definitions: Object.freeze(captured) });
}

function freezeProvider(provider: ChannelProvider): ChannelProvider {
  const binds = provider.binds;
  for (const [key, token] of Object.entries(binds ?? {})) {
    if (!(token instanceof ModuleApiToken)) {
      throw new TypeError(`Channel binding "${key}" must name a module's *Api token.`);
    }
  }
  return Object.freeze({
    requires: Object.freeze([...provider.requires]),
    ...(binds === undefined ? {} : { binds: Object.freeze({ ...binds }) }),
    create: provider.create.bind(provider),
  });
}

/** Every `*Api` token the chosen tier binds, by key, for boot to check a module provides it. */
export function channelsBind(
  registry: AnyChannelRegistry,
  tier: Tier,
): readonly (readonly [string, ModuleApiToken<unknown>])[] {
  return Object.entries(registry.definitions[tier].binds ?? {});
}

/** Every store the chosen tier reads, for the union boot builds up front. */
export function channelsRequire(registry: AnyChannelRegistry, tier: Tier): readonly string[] {
  return registry.definitions[tier].requires;
}

/** Builds the selected tier once per install; a missing store refuses naming tier and store. */
export async function instantiateChannels(
  registry: AnyChannelRegistry,
  selection: ChannelSelection,
): Promise<unknown> {
  const provider = registry.definitions[selection.tier];
  const input: Record<string, unknown> = {
    config: selection.config,
    secrets: selection.secrets,
  };
  for (const key of provider.requires) {
    const value = selection.members[key];
    if (value === null || value === void 0) {
      throw new Error(`The "${selection.tier}" channel tier requires the "${key}" store.`);
    }
    input[key] = value;
  }
  const binds = provider.binds;
  if (binds !== undefined) {
    const bound: Record<string, unknown> = {};
    for (const [key, token] of Object.entries(binds)) bound[key] = selection.resolve(token);
    input["bound"] = bound;
  }
  return await Reflect.apply(provider.create, provider, [input]);
}
