import { ApplicationBuilder, type BootedRuntime } from "./application.ts";
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
  RequiredPeers,
  SupplyModule,
  ValidateSupply,
} from "./process-supply.types.ts";

type SupplyRecord = Readonly<Record<string, unknown>>;
interface SupplyState {
  readonly role: ServerRole;
  readonly modules: readonly SupplyModule[];
  readonly members: SupplyRecord;
  readonly config: SupplyRecord;
  readonly peers: SupplyRecord;
  readonly transportAuth?: TransportAuthSupply;
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
> = [Missing] extends [never]
  ? (
      this: ProcessSupply<Modules, Members, Config, Peers, never>,
    ) => Promise<BootedRuntime<SupplyRecord>>
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
> {
  declare readonly [supplyState]: (
    modules: Modules,
    members: Members,
    config: Config,
    peers: Peers,
    missing: Missing,
  ) => void;
  declare readonly boot: Boot<Modules, Members, Config, Peers, Missing>;
  readonly #state: SupplyState;

  private constructor(state: SupplyState) {
    this.#state = state;
    Object.defineProperty(this, "boot", {
      configurable: false,
      enumerable: false,
      value: () => this.#boot(),
      writable: false,
    });
  }

  static create(options: { readonly role: ServerRole }): ProcessSupply {
    return new ProcessSupply({ ...options, modules: [], members: {}, config: {}, peers: {} });
  }

  withModules<const Next extends readonly SupplyModule[]>(
    modules: Next,
    ..._checked: [CheckedModules<Next>] extends [never] ? [never] : []
  ) {
    return new ProcessSupply<[...Modules, ...Next], Members, Config, Peers>({
      ...this.#state,
      modules: [...this.#state.modules, ...modules],
    });
  }

  withConfig<const Next extends RequiredConfig<Modules>>(config: Next) {
    return new ProcessSupply<Modules, Members, Next, Peers>({ ...this.#state, config });
  }

  provide<const Next extends SupplyRecord>(
    peers: Next & ValidateSupply<Next, RequiredPeers<Modules>>,
  ) {
    return new ProcessSupply<Modules, Members, Config, Merge<Peers, Next>>({
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

  withObservability<Next extends object>(
    configure: (observability: ObservabilitySupply<Modules>) => ObservabilitySupply<Modules, Next>,
  ) {
    return this.#withMembers(configure(new ObservabilitySupply<Modules>({})).supplied);
  }

  withTransportAuth(configure: (auth: TransportAuthSupply) => TransportAuthSupply) {
    return new ProcessSupply<Modules, Members, Config, Peers>({
      ...this.#state,
      transportAuth: configure(new TransportAuthSupply()),
    });
  }

  #withMembers<Next extends object>(members: Next) {
    return new ProcessSupply<Modules, Merge<Members, Next>, Config, Peers>({
      ...this.#state,
      members: { ...this.#state.members, ...members },
    });
  }

  #boot(): Promise<BootedRuntime<SupplyRecord>> {
    const state = this.#state;
    const builder = new ApplicationBuilder<SupplyRecord>({
      role: state.role,
      config: state.config,
      members: membersFrom(legacyMemberNames(state.members)),
    });
    const supplied = new Set<ModuleApiToken<unknown>>();
    for (const module of state.modules) {
      for (const token of Object.values(module.dependencies)) {
        if (
          token instanceof ModuleApiToken &&
          Object.hasOwn(state.peers, token.name) &&
          !supplied.has(token)
        ) {
          builder.withProvided(token, state.peers[token.name]);
          supplied.add(token);
        }
      }
    }
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

export function createApp(options: { readonly role: ServerRole }): ProcessSupply {
  return ProcessSupply.create(options);
}
