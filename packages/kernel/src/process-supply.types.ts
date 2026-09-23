import type { InstallableServerFeature, ModuleConfigFor } from "./feature-installer.ts";
import type { ModuleApiToken } from "./module-api-token.ts";
import type { SupplyToken } from "./supply-token.ts";

export type Simplify<T> = { [K in keyof T]: T[K] } & {};
export type SupplyModule = InstallableServerFeature<never>;
export type Merge<Left, Right> = Simplify<Omit<Left, keyof Right> & Right>;
type Intersection<Union> = [Union] extends [never]
  ? Record<never, never>
  : (Union extends unknown ? (value: Union) => void : never) extends (value: infer Value) => void
    ? Value
    : never;

/**
 * Derived members (rateLimiter, cache, idempotency) keep their own names:
 * aliasing them to a base store let `withKeyvalue` satisfy the type while
 * boot refused at runtime — only the stores supply builds them.
 */
export interface MemberNames {
  prisma: "relational";
  clickhouse: "analytical";
  objectStorage: "blobs";
  redis: "keyvalue";
  logger: "logging";
  telemetry: "metrics";
}
type MemberName<Name> = Name extends keyof MemberNames ? MemberNames[Name] : Name;

type ReadMembers<Module> =
  Module extends InstallableServerFeature<infer Members>
    ? Module extends { readonly members: readonly (infer Name)[] }
      ? string extends Name
        ? Members
        : Pick<Members, Extract<Name, keyof Members>>
      : Members
    : never;
type ProviderMembers<Provider> = Provider extends {
  readonly create: (...arguments_: infer Arguments) => unknown;
}
  ? Arguments extends readonly [infer Members]
    ? Members
    : Record<never, never>
  : Record<never, never>;
type RepositoryMembers<Module> = Module extends {
  readonly repositoryRegistry: {
    readonly definitions: {
      readonly live: infer Live;
      readonly memory: infer Memory;
    };
  };
}
  ? ProviderMembers<Module extends { readonly tier: "memory" } ? Memory : Live>
  : Record<never, never>;
type Normalise<Members> = {
  readonly [Name in keyof Members as MemberName<Name>]: Name extends
    | "cache"
    | "rateLimiter"
    | "idempotency"
    ? unknown
    : Members[Name];
};
type ModuleMembers<Module> = Normalise<ReadMembers<Module> & RepositoryMembers<Module>>;
export type RequiredMembers<Modules extends readonly SupplyModule[]> = Simplify<
  Intersection<
    Modules[number] extends infer Module
      ? Module extends unknown
        ? ModuleMembers<Module>
        : never
      : never
  >
>;
export type RequiredConfig<Modules extends readonly SupplyModule[]> = Simplify<
  ModuleConfigFor<Modules>
>;

type Peer<Token> =
  Token extends ModuleApiToken<infer Api, infer Name>
    ? { readonly [Key in Name]: Api }
    : Token extends SupplyToken<infer Api, infer Name>
      ? { readonly [Key in Name]: Api }
      : Record<never, never>;
type ModulePeers<Module> = Module extends { readonly dependencies: infer Dependencies }
  ? Intersection<{ [Key in keyof Dependencies]: Peer<Dependencies[Key]> }[keyof Dependencies]>
  : Record<never, never>;
export type RequiredPeers<Modules extends readonly SupplyModule[]> = Simplify<
  Intersection<
    Modules[number] extends infer Module
      ? Module extends unknown
        ? ModulePeers<Module>
        : never
      : never
  >
>;
export type InstalledPeersInAnyBranch<Modules extends readonly SupplyModule[]> = {
  [Module in Modules[number] as Module["name"]]: Module extends {
    readonly types: { readonly provided: infer Api };
  }
    ? Api
    : never;
};
type InstalledNames<Modules extends readonly SupplyModule[]> = Modules extends unknown
  ? Modules[number]["name"]
  : never;
type DefinitelyInstalledInTuple<Modules extends readonly SupplyModule[], Name extends string> = {
  [Index in keyof Modules]: [Modules[Index]] extends [{ readonly name: Name }] ? true : false;
}[number];
type AbsentFromBranch<
  Modules extends readonly SupplyModule[],
  Name extends string,
> = Modules extends unknown
  ? true extends DefinitelyInstalledInTuple<Modules, Name>
    ? never
    : Name
  : never;
type InstalledInEveryBranch<Modules extends readonly SupplyModule[]> = {
  [Name in InstalledNames<Modules>]: [AbsentFromBranch<Modules, Name>] extends [never]
    ? Name
    : never;
}[InstalledNames<Modules>];
export type InstalledSupplyPeers<Modules extends readonly SupplyModule[]> = {
  [Name in InstalledInEveryBranch<Modules>]: Extract<
    Modules[number],
    { readonly name: Name }
  > extends { readonly types: { readonly provided: infer Api } }
    ? Api
    : never;
};
type Missing<Required, Supplied> = {
  readonly [
    Key in keyof Required as Supplied extends {
      readonly [SuppliedKey in Key]-?: Required[SuppliedKey];
    }
      ? never
      : Key
  ]: Required[Key];
};
type Prefix<Fields, Name extends string> = {
  readonly [Key in keyof Fields as `${Name}.${Key & string}`]: Fields[Key];
};
export type MissingSupplyFieldsFrom<
  RequiredMemberSet,
  RequiredConfigSet,
  RequiredPeerSet,
  InstalledPeerSet,
  InstalledPeerSetInAnyBranch,
  Members,
  Config,
  Peers,
> = Simplify<
  Missing<RequiredMemberSet, Members> &
    Prefix<Missing<RequiredConfigSet, Config>, "config"> &
    Prefix<Missing<RequiredPeerSet, Peers & InstalledPeerSet>, "peer"> &
    Prefix<
      Pick<Peers, Extract<keyof Peers, keyof InstalledPeerSetInAnyBranch & keyof RequiredPeerSet>>,
      "duplicate-peer"
    >
>;
export type MissingSupplyFields<
  Modules extends readonly SupplyModule[],
  Members,
  Config,
  Peers,
> = Simplify<
  MissingSupplyFieldsFrom<
    RequiredMembers<Modules>,
    RequiredConfig<Modules>,
    RequiredPeers<Modules>,
    InstalledSupplyPeers<Modules>,
    InstalledPeersInAnyBranch<Modules>,
    Members,
    Config,
    Peers
  >
>;
export type MissingSupplyNames<
  Modules extends readonly SupplyModule[],
  Members,
  Config,
  Peers,
> = keyof MissingSupplyFields<Modules, Members, Config, Peers> & string;
export type MemberValue<
  Modules extends readonly SupplyModule[],
  Name extends string,
> = Name extends keyof RequiredMembers<Modules> ? RequiredMembers<Modules>[Name] : unknown;
export type ValidateSupply<Supplied, Required> = {
  [Key in keyof Supplied]: Key extends keyof Required ? Required[Key] : Supplied[Key];
};
