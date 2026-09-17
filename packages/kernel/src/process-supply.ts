import { ApplicationBuilder, type BootedRuntime, type RuntimeService } from "./application.ts";
import type { ResolvedTokens } from "./dependency-token.ts";
import type { InstallableServerFeature, ServerRole } from "./feature-installer.ts";
import { ModuleApiToken } from "./module-api-token.ts";
import { membersFrom } from "./module-members.ts";
import { ObservabilitySupply, TransportAuthSupply } from "./process-supply.options.ts";
import type {
  MemberValue,
  Merge,
  MissingSupplyFields,
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
interface TransportOpening<Rest, Trpc> {
  readonly auth: TransportAuthSupply;
  readonly openHosts: (
    peers: TransportPeers,
    auth: TransportAuthSupply,
  ) => FeatureTransportHosts<Rest, Trpc>;
}
interface SupplyState<Rest, Trpc> {
  readonly role: ServerRole;
  readonly modules: readonly SupplyModule[];
  readonly members: SupplyRecord;
  readonly config: SupplyRecord;
  readonly peers: SupplyRecord;
  readonly services: readonly RuntimeService[];
  readonly transport?: TransportOpening<Rest, Trpc>;
}

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
> = [Missing] extends [never]
  ? (
      this: ProcessSupply<Modules, Members, Config, Peers, never, Rest, Trpc>,
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
    : SupplyModule["configSchema"] extends Modules[number]["configSchema"]
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
  declare readonly boot: Boot<Modules, Members, Config, Peers, Missing, Rest, Trpc>;
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
      keyof MissingSupplyFields<[...Modules, ...Next], Members, Config, Peers> & string,
      Rest,
      Trpc
    >({
      ...this.#state,
      modules: [...this.#state.modules, ...modules],
    });
  }

  withConfig<const Next extends RequiredConfig<Modules>>(config: Next) {
    return new ProcessSupply<
      Modules,
      Members,
      Next,
      Peers,
      keyof MissingSupplyFields<Modules, Members, Next, Peers> & string,
      Rest,
      Trpc
    >({ ...this.#state, config });
  }

  provide<const Next extends SupplyRecord>(
    peers: Next & ValidateSupply<Next, RequiredPeers<Modules>>,
  ) {
    return new ProcessSupply<
      Modules,
      Members,
      Config,
      Merge<Peers, Next>,
      keyof MissingSupplyFields<Modules, Members, Config, Merge<Peers, Next>> & string,
      Rest,
      Trpc
    >({
      ...this.#state,
      peers: { ...this.#state.peers, ...peers },
    });
  }

  withClock<Value extends MemberValue<Modules, "clock">>(clock: Value) {
    return this.#withMembers({ clock });
  }

  withSecrets<Value extends MemberValue<Modules, "secrets">>(secrets: Value) {
    return this.#withMembers({ secrets });
  }

  withEncryption<Value extends MemberValue<Modules, "encryption">>(encryption: Value) {
    return this.#withMembers({ encryption });
  }

  withRelational<Value extends MemberValue<Modules, "relational">>(relational: Value) {
    return this.#withMembers({ relational });
  }

  withAnalytical<Value extends MemberValue<Modules, "analytical">>(analytical: Value) {
    return this.#withMembers({ analytical });
  }

  withKeyvalue<Value extends MemberValue<Modules, "keyvalue">>(keyvalue: Value) {
    return this.#withMembers({ keyvalue });
  }

  withBlobs<Value extends MemberValue<Modules, "blobs">>(blobs: Value) {
    return this.#withMembers({ blobs });
  }

  withEventing<Value extends MemberValue<Modules, "eventing">>(eventing: Value) {
    return this.#withMembers({ eventing });
  }

  withMail<Value extends MemberValue<Modules, "mail">>(mail: Value) {
    return this.#withMembers({ mail });
  }

  withMember<
    const Name extends keyof RequiredMembers<Modules> & string,
    Value extends MemberValue<Modules, Name>,
  >(name: Name, value: Value) {
    return new ProcessSupply<
      Modules,
      Merge<Members, Readonly<Record<Name, Value>>>,
      Config,
      Peers,
      keyof MissingSupplyFields<
        Modules,
        Merge<Members, Readonly<Record<Name, Value>>>,
        Config,
        Peers
      > &
        string,
      Rest,
      Trpc
    >({
      ...this.#state,
      members: { ...this.#state.members, [name]: value },
    });
  }

  withObservability<Next extends object>(
    configure: (observability: ObservabilitySupply<Modules>) => ObservabilitySupply<Modules, Next>,
  ) {
    return this.#withMembers(configure(new ObservabilitySupply<Modules>({})).supplied);
  }

  withTransportAuth<NextRest, NextTrpc>(
    configure: (auth: TransportAuthSupply) => TransportAuthSupply,
    openHosts: (
      peers: TransportPeers,
      auth: TransportAuthSupply,
    ) => FeatureTransportHosts<NextRest, NextTrpc>,
  ) {
    return new ProcessSupply<Modules, Members, Config, Peers, Missing, NextRest, NextTrpc>({
      ...this.#state,
      transport: { auth: configure(new TransportAuthSupply()), openHosts },
    });
  }

  withService(service: RuntimeService) {
    return new ProcessSupply<Modules, Members, Config, Peers, Missing, Rest, Trpc>({
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
      keyof MissingSupplyFields<Modules, Merge<Members, Next>, Config, Peers> & string,
      Rest,
      Trpc
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
      members: membersFrom(legacyMemberNames(state.members)),
    };
    const transport = state.transport;
    const builder = transport
      ? new ApplicationBuilder<SupplyRecord>(options).withTransports((peers) =>
          transport.openHosts(peers, transport.auth),
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
    return (
      builder
        // SupplyModule existentially erases each admitted module's contravariant member input.
        .withModules(state.modules as readonly InstallableServerFeature<SupplyRecord>[])
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

export function createProcessApp(options: { readonly role: ServerRole }): ProcessSupply {
  return ProcessSupply.create(options);
}
