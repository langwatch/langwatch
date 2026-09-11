import { snapshotRepositories, type FeatureRepositories } from "./repository-ownership.ts";
/** One feature installer. A feature declares its config, the contract services */
import type {
  DependencyToken,
  ResolvedTokens,
  TokenIdentity,
  TokenMap,
} from "./dependency-token.ts";
import type { FeatureEventing } from "./module-eventing.ts";
import type { ModuleName, PublicNamespace } from "./module-namespace.ts";
import { publicNamespace, publicNamespaceFromUnknown } from "./module-namespace.ts";
import type { ResourceOwnership } from "./resource-scope.ts";
import { FeatureConfigError } from "./boot-errors.ts";
import { ModuleApiToken, type FeatureApiIdentity } from "./module-api-token.ts";
import {
  instantiateRepositories,
  type AnyRepositoryRegistry,
  type RepositoriesFor,
  type RepositoryRegistry,
  type RepositorySelection,
} from "./repository-registry.ts";
import type { Tier } from "./tiers.ts";
import type { TransportFactBinding } from "./transport-mounting.ts";

/** Which process is booting. A role hosts only the work that role owns. */
export type ServerRole = "api" | "worker" | "tasks";

/** As much of Zod as a feature's config needs, so this package depends on none. */
export interface FeatureConfigSchema<Config> {
  parse(value: unknown): Config;
}

/** The complete context supplied to a server app's static factory. */
export type FeatureSetup<
  Dependencies extends TokenMap,
  Members,
  Config,
  Repositories = never,
> = Readonly<{
  readonly dependencies: ResolvedTokens<Dependencies>;
  readonly config: Config;
  readonly resources: ResourceOwnership;
}> &
  ([Members] extends [never]
    ? object
    : Readonly<{ readonly members: Members }>) &
  ([Repositories] extends [never] ? object : Readonly<{ readonly repositories: Repositories }>);

type AppContract<Dependencies extends TokenMap, App> =
  | Readonly<{
      contract: ModuleApiToken<App>;
      dependencies: Dependencies & Readonly<Record<string, FeatureApiIdentity>>;
    }>
  | Readonly<{ contract: abstract new (...args: never[]) => App; dependencies: Dependencies }>;

/** Static construction metadata owned by a server app implementation. */
export type AppDefinition<Dependencies extends TokenMap, Members, Config, App> = AppContract<
  Dependencies,
  App
> &
  Readonly<{
    readonly configSchema: FeatureConfigSchema<Config>;
    readonly repositories?: FeatureRepositories;
    /** What this App reads off the process's members, declared with `reads(...)`. */
    readonly reads?: readonly string[];
    readonly create: (
      setup: FeatureSetup<NoInfer<Dependencies>, Members, NoInfer<Config>>,
    ) => NoInfer<App>;
  }>;

/** Static construction metadata for an app with no semantic configuration. */
export type AppDefinitionWithoutConfig<
  Dependencies extends TokenMap,
  Members,
  App,
> = AppContract<Dependencies, App> &
  Readonly<{
    readonly repositories?: FeatureRepositories;
    /** What this App reads off the process's members, declared with `reads(...)`. */
    readonly reads?: readonly string[];
    readonly create: (
      setup: FeatureSetup<NoInfer<Dependencies>, Members, undefined>,
    ) => NoInfer<App>;
  }>;

/**
 * What one module binds for the facts its own declarations name.
 *
 * A route names a fact the request does not carry — the organization behind
 * the credential, the deep link into the product, the media type it arrived
 * as. The value is the MODULE's to state, because stating it reads the
 * module's own App and the peers the module declared; the process holds
 * neither, and the alternative to this seam is the process re-declaring the
 * route, which it must never do.
 */
export interface ModuleTransportFactSetup<Dependencies extends TokenMap, Members, App> {
  /** This module's own App, already constructed by the same boot. */
  readonly app: App;
  /** The peer Apps this module declared as dependencies, resolved. */
  readonly dependencies: ResolvedTokens<Dependencies>;
  /** Exactly the members this module's App declared it reads. */
  readonly members: Members;
}

/** The binder itself, run once at install in a role that serves doors. */
export type ModuleTransportFacts<Dependencies extends TokenMap, Members, App> = (
  setup: ModuleTransportFactSetup<Dependencies, Members, App>,
) => readonly TransportFactBinding[];

/** An inert API descriptor retained for the process root to mount later. */
export type FeatureTransportDescriptor = Readonly<{
  readonly protocol: "rest" | "trpc";
  /** The family's path segment, or the tRPC namespace the record keys it by. */
  readonly namespace?: string;
  readonly router: (...args: never[]) => object;
}>;

/** What a setup is handed, once per process. */
export interface FeatureSetupArguments<Config, Members, Dependencies> {
  readonly resources: ResourceOwnership;
  readonly config: Config;
  readonly members: Members;
  readonly dependencies: Dependencies;
  readonly repositorySelection?: FeatureInstallArguments<Members>["repositorySelection"];
  /**
   * What the module's registry answered on the selected backend, instantiated
   * once per install so the app and its eventing declaration read the same
   * objects rather than two graphs over the same rows.
   */
  readonly repositories?: unknown;
}

/** What the one transport assembly is handed, in a role that serves doors. */
export interface FeatureTransportSetupArguments<
  Config,
  Members,
  Dependencies,
  TransportDependencies,
  Provided,
> extends FeatureSetupArguments<Config, Members, Dependencies> {
  /** The tokens this feature needs only where it serves a transport. */
  readonly transportDependencies: TransportDependencies;
  /** Whatever the setup returned. */
  readonly provided: Provided;
}

/** What a door's contribution is handed, after the transport assembly ran. */
export interface FeatureTransportArguments<
  Config,
  Members,
  Dependencies,
  TransportDependencies,
  Provided,
  Transport,
> extends FeatureTransportSetupArguments<
  Config,
  Members,
  Dependencies,
  TransportDependencies,
  Provided
> {
  /** What the doors share: constructed once, by the transport assembly. */
  readonly transport: Transport;
}

/** What a background contribution is handed, after the setup ran. */
export interface FeatureWorkerArguments<
  Config,
  Members,
  Dependencies,
  Provided,
> extends FeatureSetupArguments<Config, Members, Dependencies> {
  readonly provided: Provided;
}

/** One token this feature answers for, and the instance behind it. */
export interface FeatureProvider<Provided> {
  readonly token: TokenIdentity;
  read(provided: Provided): unknown;
}

