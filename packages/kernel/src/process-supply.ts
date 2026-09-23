import { ApplicationBuilder, type BootedRuntime, type RuntimeService } from "./application.ts";
import type { ResolvedTokens } from "./dependency-token.ts";
import type { InstallableServerFeature, ServerRole } from "./feature-installer.ts";
import { ModuleApiToken } from "./module-api-token.ts";
import { membersFrom, storesBackedMembers, type StoresMemberSource } from "./module-members.ts";
import { ObservabilitySupply } from "./process-supply.options.ts";
import type {
  InstalledPeersInAnyBranch,
  InstalledSupplyPeers,
  Merge,
  MissingSupplyFields,
  MissingSupplyFieldsFrom,
  RequiredConfig,
  RequiredMembers,
  RequiredPeers,
  SupplyModule,
  ValidateSupply,
} from "./process-supply.types.ts";
import { SupplyToken } from "./supply-token.ts";
import type { FeatureTransportHosts } from "./transport-mounting.ts";
import type { TransportPeers } from "./transport-peers.ts";

type SupplyRecord = Readonly<Record<string, unknown>>;
type MemberValueFrom<RequiredMemberSet, Name extends string> = Name extends keyof RequiredMemberSet
  ? RequiredMemberSet[Name]
  : unknown;
type MissingFrom<
  RequiredMemberSet,
  RequiredConfigSet,
  RequiredPeerSet,
  InstalledPeerSet,
  InstalledPeerSetInAnyBranch,
  Members,
  Config,
  Peers,
> = keyof MissingSupplyFieldsFrom<
  RequiredMemberSet,
  RequiredConfigSet,
  RequiredPeerSet,
  InstalledPeerSet,
  InstalledPeerSetInAnyBranch,
  Members,
  Config,
  Peers
> &
  string;
/**
 * What a process exposes: the hosts every declared transport mounts on, and the one handler it
 * serves once they have. Both come from ONE call, at the one moment either can be built — every
 * module's application exists and nothing is listening yet.
 */
export interface ExposedSurface<Rest, Trpc> {
  readonly hosts: FeatureTransportHosts<Rest, Trpc>;
  /** Called after every declaration mounted. Its answer is what `serve` hosts. */
  readonly serve: () => unknown;
}
interface SupplyState<Rest, Trpc> {
  readonly role: ServerRole;
  readonly modules: readonly SupplyModule[];
  readonly members: SupplyRecord;
  readonly config: SupplyRecord;
  readonly peers: SupplyRecord;
  readonly services: readonly RuntimeService[];
  readonly transport?: (peers: TransportPeers) => ExposedSurface<Rest, Trpc>;
  readonly stores?: StoresMemberSource;
}

/** Every member a stores source materializes, in the supply's canonical names. */
type StoreSuppliedNames =
  | "clock"
  | "secrets"
  | "encryption"
  | "relational"
  | "analytical"
  | "keyvalue"
  | "blobs"
  | "logging"
  | "metrics"
  | "eventing"
  | "mail"
  | "rateLimiter"
  | "cache"
  | "idempotency";

declare const supplyState: unique symbol;
declare const missingSupply: unique symbol;
interface MissingSupply<Names extends string> {
  readonly [missingSupply]: Names;
}
type Boot<
  Modules extends readonly SupplyModule[],
  Members extends SupplyRecord,
  Config extends SupplyRecord,
  Peers extends SupplyRecord,
  Missing extends string,
  Rest,
  Trpc,
  RequiredMemberSet extends SupplyRecord,
  RequiredConfigSet extends SupplyRecord,
  RequiredPeerSet extends SupplyRecord,
  InstalledPeerSet extends SupplyRecord,
  InstalledPeerSetInAnyBranch extends SupplyRecord,
> = [Missing] extends [never]
  ? (
      this: ProcessSupply<
        Modules,
        Members,
        Config,
        Peers,
        never,
        Rest,
        Trpc,
        RequiredMemberSet,
        RequiredConfigSet,
        RequiredPeerSet,
        InstalledPeerSet,
        InstalledPeerSetInAnyBranch
      >,
    ) => Promise<BootedRuntime<SupplyRecord, Rest, Trpc>>
  : "" & MissingSupply<Missing>;
type Exact<Left, Right> = [Left] extends [Right]
  ? [Right] extends [Left]
    ? unknown
    : never
  : never;
