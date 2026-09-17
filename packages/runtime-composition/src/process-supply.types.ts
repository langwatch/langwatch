import type { InstallableServerFeature, ModuleConfigFor } from "./feature-installer.ts";
import type { ModuleApiToken } from "./module-api-token.ts";

export type Simplify<T> = { [K in keyof T]: T[K] } & {};
export type SupplyModule = InstallableServerFeature<never>;
export type Merge<Left, Right> = Simplify<Omit<Left, keyof Right> & Right>;
type Intersection<Union> = [Union] extends [never]
  ? Record<never, never>
  : (Union extends unknown ? (value: Union) => void : never) extends (value: infer Value) => void
    ? Value
    : never;

export interface MemberNames {
  prisma: "relational";
  clickhouse: "analytical";
  objectStorage: "blobs";
  redis: "keyvalue";
  cache: "keyvalue";
  rateLimiter: "keyvalue";
  logger: "logging";
  telemetry: "metrics";
  idempotency: "relational" | "encryption";
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
type RepositoryMembers<Module> = Module extends {
  readonly repositoryRegistry: {
    readonly definitions: {
      readonly live: {
        readonly create: (members: infer Members) => unknown;
      };
    };
  };
}
  ? Members
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
type InstalledPeersInAnyBranch<Modules extends readonly SupplyModule[]> = {
  [Module in Modules[number] as Module["name"]]: Module extends {
    readonly types: { readonly provided: infer Api };
  }
    ? Api
    : never;
};
type InstalledNames<Modules extends readonly SupplyModule[]> = Modules extends unknown
  ? Modules[number]["name"]
  : never;
type AbsentFromTuple<
  Modules extends readonly SupplyModule[],
  Name extends string,
> = Modules extends readonly [infer Head extends SupplyModule, ...infer Tail extends SupplyModule[]]
  ? [Head] extends [{ readonly name: Name }]
    ? never
    : AbsentFromTuple<Tail, Name>
  : Name;
type AbsentFromBranch<
  Modules extends readonly SupplyModule[],
  Name extends string,
> = Modules extends unknown ? AbsentFromTuple<Modules, Name> : never;
type InstalledInEveryBranch<Modules extends readonly SupplyModule[]> = {
  [Name in InstalledNames<Modules>]: [AbsentFromBranch<Modules, Name>] extends [never]
    ? Name
    : never;
}[InstalledNames<Modules>];
type InstalledPeers<Modules extends readonly SupplyModule[]> = {
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
type ConflictingPeers<Modules extends readonly SupplyModule[], Peers> = Pick<
  Peers,
  Extract<keyof Peers, keyof InstalledPeersInAnyBranch<Modules> & keyof RequiredPeers<Modules>>
>;
export type MissingSupplyFields<
  Modules extends readonly SupplyModule[],
  Members,
  Config,
  Peers,
> = Simplify<
  Missing<RequiredMembers<Modules>, Members> &
    Prefix<Missing<RequiredConfig<Modules>, Config>, "config"> &
    Prefix<Missing<RequiredPeers<Modules>, Peers & InstalledPeers<Modules>>, "peer"> &
    Prefix<ConflictingPeers<Modules, Peers>, "duplicate-peer">
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