/** What one installed feature holds, with its own types erased. */
export interface InstalledFeatureState {
  readonly provided: unknown;
  /** The instantiated repositories, for a module that declared a registry. */
  readonly repositories?: unknown;
  /**
   * What this module bound for the facts its own declarations name, built in
   * a role that serves doors. The process mounts these with the family; a
   * fact left unbound is refused by the door at mount, naming fact and route.
   */
  readonly facts?: readonly TransportFactBinding[];
  /** Bound contribution readers; absent where the feature declared none. */
  readonly rest: (() => unknown) | undefined;
  readonly trpc: (() => unknown) | undefined;
  readonly worker: (() => unknown) | undefined;
}

/** What `install` is handed by the application root. */
export interface FeatureInstallArguments<Members> {
  readonly resources: ResourceOwnership;
  readonly config: unknown;
  readonly members: Members;
  /** Which repository tier this process chose, and the members that tier may read. */
  readonly repositorySelection?: RepositorySelection;
  readonly role: ServerRole;
  /** Instantiated once by the repository-aware declaration that wraps this. */
  readonly repositories?: unknown;
  /** The instance the graph resolved for one token. */
  resolve(token: TokenIdentity): unknown;
}

/**
 * A declaration as the application root holds it.
 *
 * Two things are NOT erased, because a process must be held to both: the
 * module's own NAME, as the literal it was declared with, and the type of the
 * config slice its schema parses. Together they are what lets `withModules`
 * refuse a process that installs a module whose config it never stated
 * (ADR-144, ruling 19). Everything else is erased, because the root installs
 * modules it knows nothing else about.
 */
export interface InstallableServerFeature<
  Members,
  Name extends string = string,
  Config = unknown,
> {
  readonly name: Name;
  /**
   * The schema this module's config slice is parsed through, where it declared
   * one. It is here rather than closed over alone so a process's own config
   * type can be derived from the modules it installs; `install` still parses
   * through the schema it captured, and never reads this.
   */
  readonly configSchema?: FeatureConfigSchema<Config>;
  /** Every door this feature declared, for the process root to mount at boot. */
  readonly transports?: readonly FeatureTransportDescriptor[];
  readonly repositories?: FeatureRepositories;
  readonly repositoryRegistry?: AnyRepositoryRegistry;
  readonly apiContract?: FeatureApiIdentity;
  readonly dependencies: TokenMap;
  readonly transportDependencies: TokenMap;
  readonly providers: readonly FeatureProvider<never>[];
  readonly contributesWorkerWork: boolean;
  /** Background work the worker role starts, declared with `withWorkers`. */
  readonly workers?: readonly unknown[];
  /** One-shot work the tasks role exposes, declared with `withTasks`. */
  readonly tasks?: readonly unknown[];
  /**
   * The event sourcing this module declared with `withEventing`. A role whose
   * pool holds no eventing runtime ignores it; a role that runs one builds the
   * pipeline over this module's own repositories and app, registers it, and
   * hands the senders back through `connect`.
   */
  readonly eventing?: FeatureEventing;
  /**
   * What this module's App declared it reads. Types erase, so this is what
   * boot reads to build exactly that set and to refuse, naming the module and
   * the member, when this process cannot supply one.
   */
  readonly members?: readonly string[];
  /**
   * Which of this module's two repository tiers a process installs it on.
   *
   * Absent is live, and live is not a default that an absence chose: a store's
   * address is what says it is reached, and a module whose live tier needs a
   * client this process was not given refuses at boot. The one way to get the
   * memory tier is {@link withMemoryRepositories}, in code, at the install.
   */
  readonly tier?: Tier;
  readonly install: (args: FeatureInstallArguments<Members>) => InstalledFeatureState;
}

/** One slice per module name, as a process states the config it hands them. */
export type ModuleConfigRecord = Readonly<Record<string, unknown>>;

/** A process that stated no module config at all. Its key set is empty. */
export type NoModuleConfig = Readonly<Record<never, never>>;

/** The module name a config slice is keyed by, or nothing where it declared none. */
type ConfiguredModuleName<Module> =
  Module extends InstallableServerFeature<never, infer Name, infer Config>
    ? [Config] extends [undefined]
      ? never
      : Name
    : never;

/** The slice one module's own schema parses. */
type ConfiguredModuleConfig<Module> =
  Module extends InstallableServerFeature<never, string, infer Config> ? Config : never;

/**
 * The config a process installing exactly these modules must state.
 *
 * A module that declared no schema contributes nothing; one that did
 * contributes its own name as the key and what its schema parses as the value.
 * A composition annotates its config with this, so the slice it writes is
 * checked where it is written rather than where it is installed.
 */
export type ModuleConfigFor<Modules extends readonly unknown[]> = {
  readonly [Module in Modules[number] as ConfiguredModuleName<Module>]: ConfiguredModuleConfig<Module>;
};

/**
 * Every module on the list whose slice the config already supplied does not cover.
 *
 * A module whose name is not a literal is skipped rather than refused. The
 * guard identifies a module by its name, so a name widened to `string` is one
 * it cannot identify - and a guard that cannot know must not refuse, or it
 * rejects correct calls while naming no module a reader can act on. The legacy
 * `serverFeature` builder is the only thing that produces such a name;
 * `defineServerModule` carries the literal through `const Name`.
 */
type ModulesMissingConfig<Required, Supplied> = {
  [Name in keyof Required]: string extends Name
    ? never
    : number extends Name
      ? never
      : Name extends keyof Supplied
        ? Supplied[Name] extends Required[Name]
          ? never
          : Name
        : Name;
}[keyof Required];

/**
 * What `withModules` asks for from a process that did not state a module's config.
 *
 * It is a type nothing satisfies, carrying the module names in its one
 * property, so the refusal names the modules and the key rather than printing
 * the structural mismatch between two forty-member tuples.
 */
export interface ModuleConfigMissing<Modules extends string> {
  readonly "config this process did not state, by module": Modules;
}

/**
 * Nothing where the supplied config covers this list, and a refusal naming the
 * modules where it does not. Intersected with the list itself at the parameter,
 * so the list is still what the call infers.
 */
export type ModuleConfigGuard<Modules extends readonly unknown[], Supplied> =
  [ModulesMissingConfig<ModuleConfigFor<Modules>, Supplied>] extends [never]
    ? unknown
    : ModuleConfigMissing<ModulesMissingConfig<ModuleConfigFor<Modules>, Supplied> & string>;