type CheckedModule<Module extends SupplyModule> = Module extends {
  readonly members: readonly string[];
  readonly types: { readonly dependencies: infer Dependencies };
}
  ? Exact<ResolvedTokens<Module["dependencies"]>, Dependencies> extends never
    ? never
    : Module
  : never;
type CheckedModuleUnion<Modules extends readonly SupplyModule[]> = [Modules[number]] extends [
  CheckedModule<Modules[number]>,
]
  ? unknown
  : never;
type CheckedModules<Modules extends readonly SupplyModule[]> = number extends Modules["length"]
  ? never
  : string extends Modules[number]["name"]
    ? never
    : SupplyModule["configType"] extends Modules[number]["configType"]
      ? never
      : CheckedModuleUnion<Modules>;

export class ProcessSupply<
  Modules extends readonly SupplyModule[] = [],
  Members extends SupplyRecord = Record<never, never>,
  Config extends SupplyRecord = Record<never, never>,
  Peers extends SupplyRecord = Record<never, never>,
  Missing extends string = keyof MissingSupplyFields<Modules, Members, Config, Peers> & string,
  Rest = never,
  Trpc = never,
  RequiredMemberSet extends SupplyRecord = RequiredMembers<Modules>,
  RequiredConfigSet extends SupplyRecord = RequiredConfig<Modules>,
  RequiredPeerSet extends SupplyRecord = RequiredPeers<Modules>,
  InstalledPeerSet extends SupplyRecord = InstalledSupplyPeers<Modules>,
  InstalledPeerSetInAnyBranch extends SupplyRecord = InstalledPeersInAnyBranch<Modules>,