/**
 * This module, installed on its memory repositories.
 *
 * It is the only place the word "memory" may be written about a running
 * process, and the only way to run a module without its stores. Memory is
 * therefore always a choice somebody made in code, never what a lost
 * `DATABASE_URL` selected: a module installed this way requires no client, so
 * boot asks for none, and every module beside it still refuses if the store it
 * needs has no address.
 */
export function withMemoryRepositories<Declaration extends Readonly<{ name: string }>>(
  module: Declaration,
): Declaration {
  const registry = (module as Readonly<{ repositoryRegistry?: unknown }>).repositoryRegistry;
  if (registry === void 0) {
    throw new Error(
      `Module "${module.name}" declares no repositories, so it has no memory tier to install.`,
    );
  }
  return Object.freeze({ ...module, tier: "memory" satisfies Tier }) as Declaration;
}

/** A built declaration, with the types its own call sites read back. */
export interface ServerFeatureDeclaration<
  Config,
  Members,
  Dependencies extends TokenMap,
  TransportDependencies extends TokenMap,
  Provided,
  Transport,
  Rest,
  Trpc,
  Worker,
  Name extends string = string,
> extends InstallableServerFeature<Members, Name, Config> {
  /** Present only so the declaration's types are reachable from a runtime read. */
  readonly types: {
    config: Config;
    dependencies: ResolvedTokens<Dependencies>;
    transportDependencies: ResolvedTokens<TransportDependencies>;
    provided: Provided;
    transport: Transport;
    rest: Rest;
    trpc: Trpc;
    worker: Worker;
  };
}

/** What the declaration stage accumulates before a setup exists. */
interface FeatureShape<
  Config,
  Dependencies extends TokenMap,
  TransportDependencies extends TokenMap,
  Name extends string = string,
> {
  readonly name: Name;
  readonly configSchema: FeatureConfigSchema<Config> | undefined;
  readonly dependencies: Dependencies;
  readonly transportDependencies: TransportDependencies;
  /** What this feature reads off the process's members, for a feature with no App. */
  readonly members: readonly string[];
}

/**
 * The first stage: everything a feature states before it says how it is built.
 * Nothing here depends on anything else here, which is why one class can carry
 * all of it without an assertion when a type parameter changes.
 */
export class ServerFeatureBuilder<
  Config,
  Members,
  Dependencies extends TokenMap,
  TransportDependencies extends TokenMap,
  Name extends string = string
> {
  constructor(private readonly shape: FeatureShape<Config, Dependencies, TransportDependencies, Name>) {}

  /** The typed config slice `boot({ config })` must carry for this feature. */
  withConfig<NextConfig>(
    schema: FeatureConfigSchema<NextConfig>,
  ): ServerFeatureBuilder<NextConfig, Members, Dependencies, TransportDependencies, Name> {
    return new ServerFeatureBuilder({ ...this.shape, configSchema: schema });
  }

  /** The contract services this feature needs in EVERY role it is installed in. */
  withDependencies<NextDependencies extends TokenMap>(
    dependencies: NextDependencies,
  ): ServerFeatureBuilder<Config, Members, NextDependencies, TransportDependencies, Name> {
    return new ServerFeatureBuilder({ ...this.shape, dependencies });
  }

  /** The tokens this feature needs only where it serves a transport. They are */
  withTransportDependencies<NextTransportDependencies extends TokenMap>(
    transportDependencies: NextTransportDependencies,
  ): ServerFeatureBuilder<Config, Members, Dependencies, NextTransportDependencies, Name> {
    return new ServerFeatureBuilder({ ...this.shape, transportDependencies });
  }

  /**
   * What this feature reads off the process's members.
   *
   * A module states this on its App with `reads(...)`, and that list is the
   * one boot uses. This is the same declaration for a feature that has no App
   * yet, and it goes with the last of them: it exists so an unconverted
   * feature still gets exactly what it named, rather than the whole record.
   */
  withMembers(
    ...members: readonly string[]
  ): ServerFeatureBuilder<Config, Members, Dependencies, TransportDependencies, Name> {
    return new ServerFeatureBuilder({ ...this.shape, members });
  }

  /** Ordinary code, run once per process, that constructs what this feature owns. */
  withSetup<Provided>(
    setup: (
      args: FeatureSetupArguments<Config, Members, ResolvedTokens<Dependencies>>,
    ) => Provided,
  ): ServerFeatureAssembly<
    Config,
    Members,
    Dependencies,
    TransportDependencies,
    Provided,
    undefined,
    undefined,
    undefined,
    undefined,
    Name
  > {
    return new ServerFeatureAssembly({
      ...this.shape,
      setup,
      providers: [],
      transport: undefined,
      rest: undefined,
      trpc: undefined,
      worker: undefined,
      close: undefined,
      transportFacts: undefined,
    });
  }
}

/** What the assembly stage accumulates once a setup exists. */
interface FeatureAssemblyState<
  Config,
  Members,
  Dependencies extends TokenMap,
  TransportDependencies extends TokenMap,
  Provided,
  Transport,
  Rest,
  Trpc,
  Worker,
  Name extends string = string
> extends FeatureShape<Config, Dependencies, TransportDependencies, Name> {
  readonly setup: (
    args: FeatureSetupArguments<Config, Members, ResolvedTokens<Dependencies>>,
  ) => Provided;
  readonly providers: readonly FeatureProvider<Provided>[];
  readonly transport:
    | ((
        args: FeatureTransportSetupArguments<
          Config,
          Members,
          ResolvedTokens<Dependencies>,
          ResolvedTokens<TransportDependencies>,
          Provided
        >,
      ) => Transport)
    | undefined;
  readonly rest: DoorContribution<
    Config,
    Members,
    Dependencies,
    TransportDependencies,
    Provided,
    Transport,
    Rest
  >;
  readonly trpc: DoorContribution<
    Config,
    Members,
    Dependencies,
    TransportDependencies,
    Provided,
    Transport,
    Trpc
  >;
  readonly worker:
    | ((
        args: FeatureWorkerArguments<
          Config,
          Members,
          ResolvedTokens<Dependencies>,
          Provided
        >,
      ) => Worker)
    | undefined;
  readonly close: ((provided: Provided) => void | Promise<void>) | undefined;
  readonly transportFacts:
    | ((
        args: FeatureTransportArguments<
          Config,
          Members,
          ResolvedTokens<Dependencies>,
          ResolvedTokens<TransportDependencies>,
          Provided,
          Transport
        >,
      ) => readonly TransportFactBinding[])
    | undefined;
}