> {
  declare readonly [supplyState]: (
    modules: Modules,
    members: Members,
    config: Config,
    peers: Peers,
    missing: Missing,
    rest: Rest,
    trpc: Trpc,
  ) => void;
  declare readonly boot: Boot<
    Modules,
    Members,
    Config,
    Peers,
    Missing,
    Rest,
    Trpc,
    RequiredMemberSet,
    RequiredConfigSet,
    RequiredPeerSet,
    InstalledPeerSet,
    InstalledPeerSetInAnyBranch
  >;
  readonly #state: SupplyState<Rest, Trpc>;

  private constructor(state: SupplyState<Rest, Trpc>) {
    this.#state = state;
    Object.defineProperty(this, "boot", {
      configurable: false,
      enumerable: false,
      value: () => this.#boot(),
      writable: false,
    });
  }

  static create(options: { readonly role: ServerRole }): ProcessSupply {
    return new ProcessSupply({
      ...options,
      modules: [],
      members: {},
      config: {},
      peers: {},
      services: [],
    });
  }

  withModules<const Next extends readonly SupplyModule[]>(
    modules: Next,
    ..._checked: [CheckedModules<Next>] extends [never] ? [never] : []
  ) {
    return new ProcessSupply<
      [...Modules, ...Next],
      Members,
      Config,
      Peers,
      MissingFrom<
        Merge<RequiredMemberSet, RequiredMembers<Next>>,
        Merge<RequiredConfigSet, RequiredConfig<Next>>,
        Merge<RequiredPeerSet, RequiredPeers<Next>>,
        Merge<InstalledPeerSet, InstalledSupplyPeers<Next>>,
        Merge<InstalledPeerSetInAnyBranch, InstalledPeersInAnyBranch<Next>>,
        Members,
        Config,
        Peers
      >,
      Rest,
      Trpc,
      Merge<RequiredMemberSet, RequiredMembers<Next>>,
      Merge<RequiredConfigSet, RequiredConfig<Next>>,
      Merge<RequiredPeerSet, RequiredPeers<Next>>,
      Merge<InstalledPeerSet, InstalledSupplyPeers<Next>>,
      Merge<InstalledPeerSetInAnyBranch, InstalledPeersInAnyBranch<Next>>
    >({
      ...this.#state,
      modules: [...this.#state.modules, ...modules],
    });
  }

  withConfig<const Next extends RequiredConfigSet>(config: Next) {
    return new ProcessSupply<
      Modules,
      Members,
      Next,
      Peers,
      MissingFrom<
        RequiredMemberSet,
        RequiredConfigSet,
        RequiredPeerSet,
        InstalledPeerSet,
        InstalledPeerSetInAnyBranch,
        Members,
        Next,
        Peers
      >,
      Rest,
      Trpc,
      RequiredMemberSet,
      RequiredConfigSet,
      RequiredPeerSet,
      InstalledPeerSet,
      InstalledPeerSetInAnyBranch
    >({ ...this.#state, config });
  }

  provide<const Next extends SupplyRecord>(peers: Next & ValidateSupply<Next, RequiredPeerSet>) {
    return new ProcessSupply<
      Modules,
      Members,
      Config,
      Merge<Peers, Next>,
      MissingFrom<
        RequiredMemberSet,
        RequiredConfigSet,
        RequiredPeerSet,
        InstalledPeerSet,
        InstalledPeerSetInAnyBranch,
        Members,
        Config,
        Merge<Peers, Next>
      >,
      Rest,
      Trpc,
      RequiredMemberSet,
      RequiredConfigSet,
      RequiredPeerSet,
      InstalledPeerSet,
      InstalledPeerSetInAnyBranch
    >({
      ...this.#state,
      peers: { ...this.#state.peers, ...peers },
    });
  }

  withClock<Value extends MemberValueFrom<RequiredMemberSet, "clock">>(clock: Value) {
    return this.#withMembers({ clock });
  }

  withSecrets<Value extends MemberValueFrom<RequiredMemberSet, "secrets">>(secrets: Value) {
    return this.#withMembers({ secrets });
  }

  withEncryption<Value extends MemberValueFrom<RequiredMemberSet, "encryption">>(
    encryption: Value,
  ) {
    return this.#withMembers({ encryption });
  }

  withRelational<Value extends MemberValueFrom<RequiredMemberSet, "relational">>(
    relational: Value,
  ) {
    return this.#withMembers({ relational });
  }

  withAnalytical<Value extends MemberValueFrom<RequiredMemberSet, "analytical">>(
    analytical: Value,
  ) {
    return this.#withMembers({ analytical });
  }

  withKeyvalue<Value extends MemberValueFrom<RequiredMemberSet, "keyvalue">>(keyvalue: Value) {
    return this.#withMembers({ keyvalue });
  }

  withBlobs<Value extends MemberValueFrom<RequiredMemberSet, "blobs">>(blobs: Value) {
    return this.#withMembers({ blobs });
  }

  withEventing<Value extends MemberValueFrom<RequiredMemberSet, "eventing">>(eventing: Value) {
    return this.#withMembers({ eventing });
  }

  withMail<Value extends MemberValueFrom<RequiredMemberSet, "mail">>(mail: Value) {
    return this.#withMembers({ mail });
  }

  /**
   * The one supply call for storage: the opened stores answer every standard
   * member lazily, in their own build order; the tier rides the value.
   */
  withStores(stores: StoresMemberSource) {
    return this.#withStores<
      Pick<RequiredMemberSet, Extract<StoreSuppliedNames, keyof RequiredMemberSet>>
    >(stores);
  }

  #withStores<Next extends object>(stores: StoresMemberSource) {
    return new ProcessSupply<
      Modules,
      Merge<Members, Next>,
      Config,
      Peers,
      MissingFrom<
        RequiredMemberSet,
        RequiredConfigSet,
        RequiredPeerSet,
        InstalledPeerSet,
        InstalledPeerSetInAnyBranch,
        Merge<Members, Next>,
        Config,
        Peers
      >,
      Rest,
      Trpc,
      RequiredMemberSet,
      RequiredConfigSet,
      RequiredPeerSet,
      InstalledPeerSet,
      InstalledPeerSetInAnyBranch
    >({
      ...this.#state,
      stores,
    });
  }

  withMember<
    const Name extends keyof RequiredMemberSet & string,
    Value extends MemberValueFrom<RequiredMemberSet, Name>,
  >(name: Name, value: Value) {
    return new ProcessSupply<
      Modules,
      Merge<Members, Readonly<Record<Name, Value>>>,
      Config,
      Peers,
      MissingFrom<
        RequiredMemberSet,
        RequiredConfigSet,
        RequiredPeerSet,
        InstalledPeerSet,
        InstalledPeerSetInAnyBranch,
        Merge<Members, Readonly<Record<Name, Value>>>,
        Config,
        Peers
      >,
      Rest,
      Trpc,
      RequiredMemberSet,
      RequiredConfigSet,
      RequiredPeerSet,
      InstalledPeerSet,
      InstalledPeerSetInAnyBranch
    >({
      ...this.#state,
      members: { ...this.#state.members, [name]: value },
    });
  }

  withMembers<const Next extends Partial<RequiredMemberSet>>(
    members: Next & ValidateSupply<Next, RequiredMemberSet>,
  ) {
    return this.#withMembers(members);
  }

  withObservability<Next extends object>(
    configure: (observability: ObservabilitySupply<Modules>) => ObservabilitySupply<Modules, Next>,
  ) {
    return this.#withMembers(configure(new ObservabilitySupply<Modules>({})).supplied);
  }

  /**
   * What this process serves; a worker never calls it. The whole composition (surfaces, prefixes,
   * middleware) is written inside this call, so a main never sees a mount or transport internals.
   */
  expose<NextRest, NextTrpc>(
    surface: (peers: TransportPeers) => ExposedSurface<NextRest, NextTrpc>,
  ) {
    return new ProcessSupply<
      Modules,
      Members,
      Config,
      Peers,
      Missing,
      NextRest,
      NextTrpc,
      RequiredMemberSet,
      RequiredConfigSet,
      RequiredPeerSet,
      InstalledPeerSet,
      InstalledPeerSetInAnyBranch
    >({ ...this.#state, transport: surface });
  }

  withService(service: RuntimeService) {
    return new ProcessSupply<
      Modules,
      Members,
      Config,
      Peers,
      Missing,
      Rest,
      Trpc,
      RequiredMemberSet,
      RequiredConfigSet,
      RequiredPeerSet,
      InstalledPeerSet,
      InstalledPeerSetInAnyBranch
    >({
      ...this.#state,
      services: [...this.#state.services, service],
    });
  }

  #withMembers<Next extends object>(members: Next) {
    return new ProcessSupply<
      Modules,
      Merge<Members, Next>,
      Config,
      Peers,
      MissingFrom<
        RequiredMemberSet,
        RequiredConfigSet,
        RequiredPeerSet,
        InstalledPeerSet,
        InstalledPeerSetInAnyBranch,
        Merge<Members, Next>,
        Config,
        Peers
      >,
      Rest,
      Trpc,
      RequiredMemberSet,
      RequiredConfigSet,
      RequiredPeerSet,
      InstalledPeerSet,
      InstalledPeerSetInAnyBranch
    >({
      ...this.#state,
      members: { ...this.#state.members, ...members },
    });
  }

  #boot(): Promise<BootedRuntime<SupplyRecord, Rest, Trpc>> {
    const state = this.#state;
    const options = {
      role: state.role,
      config: state.config,
      members: state.stores
        ? storesBackedMembers(state.stores, legacyMemberNames(state.members))
        : membersFrom(legacyMemberNames(state.members)),
    };
    const transport = state.transport;
    let exposed: ExposedSurface<Rest, Trpc> | undefined;
    const builder = transport
      ? new ApplicationBuilder<SupplyRecord>(options).withTransports(
          (peers) => {
            exposed = transport(peers);
            return exposed.hosts;
          },
          () => exposed?.serve(),
        )
      : new ApplicationBuilder<SupplyRecord, Rest, Trpc>(options);
    const supplied = new Set<ModuleApiToken<unknown> | SupplyToken<unknown>>();
    for (const module of state.modules) {
      for (const token of Object.values(module.dependencies)) {
        if (
          (token instanceof ModuleApiToken || token instanceof SupplyToken) &&
          Object.hasOwn(state.peers, token.name) &&
          !supplied.has(token)
        ) {
          builder.withProvided(token, state.peers[token.name]);
          supplied.add(token);
        }
      }
    }
    for (const service of state.services) builder.withService(service);
    const modules = state.modules as readonly InstallableServerFeature<SupplyRecord>[];
    const selectedModules = modules.map((module) =>
      state.stores?.tier && module.repositoryRegistry
        ? { ...module, tier: state.stores.tier }
        : module,
    );
    return (
      builder
        // SupplyModule existentially erases each admitted module's contravariant member input.
        .withModules(selectedModules)
        .boot()
    );
  }
}

function legacyMemberNames(members: SupplyRecord): SupplyRecord {
  const aliases: Readonly<Record<string, string>> = {
    relational: "prisma",
    analytical: "clickhouse",
    blobs: "objectStorage",
    keyvalue: "redis",
    logging: "logger",
    metrics: "telemetry",
  };
  const result = { ...members };
  for (const [name, value] of Object.entries(members)) {
    const alias = aliases[name];
    if (alias !== void 0) result[alias] = value;
  }
  return result;
}

export function createApp(options: { readonly role: ServerRole }): ProcessSupply {
  return ProcessSupply.create(options);
}