/** One door's contribution, or nothing where the feature declared no such door. */
type DoorContribution<
  Config,
  Members,
  Dependencies extends TokenMap,
  TransportDependencies extends TokenMap,
  Provided,
  Transport,
  Result,
> =
  | ((
      args: FeatureTransportArguments<
        Config,
        Members,
        ResolvedTokens<Dependencies>,
        ResolvedTokens<TransportDependencies>,
        Provided,
        Transport
      >,
    ) => Result)
  | undefined;

/**
 * The second stage: what the feature exposes and contributes. Each method
 * replaces exactly one field, so the type parameter it changes is the only one
 * the new state names differently.
 */
export class ServerFeatureAssembly<
  Config,
  Members,
  Dependencies extends TokenMap,
  TransportDependencies extends TokenMap,
  Provided,
  Transport,
  Rest,
  Trpc,
  Worker,
  Name extends string = string
> {
  constructor(
    private readonly state: FeatureAssemblyState<
      Config,
      Members,
      Dependencies,
      TransportDependencies,
      Provided,
      Transport,
      Rest,
      Trpc,
      Worker,
      Name
    >,
  ) {}

  /** Publishes the setup result as the feature’s single public app contract. */
  provides<Instance>(
    token: DependencyToken<Instance> & ([Provided] extends [Instance] ? unknown : never),
  ): ServerFeatureAssembly<
    Config,
    Members,
    Dependencies,
    TransportDependencies,
    Provided,
    Transport,
    Rest,
    Trpc,
    Worker,
    Name
  > {
    const alreadyProvidesApp = this.state.providers.length !== 0;
    if (alreadyProvidesApp) {
      throw new Error(
        `Feature "${this.state.name}" already provides its app. Expose services as readonly app members.`,
      );
    }

    return new ServerFeatureAssembly({
      ...this.state,
      providers: [{ token, read: (app: Provided) => app }],
    });
  }

  /** What both doors share, constructed once in a role that serves doors. */
  withTransport<NextTransport>(
    create: (
      args: FeatureTransportSetupArguments<
        Config,
        Members,
        ResolvedTokens<Dependencies>,
        ResolvedTokens<TransportDependencies>,
        Provided
      >,
    ) => NextTransport,
  ): ServerFeatureAssembly<
    Config,
    Members,
    Dependencies,
    TransportDependencies,
    Provided,
    NextTransport,
    undefined,
    undefined,
    Worker,
    Name
  > {
    return new ServerFeatureAssembly({
      ...this.state,
      transport: create,
      rest: undefined,
      trpc: undefined,
      transportFacts: undefined,
    });
  }

  /** What this feature contributes to the process's REST surface. */
  withRest<NextRest>(
    create: (
      args: FeatureTransportArguments<
        Config,
        Members,
        ResolvedTokens<Dependencies>,
        ResolvedTokens<TransportDependencies>,
        Provided,
        Transport
      >,
    ) => NextRest,
  ): ServerFeatureAssembly<
    Config,
    Members,
    Dependencies,
    TransportDependencies,
    Provided,
    Transport,
    NextRest,
    Trpc,
    Worker,
    Name
  > {
    return new ServerFeatureAssembly({ ...this.state, rest: create });
  }

  /**
   * What this feature binds for the facts its own declarations name.
   *
   * A route names a fact the request does not carry - the organization behind
   * the credential, the deep link into the product, the media type it arrived
   * as - and the value for it is the MODULE's to state: it reads the module's
   * own App and the peers the module declared, which the process holds none of
   * and must never re-declare a route to supply. Runs once, at install, in a
   * role that serves doors, and the doors mount what it returned.
   */
  withTransportFacts(
    bind: (
      args: FeatureTransportArguments<
        Config,
        Members,
        ResolvedTokens<Dependencies>,
        ResolvedTokens<TransportDependencies>,
        Provided,
        Transport
      >,
    ) => readonly TransportFactBinding[],
  ): ServerFeatureAssembly<
    Config,
    Members,
    Dependencies,
    TransportDependencies,
    Provided,
    Transport,
    Rest,
    Trpc,
    Worker,
    Name
  > {
    return new ServerFeatureAssembly({ ...this.state, transportFacts: bind });
  }

  /** What this feature contributes to the process's tRPC surface. */
  withTrpc<NextTrpc>(
    create: (
      args: FeatureTransportArguments<
        Config,
        Members,
        ResolvedTokens<Dependencies>,
        ResolvedTokens<TransportDependencies>,
        Provided,
        Transport
      >,
    ) => NextTrpc,
  ): ServerFeatureAssembly<
    Config,
    Members,
    Dependencies,
    TransportDependencies,
    Provided,
    Transport,
    Rest,
    NextTrpc,
    Worker,
    Name
  > {
    return new ServerFeatureAssembly({ ...this.state, trpc: create });
  }

  /** The consumers and schedulers this feature contributes to a worker. */
  withWorker<NextWorker>(
    create: (
      args: FeatureWorkerArguments<Config, Members, ResolvedTokens<Dependencies>, Provided>,
    ) => NextWorker,
  ): ServerFeatureAssembly<
    Config,
    Members,
    Dependencies,
    TransportDependencies,
    Provided,
    Transport,
    Rest,
    Trpc,
    NextWorker,
    Name
  > {
    return new ServerFeatureAssembly({ ...this.state, worker: create });
  }

  /** Releases what the setup acquired. Runs in reverse construction order. */
  withClose(
    close: (provided: Provided) => void | Promise<void>,
  ): ServerFeatureAssembly<
    Config,
    Members,
    Dependencies,
    TransportDependencies,
    Provided,
    Transport,
    Rest,
    Trpc,
    Worker,
    Name
  > {
    return new ServerFeatureAssembly({ ...this.state, close });
  }

  /** The immutable declaration. Building it constructs nothing. */
  build(): ServerFeatureDeclaration<
    Config,
    Members,
    Dependencies,
    TransportDependencies,
    Provided,
    Transport,
    Rest,
    Trpc,
    Worker
  > {
    const state = this.state;
    const declaration = {
      name: state.name,
      configSchema: state.configSchema,
      dependencies: state.dependencies,
      transportDependencies: state.transportDependencies,
      providers: state.providers as readonly FeatureProvider<never>[],
      contributesWorkerWork: state.worker !== undefined,
      members: Object.freeze([...state.members]),
      types: undefined as never,

      install: (args: FeatureInstallArguments<Members>): InstalledFeatureState => {
        const config = parseFeatureConfig(state.name, state.configSchema, args.config);
        const dependencies = resolveTokens(
          state.dependencies,
          args.resolve,
        ) as ResolvedTokens<Dependencies>;
        const setupArguments = {
          config,
          members: args.members,
          dependencies,
          resources: args.resources,
          repositorySelection: args.repositorySelection,
          repositories: args.repositories,
        };
        const provided = state.setup(setupArguments);
        const { worker, close } = state;
        if (close) {
          args.resources.own(state.name, () => close(provided));
        }
        const workerResult =
          args.role === "worker" && worker ? worker({ ...setupArguments, provided }) : void 0;

        const doors =
          args.role === "api"
            ? this.bindTransports(setupArguments, provided, args)
            : { rest: void 0, trpc: void 0, facts: void 0 };
        return {
          provided,
          ...(doors.facts ? { facts: doors.facts } : {}),
          rest: doors.rest,
          trpc: doors.trpc,
          worker: args.role === "worker" && worker ? () => workerResult : undefined,
        };
      },
    };
    return Object.freeze(declaration);
  }

  private bindTransports(
    setupArguments: FeatureSetupArguments<Config, Members, ResolvedTokens<Dependencies>>,
    provided: Provided,
    args: FeatureInstallArguments<Members>,
  ): {
    rest: (() => unknown) | undefined;
    trpc: (() => unknown) | undefined;
    facts: readonly TransportFactBinding[] | undefined;
  } {
    const state = this.state;
    const { rest, trpc } = state;
    const transportDependencies = resolveTokens(
      state.transportDependencies,
      args.resolve,
    ) as ResolvedTokens<TransportDependencies>;
    const transportSetupArguments = {
      ...setupArguments,
      transportDependencies,
      provided,
    };
    // Both transports share this single adapter assembly.
    const transport = state.transport
      ? state.transport(transportSetupArguments)
      : (undefined as Transport);
    const doorArguments = { ...transportSetupArguments, transport };
    const restResult = rest ? rest(doorArguments) : undefined;
    const trpcResult = trpc ? trpc(doorArguments) : undefined;
    return {
      rest: rest ? () => restResult : undefined,
      trpc: trpc ? () => trpcResult : undefined,
      facts: state.transportFacts ? state.transportFacts(doorArguments) : undefined,
    };
  }
}

/**
 * Names one feature installer. The members type is stated here because
 * it is what the application root must be able to supply, and stating it at the
 * end would let a feature declare a need no root could see.
 */
export function serverFeature<Members>(
  name: string,
): ServerFeatureBuilder<undefined, Members, Record<never, never>, Record<never, never>, string> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("A feature installer needs a name.");
  return new ServerFeatureBuilder({
    name: trimmed,
    configSchema: undefined,
    dependencies: {},
    transportDependencies: {},
    members: [],
  });
}

/** Names a module's server half: its App, repositories, channels and transports. */
export function defineServerModule<const Name extends ModuleName>(
  name: Name,
): DefinedFeatureBuilder<Name> {
  publicNamespaceFromUnknown(name);
  return new DefinedFeatureBuilder(name);
}

/** A repository provider as a registry holds it, with its own types erased. */
type AnyProvider = Readonly<{
  requires: readonly string[];
  create: (...arguments_: never[]) => unknown;
}>;

/**
 * The repositories a module's App is handed, whichever tier the process chose.
 * Both tiers answer the same shape, which is what makes `"live" | "memory"` a
 * process decision the module never sees.
 */
type ModuleRepositories<Live extends AnyProvider, Memory extends AnyProvider> = RepositoriesFor<
  RepositoryRegistry<Live, Memory>,
  Tier
>;

/**
 * What the App says it reads off the process's members, as boot reads it back.
 *
 * The list is on the App and nowhere else: `static readonly reads =
 * reads("clock", "logger")`. Types erase, so this is what boot reads at runtime
 * to build exactly that set and to refuse naming both the module and the
 * member; and because `reads(...)` is also the source of the App's own setup
 * type, there is no second list to keep in agreement with it.
 */
function declaredReads(app: Readonly<{ reads?: readonly string[] }>): readonly string[] {
  return Object.freeze([...(app.reads ?? [])]);
}

class DefinedFeatureBuilder<Name extends ModuleName> {
  constructor(private readonly name: Name) {}

  withRepositories<const Live extends AnyProvider, const Memory extends AnyProvider>(
    repositories: RepositoryRegistry<Live, Memory>,
  ): RepositoryDefinedFeatureBuilder<Name, Live, Memory> {
    return new RepositoryDefinedFeatureBuilder(this.name, repositories);
  }

  withApp<Dependencies extends TokenMap, Members, Config, App>(
    app: AppDefinition<Dependencies, Members, Config, App>,
  ): ConfiguredAppBuilder<Name, Dependencies, Members, Config, App>;
  withApp<Dependencies extends TokenMap, Members, App>(
    app: AppDefinitionWithoutConfig<Dependencies, Members, App>,
  ): UnconfiguredAppBuilder<Name, Dependencies, Members, App>;
  withApp(
    app:
      | AppDefinition<TokenMap, unknown, unknown, unknown>
      | AppDefinitionWithoutConfig<TokenMap, unknown, unknown>,
  ):
    | ConfiguredAppBuilder<Name, TokenMap, unknown, unknown, unknown>
    | UnconfiguredAppBuilder<Name, TokenMap, unknown, unknown> {
    if ("configSchema" in app) {
      return new ConfiguredAppBuilder(this.name, app);
    }
    return new UnconfiguredAppBuilder(this.name, app);
  }
}

type RepositoryAppDefinition<
  Dependencies extends TokenMap,
  Members,
  Config,
  Repositories,
  App,
> = AppContract<Dependencies, App> &
  Readonly<{
    readonly configSchema: FeatureConfigSchema<Config>;
    readonly reads?: readonly string[];
    readonly create: (
      setup: FeatureSetup<NoInfer<Dependencies>, never, NoInfer<Config>, Repositories> &
        Readonly<{ members: Members }>,
    ) => NoInfer<App>;
  }>;

type RepositoryAppDefinitionWithoutConfig<
  Dependencies extends TokenMap,
  Members,
  Repositories,
  App,
> = AppContract<Dependencies, App> &
  Readonly<{
    readonly reads?: readonly string[];
    readonly create: (
      setup: FeatureSetup<NoInfer<Dependencies>, never, undefined, Repositories> &
        Readonly<{ members: Members }>,
    ) => NoInfer<App>;
  }>;

class RepositoryDefinedFeatureBuilder<
  Name extends ModuleName,
  Live extends AnyProvider,
  Memory extends AnyProvider,
> {
  constructor(
    private readonly name: Name,
    private readonly repositories: RepositoryRegistry<Live, Memory>,
  ) {}

  withApp<Dependencies extends TokenMap, Members extends object, Config, App>(
    app: RepositoryAppDefinition<
      Dependencies,
      Members,
      Config,
      ModuleRepositories<Live, Memory>,
      App
    >,
  ): RepositoryAppBuilder<Name, Live, Memory, Dependencies, Members, Config, App>;
  withApp<Dependencies extends TokenMap, Members extends object = object, App = unknown>(
    app: RepositoryAppDefinitionWithoutConfig<
      Dependencies,
      Members,
      ModuleRepositories<Live, Memory>,
      App
    >,
  ): RepositoryUnconfiguredAppBuilder<Name, Live, Memory, Dependencies, Members, App>;
  withApp<Dependencies extends TokenMap, Members extends object, Config, App>(
    app:
      | RepositoryAppDefinition<
          Dependencies,
          Members,
          Config,
          ModuleRepositories<Live, Memory>,
          App
        >
      | RepositoryAppDefinitionWithoutConfig<
          Dependencies,
          Members,
          ModuleRepositories<Live, Memory>,
          App
        >,
  ) {
    if ("configSchema" in app) {
      return new RepositoryAppBuilder(this.name, this.repositories, app);
    }
    return new RepositoryUnconfiguredAppBuilder(this.name, this.repositories, app);
  }
}

class RepositoryAppBuilder<
  Name extends ModuleName,
  Live extends AnyProvider,
  Memory extends AnyProvider,
  Dependencies extends TokenMap,
  Members,
  Config,
  App,
> {
  constructor(
    private readonly name: Name,
    private readonly repositories: RepositoryRegistry<Live, Memory>,
    private readonly app: RepositoryAppDefinition<
      Dependencies,
      Members,
      Config,
      ModuleRepositories<Live, Memory>,
      App
    >,
  ) {}

  withTransports<const Transports extends readonly FeatureTransportDescriptor[]>(
    ...transports: Transports
  ): ModuleContributions<
    ReturnType<
      RepositoryAppBuilder<Name, Live, Memory, Dependencies, Members, Config, App>["build"]
    > & { readonly transports: Transports; readonly namespace: PublicNamespace<Name> },
    ModuleRepositories<Live, Memory>,
    App,
    Dependencies,
    Members
  > {
    return withContributions<
      ReturnType<
        RepositoryAppBuilder<Name, Live, Memory, Dependencies, Members, Config, App>["build"]
      > & { readonly transports: Transports; readonly namespace: PublicNamespace<Name> },
      ModuleRepositories<Live, Memory>,
      App,
      Dependencies,
      Members
    >({ ...this.build(), transports, namespace: publicNamespace(this.name) }, [], []);
  }

  /** Background work this module contributes to the worker role. */
  withWorkers(...workers: readonly unknown[]) {
    return withContributions<
      ReturnType<
        RepositoryAppBuilder<Name, Live, Memory, Dependencies, Members, Config, App>["build"]
      >,
      ModuleRepositories<Live, Memory>,
      App
    >(this.build(), workers, []);
  }

  /** One-shot work this module contributes to the tasks role. */
  withTasks(...tasks: readonly unknown[]) {
    return withContributions<
      ReturnType<
        RepositoryAppBuilder<Name, Live, Memory, Dependencies, Members, Config, App>["build"]
      >,
      ModuleRepositories<Live, Memory>,
      App
    >(this.build(), [], tasks);
  }

  build(): ServerFeatureDeclaration<
    Config,
    Members,
    Dependencies,
    Record<never, never>,
    App,
    undefined,
    undefined,
    undefined,
    undefined,
    Name
  > {
    const app = this.app;
    const registry = this.repositories;
    const name = this.name;
    const setup = serverFeature<Members>(name)
      .withConfig(app.configSchema)
      .withDependencies(app.dependencies)
      .withSetup(({ dependencies, members, config, resources, repositories }) => {
        return app.create({
          dependencies,
          members,
          config,
          resources,
          repositories: repositories as ModuleRepositories<Live, Memory>,
        });
      })
      .provides(app.contract)
      .build();
    return {
      ...setup,
      // The name is the literal the module was declared with, which is the key
      // its config slice is stated under. The builder chain above widens it.
      name,
      // The registry is read ONCE per install, here, and the instances are
      // handed to the app and to this module's eventing declaration alike. A
      // second read would give the two halves separate objects over the same
      // rows, and a memory tier two separate databases.
      install: (args) => {
        if (!args.repositorySelection) {
          throw new Error(`Module "${name}" was installed without a repository tier.`);
        }
        const repositories = instantiateRepositories(registry, args.repositorySelection);
        return { ...setup.install({ ...args, repositories }), repositories };
      },
      members: declaredReads(app),
      repositoryRegistry: registry as AnyRepositoryRegistry,
      ...(app.contract instanceof ModuleApiToken ? { apiContract: app.contract } : {}),
    };
  }

  /**
   * This module's event sourcing, declared with `defineEventingModule`. It is
   * built over the repositories and app above, so a declaration written for
   * another module is not assignable here.
   */
  withEventing<Definition>(
    eventing: FeatureEventing<ModuleRepositories<Live, Memory>, App, unknown, Definition>,
  ): ModuleContributions<
    ReturnType<
      RepositoryAppBuilder<Name, Live, Memory, Dependencies, Members, Config, App>["build"]
    >,
    ModuleRepositories<Live, Memory>,
    App
  > {
    return withContributions<
      ReturnType<
        RepositoryAppBuilder<Name, Live, Memory, Dependencies, Members, Config, App>["build"]
      >,
      ModuleRepositories<Live, Memory>,
      App
    >(this.build(), [], [], eventing as FeatureEventing);
  }
}

class RepositoryUnconfiguredAppBuilder<
  Name extends ModuleName,
  Live extends AnyProvider,
  Memory extends AnyProvider,
  Dependencies extends TokenMap,
  Members extends object,
  App,
> extends RepositoryAppBuilder<Name, Live, Memory, Dependencies, Members, undefined, App> {
  constructor(
    name: Name,
    repositories: RepositoryRegistry<Live, Memory>,
    app: RepositoryAppDefinitionWithoutConfig<
      Dependencies,
      Members,
      ModuleRepositories<Live, Memory>,
      App
    >,
  ) {
    // Named member by member: an app is usually a class, and spreading a class
    // drops its static methods (`create` is not enumerable).
    super(
      name,
      repositories,
      {
        contract: app.contract,
        dependencies: app.dependencies,
        configSchema: { parse: () => void 0 },
        ...(app.reads === undefined ? {} : { reads: app.reads }),
        create: (setup) => app.create(setup),
      } as RepositoryAppDefinition<
        Dependencies,
        Members,
        undefined,
        ModuleRepositories<Live, Memory>,
        App
      >,
    );
  }
}

class ConfiguredAppBuilder<
  Name extends ModuleName,
  Dependencies extends TokenMap,
  Members,
  Config,
  App,
> {
  constructor(
    private readonly name: Name,
    private readonly app: AppDefinition<Dependencies, Members, Config, App>,
  ) {}

  withTransports<const Transports extends readonly FeatureTransportDescriptor[]>(
    ...transports: Transports
  ): ConfiguredAppWithTransportsBuilder<Name, Dependencies, Members, Config, App, Transports> {
    return new ConfiguredAppWithTransportsBuilder(this.name, this.app, transports);
  }

  /** Background work this module contributes to the worker role. */
  withWorkers(...workers: readonly unknown[]) {
    return withContributions(this.build(), workers, []);
  }

  /** One-shot work this module contributes to the tasks role. */
  withTasks(...tasks: readonly unknown[]) {
    return withContributions(this.build(), [], tasks);
  }

  /** This module's event sourcing, built over the app above. */
  withEventing<Definition>(eventing: FeatureEventing<undefined, App, unknown, Definition>) {
    return withContributions(this.build(), [], [], eventing as FeatureEventing);
  }

  build(): ServerFeatureDeclaration<
    Config,
    Members,
    Dependencies,
    Record<never, never>,
    App,
    undefined,
    undefined,
    undefined,
    undefined,
    Name
  > {
    const app = this.app;
    const declaration = serverFeature<Members>(this.name)
      .withConfig(app.configSchema)
      .withDependencies(app.dependencies)
      .withSetup(({ dependencies, members, config, resources }) =>
        app.create({
          dependencies,
          members,
          config,
          resources,
        }),
      )
      .provides(app.contract)
      .build();
    return {
      ...declaration,
      name: this.name,
      repositories: snapshotRepositories(app.repositories),
      members: declaredReads(app),
      ...(app.contract instanceof ModuleApiToken ? { apiContract: app.contract } : {}),
    };
  }
}

class UnconfiguredAppBuilder<
  Name extends ModuleName,
  Dependencies extends TokenMap,
  Members,
  App,
> {
  constructor(
    private readonly name: Name,
    private readonly app: AppDefinitionWithoutConfig<Dependencies, Members, App>,
  ) {}

  withTransports<const Transports extends readonly FeatureTransportDescriptor[]>(
    ...transports: Transports
  ): UnconfiguredAppWithTransportsBuilder<Name, Dependencies, Members, App, Transports> {
    return new UnconfiguredAppWithTransportsBuilder(this.name, this.app, transports);
  }

  /** Background work this module contributes to the worker role. */
  withWorkers(...workers: readonly unknown[]) {
    return withContributions(this.build(), workers, []);
  }

  /** One-shot work this module contributes to the tasks role. */
  withTasks(...tasks: readonly unknown[]) {
    return withContributions(this.build(), [], tasks);
  }

  /** This module's event sourcing, built over the app above. */
  withEventing<Definition>(eventing: FeatureEventing<undefined, App, unknown, Definition>) {
    return withContributions(this.build(), [], [], eventing as FeatureEventing);
  }

  build(): ServerFeatureDeclaration<
    undefined,
    Members,
    Dependencies,
    Record<never, never>,
    App,
    undefined,
    undefined,
    undefined,
    undefined,
    Name
  > {
    const app = this.app;
    const declaration = serverFeature<Members>(this.name)
      .withConfig({ parse: () => void 0 })
      .withDependencies(app.dependencies)
      .withSetup(({ dependencies, members, config, resources }) =>
        app.create({
          dependencies,
          members,
          config,
          resources,
        }),
      )
      .provides(app.contract)
      .build();
    return {
      ...declaration,
      name: this.name,
      repositories: snapshotRepositories(app.repositories),
      members: declaredReads(app),
      ...(app.contract instanceof ModuleApiToken ? { apiContract: app.contract } : {}),
    };
  }
}

class ConfiguredAppWithTransportsBuilder<
  Name extends ModuleName,
  Dependencies extends TokenMap,
  Members,
  Config,
  App,
  Transports extends readonly FeatureTransportDescriptor[],
> {
  constructor(
    private readonly name: Name,
    private readonly app: AppDefinition<Dependencies, Members, Config, App>,
    private readonly transports: Transports,
  ) {}

  /**
   * What this module binds for the facts its own declarations name. Answers a
   * declaration that is already installable, so there is no half-declared
   * module and no build step to forget.
   */
  withTransportFacts(
    bind: ModuleTransportFacts<Dependencies, Members, App>,
  ): ModuleContributions<
    ReturnType<ConfiguredAppWithTransportsBuilder<Name, Dependencies, Members, Config, App, Transports>["build"]>,
    unknown,
    App,
    Dependencies,
    Members
  > {
    return withContributions<
      ReturnType<ConfiguredAppWithTransportsBuilder<Name, Dependencies, Members, Config, App, Transports>["build"]>,
      unknown,
      App,
      Dependencies,
      Members
    >(bindingTransportFacts(this.build(), bind as ModuleTransportFacts<TokenMap, never, never>), [], []);
  }

  /** Background work this module contributes to the worker role. */
  withWorkers(...workers: readonly unknown[]) {
    return withContributions(this.build(), workers, []);
  }

  /** One-shot work this module contributes to the tasks role. */
  withTasks(...tasks: readonly unknown[]) {
    return withContributions(this.build(), [], tasks);
  }

  /** This module's event sourcing, built over the app above. */
  withEventing<Definition>(eventing: FeatureEventing<undefined, App, unknown, Definition>) {
    return withContributions(this.build(), [], [], eventing as FeatureEventing);
  }

  build(): ServerFeatureDeclaration<
    Config,
    Members,
    Dependencies,
    Record<never, never>,
    App,
    undefined,
    undefined,
    undefined,
    undefined,
    Name
  > & { readonly transports: Transports; readonly namespace: PublicNamespace<Name> } {
    const declaration = new ConfiguredAppBuilder(this.name, this.app).build();
    return {
      ...declaration,
      transports: this.transports,
      namespace: publicNamespace(this.name),
    };
  }
}

class UnconfiguredAppWithTransportsBuilder<
  Name extends ModuleName,
  Dependencies extends TokenMap,
  Members,
  App,
  Transports extends readonly FeatureTransportDescriptor[],
> {
  constructor(
    private readonly name: Name,
    private readonly app: AppDefinitionWithoutConfig<Dependencies, Members, App>,
    private readonly transports: Transports,
  ) {}

  /**
   * What this module binds for the facts its own declarations name. Answers a
   * declaration that is already installable, so there is no half-declared
   * module and no build step to forget.
   */
  withTransportFacts(
    bind: ModuleTransportFacts<Dependencies, Members, App>,
  ): ModuleContributions<
    ReturnType<UnconfiguredAppWithTransportsBuilder<Name, Dependencies, Members, App, Transports>["build"]>,
    unknown,
    App,
    Dependencies,
    Members
  > {
    return withContributions<
      ReturnType<UnconfiguredAppWithTransportsBuilder<Name, Dependencies, Members, App, Transports>["build"]>,
      unknown,
      App,
      Dependencies,
      Members
    >(bindingTransportFacts(this.build(), bind as ModuleTransportFacts<TokenMap, never, never>), [], []);
  }

  /** Background work this module contributes to the worker role. */
  withWorkers(...workers: readonly unknown[]) {
    return withContributions(this.build(), workers, []);
  }

  /** One-shot work this module contributes to the tasks role. */
  withTasks(...tasks: readonly unknown[]) {
    return withContributions(this.build(), [], tasks);
  }

  /** This module's event sourcing, built over the app above. */
  withEventing<Definition>(eventing: FeatureEventing<undefined, App, unknown, Definition>) {
    return withContributions(this.build(), [], [], eventing as FeatureEventing);
  }

  build(): ServerFeatureDeclaration<
    undefined,
    Members,
    Dependencies,
    Record<never, never>,
    App,
    undefined,
    undefined,
    undefined,
    undefined,
    Name
  > & { readonly transports: Transports; readonly namespace: PublicNamespace<Name> } {
    const declaration = new UnconfiguredAppBuilder(this.name, this.app).build();
    return {
      ...declaration,
      transports: this.transports,
      namespace: publicNamespace(this.name),
    };
  }
}

/**
 * A declaration that is already installable and still accepts the work a role
 * other than the api owns. Every call answers a declaration, so a module can
 * never be left half-declared (ADR-144 s1).
 */
export type ModuleContributions<
  Declaration,
  Repositories = unknown,
  App = unknown,
  Dependencies extends TokenMap = TokenMap,
  Members = unknown,
> = Declaration &
  Readonly<{
    readonly workers: readonly unknown[];
    readonly tasks: readonly unknown[];
    readonly eventing: FeatureEventing | undefined;
    withWorkers(
      ...workers: readonly unknown[]
    ): ModuleContributions<Declaration, Repositories, App, Dependencies, Members>;
    withTasks(
      ...tasks: readonly unknown[]
    ): ModuleContributions<Declaration, Repositories, App, Dependencies, Members>;
    /** What this module binds for the facts its own declarations name. */
    withTransportFacts(
      bind: ModuleTransportFacts<Dependencies, Members, App>,
    ): ModuleContributions<Declaration, Repositories, App, Dependencies, Members>;
    withEventing<Definition>(
      eventing: FeatureEventing<Repositories, App, unknown, Definition>,
    ): ModuleContributions<Declaration, Repositories, App, Dependencies, Members>;
    build(): Declaration &
      Readonly<{
        workers: readonly unknown[];
        tasks: readonly unknown[];
        eventing: FeatureEventing | undefined;
      }>;
  }>;

/** A built declaration, as the facts wrapper reads the two fields it needs. */
interface InstallableDeclaration {
  readonly dependencies: TokenMap;
  readonly install: (args: FeatureInstallArguments<never>) => InstalledFeatureState;
}

/**
 * The same declaration, with its own transport facts bound at install.
 *
 * Nothing runs outside the api role: a worker installs the same module and
 * builds no doors, so binding facts there would construct a request-time
 * closure over an App nothing ever calls it with.
 */
function bindingTransportFacts<Declaration extends object>(
  declaration: Declaration,
  bind: ModuleTransportFacts<TokenMap, never, never>,
): Declaration {
  const installable = declaration as Declaration & InstallableDeclaration;

  return {
    ...declaration,
    install: (args: FeatureInstallArguments<never>): InstalledFeatureState => {
      const state = installable.install(args);
      if (args.role !== "api") return state;

      return {
        ...state,
        facts: bind({
          app: state.provided as never,
          dependencies: resolveTokens(installable.dependencies, args.resolve) as ResolvedTokens<TokenMap>,
          members: args.members,
        }),
      };
    },
  };
}

/** Adds the worker, task, facts and eventing halves to a built declaration. */
function withContributions<
  Declaration extends object,
  Repositories = unknown,
  App = unknown,
  Dependencies extends TokenMap = TokenMap,
  Members = unknown,
>(
  declaration: Declaration,
  workers: readonly unknown[],
  tasks: readonly unknown[],
  eventing?: FeatureEventing,
): ModuleContributions<Declaration, Repositories, App, Dependencies, Members> {
  const contributed = { ...declaration, workers, tasks, eventing };
  return {
    ...contributed,
    withWorkers: (...next: readonly unknown[]) =>
      withContributions(declaration, [...workers, ...next], tasks, eventing),
    withTasks: (...next: readonly unknown[]) =>
      withContributions(declaration, workers, [...tasks, ...next], eventing),
    withTransportFacts: (bind: ModuleTransportFacts<TokenMap, never, never>) =>
      withContributions(bindingTransportFacts(declaration, bind), workers, tasks, eventing),
    withEventing: (next: FeatureEventing) => withContributions(declaration, workers, tasks, next),
    build: () => contributed,
  } as ModuleContributions<Declaration, Repositories, App, Dependencies, Members>;
}

function parseFeatureConfig<Config>(
  feature: string,
  schema: FeatureConfigSchema<Config> | undefined,
  value: unknown,
): Config {
  if (schema === undefined) return void 0 as Config;
  try {
    return schema.parse(value);
  } catch (error) {
    throw new FeatureConfigError(feature, error instanceof Error ? error.message : String(error));
  }
}

function resolveTokens(
  tokens: TokenMap,
  resolve: (token: TokenIdentity) => unknown,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, token] of Object.entries(tokens)) {
    resolved[key] = resolve(token);
  }
  return resolved;
}
