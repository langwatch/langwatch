import type { ConfigOf, ConfigSlice } from "@langwatch/config";
import { ScopedSecrets, type SecretHandle } from "@langwatch/secrets";

import { FeatureSecretsUnavailableError } from "./boot-errors.ts";
/** One feature installer. A feature declares its config, the contract services */
import type {
  DependencyIdentity,
  DependencyToken,
  ResolvedTokens,
  TokenIdentity,
  TokenMap,
} from "./dependency-token.ts";
import { ModuleApiToken, type FeatureApiIdentity } from "./module-api-token.ts";
import { withAnotherPipeline, type FeatureEventing } from "./module-eventing.ts";
import type { ModuleName, PublicNamespace } from "./module-namespace.ts";
import { publicNamespace, publicNamespaceFromUnknown } from "./module-namespace.ts";
import { snapshotRepositories, type FeatureRepositories } from "./repository-ownership.ts";
import {
  instantiateRepositories,
  type AnyRepositoryRegistry,
  type RepositoriesFor,
  type RepositoryRegistry,
  type RepositorySelection,
} from "./repository-registry.ts";
import type { ResourceOwnership } from "./resource-scope.ts";
import type { Tier } from "./tiers.ts";
import type { TransportFactBinding } from "./transport-mounting.ts";

/** Which process is booting. A role hosts only the work that role owns. */
export type ServerRole = "api" | "worker" | "tasks";

/**
 * How the application root narrows the process's one resolver to a single
 * module: its own declared handles, and nothing else in the process.
 */
export type ModuleSecretsScope = (
  owner: string,
  declared: readonly SecretHandle<unknown>[],
) => ScopedSecrets;

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
  /** This module's declared handles, resolved only through `into` (§6). */
  readonly secrets: ScopedSecrets;
}> &
  ([Members] extends [never] ? object : Readonly<{ readonly members: Members }>) &
  ([Repositories] extends [never] ? object : Readonly<{ readonly repositories: Repositories }>);

type AppContract<Dependencies extends TokenMap, App> =
  | Readonly<{
      contract: ModuleApiToken<App>;
      dependencies: Dependencies & Readonly<Record<string, DependencyIdentity>>;
    }>
  | Readonly<{ contract: abstract new (...args: never[]) => App; dependencies: Dependencies }>;

/** Static construction metadata owned by a server app implementation. */
export type AppDefinition<Dependencies extends TokenMap, Members, Config, App> = AppContract<
  Dependencies,
  App
> &
  Readonly<{
    /** Present when the App declared its own slice instead (§6). */
    readonly config?: ConfigSlice;
    readonly repositories?: FeatureRepositories;
    /** What this App reads off the process's members, declared with `reads(...)`. */
    readonly reads?: readonly string[];
    readonly create: (
      setup: FeatureSetup<NoInfer<Dependencies>, Members, NoInfer<Config>>,
    ) => NoInfer<App> | Promise<NoInfer<App>>;
  }>;

/**
 * An App that declares its own config slice (§6). The process parses every
 * owner once, so `create` receives that slice already parsed — there is no
 * second schema and no second parse.
 */
export type DeclaredConfigAppDefinition<
  Dependencies extends TokenMap,
  Members,
  Slice extends ConfigSlice,
  App,
> = AppContract<Dependencies, App> &
  Readonly<{
    readonly config: Slice;
    readonly repositories?: FeatureRepositories;
    readonly reads?: readonly string[];
    readonly create: (
      setup: FeatureSetup<NoInfer<Dependencies>, Members, ConfigOf<Slice>>,
    ) => NoInfer<App> | Promise<NoInfer<App>>;
  }>;

/** Static construction metadata for an app with no semantic configuration. */
export type AppDefinitionWithoutConfig<Dependencies extends TokenMap, Members, App> = AppContract<
  Dependencies,
  App
> &
  Readonly<{
    readonly repositories?: FeatureRepositories;
    /** What this App reads off the process's members, declared with `reads(...)`. */
    readonly reads?: readonly string[];
    readonly create: (
      setup: FeatureSetup<NoInfer<Dependencies>, Members, undefined>,
    ) => NoInfer<App> | Promise<NoInfer<App>>;
  }>;

/** Module supplies facts (org, link, media type) its routes declare. */
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

/** What a task binder is handed: the transport-fact setup plus the module's own repositories. */
export interface ModuleTaskSetup<
  Dependencies extends TokenMap,
  Members,
  Repositories,
  App,
> extends ModuleTransportFactSetup<Dependencies, Members, App> {
  readonly repositories: Repositories;
}

/** Builds a module's one-shot tasks over its booted App, once at install in the tasks role. */
export type ModuleTaskBinder<Dependencies extends TokenMap, Members, Repositories, App> = (
  setup: ModuleTaskSetup<Dependencies, Members, Repositories, App>,
) => readonly unknown[];

/** An inert API descriptor retained for the process root to mount later. */
export type FeatureTransportDescriptor = Readonly<{
  readonly protocol: "rest" | "trpc" | "websocket";
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
  /**
   * Exactly the handles this module declared, and the only way to resolve one
   * (§6): `into(handle, build)` hands the value to the closure and lets only
   * the constructed collaborator escape. Resolving seals when boot finishes.
   */
  readonly secrets: ScopedSecrets;
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
  /** The tasks this module's binders built over its App, in the tasks role only. */
  readonly tasks?: readonly unknown[];
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
  /**
   * Scoped to this module's own declared handles by the application root. A
   * process that composed no resolver supplies none, and a module that then
   * resolves one refuses by name rather than reading an undeclared secret.
   */
  readonly secrets?: ScopedSecrets;
  /** The instance the graph resolved for one token. */
  resolve: (token: TokenIdentity) => unknown;
}

/**
 * Application root's view of a module. Retains name + config schema for
 * compile-time checking (ADR-144).
 */
export interface InstallableServerFeature<Members, Name extends string = string, Config = unknown> {
  readonly name: Name;
  /**
   * Phantom: the slice type the one process parse (§6) produces for this
   * feature. Type-only, never read, and the anchor `ModuleConfigGuard` infers
   * a module's config from — without it the guard silently checks nothing.
   */
  readonly configType?: Config;
  readonly config?: ConfigSlice;
  readonly secrets?: Readonly<Record<string, SecretHandle<unknown>>>;
  readonly publicConfig?: (config: unknown) => unknown;
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
  /** Event sourcing declared with withEventing. */
  readonly eventing?: FeatureEventing;
  /**
   * What this module's App declared it reads. Types erase, so this is what
   * boot reads to build exactly that set and to refuse, naming the module and
   * the member, when this process cannot supply one.
   */
  readonly members?: readonly string[];
  /** Repository tier: live (default) or memory via withMemoryRepositories. */
  readonly tier?: Tier;
  readonly install: (args: FeatureInstallArguments<Members>) => Promise<InstalledFeatureState>;
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

/** Config each module's schema requires for the process to install it. */
export type ModuleConfigFor<Modules extends readonly unknown[]> = {
  readonly [
    Module in Modules[number] as ConfiguredModuleName<Module>
  ]: ConfiguredModuleConfig<Module>;
};

/**
 * Every module whose slice the supplied config does not cover. A guard that cannot
 * know must not refuse: a module name widened to `string`, and a config typed as an
 * open record, state nothing checkable, so each module's schema refuses it at boot.
 */
type ModulesMissingConfig<Required, Supplied> = string extends keyof Supplied
  ? never
  : {
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

/** Guard type refusing processes that didn't state a module's config. */
export interface ModuleConfigMissing<Modules extends string> {
  readonly "config this process did not state, by module": Modules;
}

/**
 * Nothing where the supplied config covers this list, and a refusal naming the
 * modules where it does not. Intersected with the list itself at the parameter,
 * so the list is still what the call infers.
 */
export type ModuleConfigGuard<Modules extends readonly unknown[], Supplied> = [
  ModulesMissingConfig<ModuleConfigFor<Modules>, Supplied>,
] extends [never]
  ? unknown
  : ModuleConfigMissing<ModulesMissingConfig<ModuleConfigFor<Modules>, Supplied> & string>;

/**
 * Run module on memory repositories (no external store needed).
 * Always explicit; never chosen by missing DATABASE_URL.
 */
export function withMemoryRepositories<Declaration extends Readonly<{ name: string }>>(
  module: Declaration,
): Declaration & Readonly<{ tier: "memory" }> {
  const registry = (module as Readonly<{ repositoryRegistry?: unknown }>).repositoryRegistry;
  if (registry === void 0) {
    throw new Error(
      `Module "${module.name}" declares no repositories, so it has no memory tier to install.`,
    );
  }
  return Object.freeze({ ...module, tier: "memory" satisfies Tier });
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
  readonly dependencies: Dependencies;
  readonly transportDependencies: TransportDependencies;
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
  Dependencies extends TokenMap,
  TransportDependencies extends TokenMap,
  Name extends string = string,
> {
  readonly name: Name;
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
  Name extends string = string,
> {
  constructor(private readonly shape: FeatureShape<Dependencies, TransportDependencies, Name>) {}

  /**
   * States the slice type the one process parse (§6) produces for this
   * feature. Type-only: there is no second schema and nothing runs here.
   */
  withConfigType<NextConfig>(): ServerFeatureBuilder<
    NextConfig,
    Members,
    Dependencies,
    TransportDependencies,
    Name
  > {
    return new ServerFeatureBuilder(this.shape);
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

  /** Declare members this feature reads (or use App's reads()). */
  withMembers(
    ...members: readonly string[]
  ): ServerFeatureBuilder<Config, Members, Dependencies, TransportDependencies, Name> {
    return new ServerFeatureBuilder({ ...this.shape, members });
  }

  /** Ordinary code, run once per process, that constructs what this feature owns. */
  withSetup<Provided>(
    setup: (
      args: FeatureSetupArguments<Config, Members, ResolvedTokens<Dependencies>>,
    ) => Provided | Promise<Provided>,
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
  Name extends string = string,
> extends FeatureShape<Dependencies, TransportDependencies, Name> {
  readonly setup: (
    args: FeatureSetupArguments<Config, Members, ResolvedTokens<Dependencies>>,
  ) => Provided | Promise<Provided>;
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
        args: FeatureWorkerArguments<Config, Members, ResolvedTokens<Dependencies>, Provided>,
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
  Name extends string = string,
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

  /** Module supplies facts its routes declare. Runs once at install. */
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
      dependencies: state.dependencies,
      transportDependencies: state.transportDependencies,
      providers: state.providers as readonly FeatureProvider<never>[],
      contributesWorkerWork: state.worker !== undefined,
      members: Object.freeze([...state.members]),
      types: undefined as never,

      install: async (args: FeatureInstallArguments<Members>): Promise<InstalledFeatureState> => {
        const config = declaredConfig<Config>(args.config);
        const dependencies = resolveTokens(
          state.dependencies,
          args.resolve,
        ) as ResolvedTokens<Dependencies>;
        const setupArguments = {
          config,
          secrets: args.secrets ?? undeclaredSecrets(state.name),
          members: args.members,
          dependencies,
          resources: args.resources,
          repositorySelection: args.repositorySelection,
          repositories: args.repositories,
        };
        // A module resolving a secret does so in `create()`, so the whole
        // install awaits: only the constructed collaborator comes back.
        const provided = await state.setup(setupArguments);
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

/** Extract member reads from the App's static readonly reads declaration. */
function declaredReads<const Reads extends readonly string[]>(
  app: Readonly<{ reads?: Reads }>,
): readonly Reads[number][] {
  return Object.freeze([...(app.reads ?? [])]);
}

class DefinedFeatureBuilder<Name extends ModuleName> {
  constructor(private readonly name: Name) {}

  withRepositories<const Live extends AnyProvider, const Memory extends AnyProvider>(
    repositories: RepositoryRegistry<Live, Memory>,
  ): RepositoryDefinedFeatureBuilder<Name, Live, Memory> {
    return new RepositoryDefinedFeatureBuilder(this.name, repositories);
  }

  withApp<
    Dependencies extends TokenMap,
    Members,
    Config,
    App,
    const Reads extends readonly string[],
  >(
    app: AppDefinition<Dependencies, Members, Config, App> & { readonly reads: Reads },
  ): ConfiguredAppBuilder<Name, Dependencies, Members, Config, App, Reads>;
  withApp<
    Dependencies extends TokenMap,
    Members,
    Slice extends ConfigSlice,
    App,
    const Reads extends readonly string[],
  >(
    app: DeclaredConfigAppDefinition<Dependencies, Members, Slice, App> & { readonly reads: Reads },
  ): ConfiguredAppBuilder<Name, Dependencies, Members, ConfigOf<Slice>, App, Reads>;
  withApp<Dependencies extends TokenMap, Members, App, const Reads extends readonly string[]>(
    app: AppDefinitionWithoutConfig<Dependencies, Members, App> & { readonly reads: Reads },
  ): UnconfiguredAppBuilder<Name, Dependencies, Members, App, Reads>;
  withApp<Dependencies extends TokenMap, Members, Config, App>(
    app: AppDefinition<Dependencies, Members, Config, App>,
  ): ConfiguredAppBuilder<Name, Dependencies, Members, Config, App, readonly []>;
  withApp<Dependencies extends TokenMap, Members, Slice extends ConfigSlice, App>(
    app: DeclaredConfigAppDefinition<Dependencies, Members, Slice, App>,
  ): ConfiguredAppBuilder<Name, Dependencies, Members, ConfigOf<Slice>, App, readonly []>;
  withApp<Dependencies extends TokenMap, Members, App>(
    app: AppDefinitionWithoutConfig<Dependencies, Members, App>,
  ): UnconfiguredAppBuilder<Name, Dependencies, Members, App, readonly []>;
  withApp(
    app:
      | AppDefinition<TokenMap, unknown, unknown, unknown>
      | AppDefinitionWithoutConfig<TokenMap, unknown, unknown>,
  ): object {
    if ("config" in app) {
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
    /** Present when the App declared its own slice instead (§6). */
    readonly config?: ConfigSlice;
    readonly reads?: readonly string[];
    readonly create: (
      setup: FeatureSetup<NoInfer<Dependencies>, never, NoInfer<Config>, Repositories> &
        Readonly<{ members: Members }>,
    ) => NoInfer<App> | Promise<NoInfer<App>>;
  }>;

/**
 * The repository path's twin of {@link DeclaredConfigAppDefinition}: an App
 * over its own repositories declaring a config slice, not a second schema.
 */
type RepositoryDeclaredConfigAppDefinition<
  Dependencies extends TokenMap,
  Members,
  Slice extends ConfigSlice,
  Repositories,
  App,
> = AppContract<Dependencies, App> &
  Readonly<{
    readonly config: Slice;
    readonly reads?: readonly string[];
    readonly create: (
      setup: FeatureSetup<NoInfer<Dependencies>, never, ConfigOf<Slice>, Repositories> &
        Readonly<{ members: Members }>,
    ) => NoInfer<App> | Promise<NoInfer<App>>;
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
    ) => NoInfer<App> | Promise<NoInfer<App>>;
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

  withApp<
    Dependencies extends TokenMap,
    Members extends object,
    Config,
    App,
    const Reads extends readonly string[],
  >(
    app: RepositoryAppDefinition<
      Dependencies,
      Members,
      Config,
      ModuleRepositories<Live, Memory>,
      App
    > & { readonly reads: Reads },
  ): RepositoryAppBuilder<Name, Live, Memory, Dependencies, Members, Config, App, Reads>;
  withApp<
    Dependencies extends TokenMap,
    Members extends object,
    App,
    const Reads extends readonly string[],
  >(
    app: RepositoryAppDefinitionWithoutConfig<
      Dependencies,
      Members,
      ModuleRepositories<Live, Memory>,
      App
    > & { readonly reads: Reads },
  ): RepositoryUnconfiguredAppBuilder<Name, Live, Memory, Dependencies, Members, App, Reads>;
  withApp<Dependencies extends TokenMap, Members extends object, Config, App>(
    app: RepositoryAppDefinition<
      Dependencies,
      Members,
      Config,
      ModuleRepositories<Live, Memory>,
      App
    >,
  ): RepositoryAppBuilder<Name, Live, Memory, Dependencies, Members, Config, App, readonly []>;
  withApp<Dependencies extends TokenMap, Members extends object = object, App = unknown>(
    app: RepositoryAppDefinitionWithoutConfig<
      Dependencies,
      Members,
      ModuleRepositories<Live, Memory>,
      App
    >,
  ): RepositoryUnconfiguredAppBuilder<Name, Live, Memory, Dependencies, Members, App, readonly []>;
  withApp<
    Dependencies extends TokenMap,
    Members extends object,
    Slice extends ConfigSlice,
    App,
    const Reads extends readonly string[],
  >(
    app: RepositoryDeclaredConfigAppDefinition<
      Dependencies,
      Members,
      Slice,
      ModuleRepositories<Live, Memory>,
      App
    > & { readonly reads: Reads },
  ): RepositoryAppBuilder<Name, Live, Memory, Dependencies, Members, ConfigOf<Slice>, App, Reads>;
  withApp<Dependencies extends TokenMap, Members extends object, Slice extends ConfigSlice, App>(
    app: RepositoryDeclaredConfigAppDefinition<
      Dependencies,
      Members,
      Slice,
      ModuleRepositories<Live, Memory>,
      App
    >,
  ): RepositoryAppBuilder<
    Name,
    Live,
    Memory,
    Dependencies,
    Members,
    ConfigOf<Slice>,
    App,
    readonly []
  >;
  withApp(
    app:
      | RepositoryAppDefinition<
          TokenMap,
          unknown,
          unknown,
          ModuleRepositories<Live, Memory>,
          unknown
        >
      | RepositoryAppDefinitionWithoutConfig<
          TokenMap,
          unknown,
          ModuleRepositories<Live, Memory>,
          unknown
        >,
  ): object {
    // Mirrors the non-repository path: a declared slice is config too, and the
    // one process parse has already produced it (§6).
    if ("config" in app) {
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
  Reads extends readonly string[] = readonly [],
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
    > & { readonly reads?: Reads },
  ) {}

  withTransports<const Transports extends readonly FeatureTransportDescriptor[]>(
    ...transports: Transports
  ): ModuleContributions<
    ReturnType<
      RepositoryAppBuilder<Name, Live, Memory, Dependencies, Members, Config, App, Reads>["build"]
    > & { readonly transports: Transports; readonly namespace: PublicNamespace<Name> },
    ModuleRepositories<Live, Memory>,
    App,
    Dependencies,
    Members
  > {
    return withContributions<
      ReturnType<
        RepositoryAppBuilder<Name, Live, Memory, Dependencies, Members, Config, App, Reads>["build"]
      > & { readonly transports: Transports; readonly namespace: PublicNamespace<Name> },
      ModuleRepositories<Live, Memory>,
      App,
      Dependencies,
      Members
    >({
      declaration: { ...this.build(), transports, namespace: publicNamespace(this.name) },
      workers: [],
      tasks: [],
    });
  }

  /** Background work this module contributes to the worker role. */
  withWorkers(...workers: readonly unknown[]) {
    return withContributions<
      ReturnType<
        RepositoryAppBuilder<Name, Live, Memory, Dependencies, Members, Config, App, Reads>["build"]
      >,
      ModuleRepositories<Live, Memory>,
      App
    >({ declaration: this.build(), workers, tasks: [] });
  }

  /** One-shot work this module contributes to the tasks role. */
  withTasks(...tasks: readonly unknown[]) {
    return withContributions<
      ReturnType<
        RepositoryAppBuilder<Name, Live, Memory, Dependencies, Members, Config, App, Reads>["build"]
      >,
      ModuleRepositories<Live, Memory>,
      App
    >({ declaration: this.build(), workers: [], tasks });
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
  > & {
    readonly repositoryRegistry: RepositoryRegistry<Live, Memory>;
    readonly members: readonly Reads[number][];
  } {
    const app = this.app;
    const registry = this.repositories;
    const name = this.name;
    const setup = serverFeature<Members>(name)
      .withConfigType<Config>()
      .withDependencies(app.dependencies)
      .withSetup(({ dependencies, members, config, secrets, resources, repositories }) => {
        return app.create({
          dependencies,
          members,
          config,
          secrets,
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
      install: async (args) => {
        if (!args.repositorySelection) {
          throw new Error(`Module "${name}" was installed without a repository tier.`);
        }
        const repositories = instantiateRepositories(registry, args.repositorySelection);
        return { ...(await setup.install({ ...args, repositories })), repositories };
      },
      ...declaredOwner(app),
      members: declaredReads(app),
      repositoryRegistry: registry,
      ...(app.contract instanceof ModuleApiToken ? { apiContract: app.contract } : {}),
    };
  }

  /**
   * One of this module's pipelines, declared with `defineEventingModule` and
   * built over the repositories and app above. Call it once per pipeline the
   * module hosts; they register in the order declared.
   */
  withEventing<Definition>(
    eventing: FeatureEventing<ModuleRepositories<Live, Memory>, App, unknown, Definition>,
  ): ModuleContributions<
    ReturnType<
      RepositoryAppBuilder<Name, Live, Memory, Dependencies, Members, Config, App, Reads>["build"]
    >,
    ModuleRepositories<Live, Memory>,
    App
  > {
    return withContributions<
      ReturnType<
        RepositoryAppBuilder<Name, Live, Memory, Dependencies, Members, Config, App, Reads>["build"]
      >,
      ModuleRepositories<Live, Memory>,
      App
    >({ declaration: this.build(), workers: [], tasks: [], eventing: eventing as FeatureEventing });
  }
}

class RepositoryUnconfiguredAppBuilder<
  Name extends ModuleName,
  Live extends AnyProvider,
  Memory extends AnyProvider,
  Dependencies extends TokenMap,
  Members extends object,
  App,
  Reads extends readonly string[] = readonly [],
> extends RepositoryAppBuilder<Name, Live, Memory, Dependencies, Members, undefined, App, Reads> {
  constructor(
    name: Name,
    repositories: RepositoryRegistry<Live, Memory>,
    app: RepositoryAppDefinitionWithoutConfig<
      Dependencies,
      Members,
      ModuleRepositories<Live, Memory>,
      App
    > & { readonly reads?: Reads },
  ) {
    // Named member by member: an app is usually a class, and spreading a class
    // drops its static methods (`create` is not enumerable).
    super(name, repositories, {
      contract: app.contract,
      dependencies: app.dependencies,
      ...(app.reads === undefined ? {} : { reads: app.reads }),
      ...("secrets" in app ? { secrets: app.secrets } : {}),
      create: (setup) => app.create(setup),
    } as RepositoryAppDefinition<
      Dependencies,
      Members,
      undefined,
      ModuleRepositories<Live, Memory>,
      App
    > & { readonly reads?: Reads });
  }
}

class ConfiguredAppBuilder<
  Name extends ModuleName,
  Dependencies extends TokenMap,
  Members,
  Config,
  App,
  Reads extends readonly string[] = readonly [],
> {
  constructor(
    private readonly name: Name,
    private readonly app: AppDefinition<Dependencies, Members, Config, App> & {
      readonly reads?: Reads;
    },
  ) {}

  /**
   * The doors this module declares. Answers a declaration that is already
   * installable, so there is no half-declared module and no build step to
   * forget (ADR-144 s1).
   */
  withTransports<const Transports extends readonly FeatureTransportDescriptor[]>(
    ...transports: Transports
  ): ModuleContributions<
    ReturnType<ConfiguredAppBuilder<Name, Dependencies, Members, Config, App, Reads>["build"]> & {
      readonly transports: Transports;
      readonly namespace: PublicNamespace<Name>;
    },
    unknown,
    App,
    Dependencies,
    Members
  > {
    return withContributions<
      ReturnType<ConfiguredAppBuilder<Name, Dependencies, Members, Config, App, Reads>["build"]> & {
        readonly transports: Transports;
        readonly namespace: PublicNamespace<Name>;
      },
      unknown,
      App,
      Dependencies,
      Members
    >({
      declaration: { ...this.build(), transports, namespace: publicNamespace(this.name) },
      workers: [],
      tasks: [],
    });
  }

  /** Background work this module contributes to the worker role. */
  withWorkers(...workers: readonly unknown[]) {
    return withContributions({ declaration: this.build(), workers, tasks: [] });
  }

  /** One-shot work this module contributes to the tasks role. */
  withTasks(...tasks: readonly unknown[]) {
    return withContributions({ declaration: this.build(), workers: [], tasks });
  }

  /** This module's event sourcing, built over the app above. */
  withEventing<Definition>(eventing: FeatureEventing<undefined, App, unknown, Definition>) {
    return withContributions({
      declaration: this.build(),
      workers: [],
      tasks: [],
      eventing: eventing as FeatureEventing,
    });
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
  > & { readonly members: readonly Reads[number][] } {
    const app = this.app;
    const declaration = serverFeature<Members>(this.name)
      .withConfigType<Config>()
      .withDependencies(app.dependencies)
      .withSetup(({ dependencies, members, config, secrets, resources }) =>
        app.create({
          dependencies,
          members,
          config,
          secrets,
          resources,
        }),
      )
      .provides(app.contract)
      .build();
    return {
      ...declaration,
      name: this.name,
      repositories: snapshotRepositories(app.repositories),
      ...declaredOwner(app),
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
  Reads extends readonly string[] = readonly [],
> {
  constructor(
    private readonly name: Name,
    private readonly app: AppDefinitionWithoutConfig<Dependencies, Members, App> & {
      readonly reads?: Reads;
    },
  ) {}

  /**
   * The doors this module declares. Answers a declaration that is already
   * installable, so there is no half-declared module and no build step to
   * forget (ADR-144 s1).
   */
  withTransports<const Transports extends readonly FeatureTransportDescriptor[]>(
    ...transports: Transports
  ): ModuleContributions<
    ReturnType<UnconfiguredAppBuilder<Name, Dependencies, Members, App, Reads>["build"]> & {
      readonly transports: Transports;
      readonly namespace: PublicNamespace<Name>;
    },
    unknown,
    App,
    Dependencies,
    Members
  > {
    return withContributions<
      ReturnType<UnconfiguredAppBuilder<Name, Dependencies, Members, App, Reads>["build"]> & {
        readonly transports: Transports;
        readonly namespace: PublicNamespace<Name>;
      },
      unknown,
      App,
      Dependencies,
      Members
    >({
      declaration: { ...this.build(), transports, namespace: publicNamespace(this.name) },
      workers: [],
      tasks: [],
    });
  }

  /** Background work this module contributes to the worker role. */
  withWorkers(...workers: readonly unknown[]) {
    return withContributions({ declaration: this.build(), workers, tasks: [] });
  }

  /** One-shot work this module contributes to the tasks role. */
  withTasks(...tasks: readonly unknown[]) {
    return withContributions({ declaration: this.build(), workers: [], tasks });
  }

  /** This module's event sourcing, built over the app above. */
  withEventing<Definition>(eventing: FeatureEventing<undefined, App, unknown, Definition>) {
    return withContributions({
      declaration: this.build(),
      workers: [],
      tasks: [],
      eventing: eventing as FeatureEventing,
    });
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
  > & { readonly members: readonly Reads[number][] } {
    const app = this.app;
    const declaration = serverFeature<Members>(this.name)
      .withConfigType<undefined>()
      .withDependencies(app.dependencies)
      .withSetup(({ dependencies, members, config, secrets, resources }) =>
        app.create({
          dependencies,
          members,
          config,
          secrets,
          resources,
        }),
      )
      .provides(app.contract)
      .build();
    return {
      ...declaration,
      name: this.name,
      repositories: snapshotRepositories(app.repositories),
      ...declaredOwner(app),
      members: declaredReads(app),
      ...(app.contract instanceof ModuleApiToken ? { apiContract: app.contract } : {}),
    };
  }
}

/**
 * Installable declaration accepting further work contributions.
 * Stays installable after any contribution (ADR-144).
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
      bind: ModuleTaskBinder<Dependencies, Members, Repositories, App>,
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
  }>;

/** A built declaration, as the facts wrapper reads the two fields it needs. */
interface InstallableDeclaration {
  readonly dependencies: TokenMap;
  readonly install: (args: FeatureInstallArguments<never>) => Promise<InstalledFeatureState>;
}

/** Bind transport facts at install (API role only). */
function bindingTransportFacts<Declaration extends object>(
  declaration: Declaration,
  bind: ModuleTransportFacts<TokenMap, never, never>,
): Declaration {
  const installable = declaration as Declaration & InstallableDeclaration;

  return {
    ...declaration,
    install: async (args: FeatureInstallArguments<never>): Promise<InstalledFeatureState> => {
      const state = await installable.install(args);
      if (args.role !== "api") return state;

      return {
        ...state,
        facts: bind({
          app: state.provided as never,
          dependencies: resolveTokens(
            installable.dependencies,
            args.resolve,
          ) as ResolvedTokens<TokenMap>,
          members: args.members,
        }),
      };
    },
  };
}

/** Build tasks at install (tasks role only), over the App and repositories just installed. */
function bindingTasks<Declaration extends object>(
  declaration: Declaration,
  bind: ModuleTaskBinder<TokenMap, never, unknown, never>,
): Declaration {
  const installable = declaration as Declaration & InstallableDeclaration;

  return {
    ...declaration,
    install: async (args: FeatureInstallArguments<never>): Promise<InstalledFeatureState> => {
      const state = await installable.install(args);
      if (args.role !== "tasks") return state;

      const built = bind({
        app: state.provided as never,
        repositories: state.repositories,
        dependencies: resolveTokens(
          installable.dependencies,
          args.resolve,
        ) as ResolvedTokens<TokenMap>,
        members: args.members,
      });
      return { ...state, tasks: [...(state.tasks ?? []), ...built] };
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
>({
  declaration,
  workers,
  tasks,
  eventing,
}: {
  declaration: Declaration;
  workers: readonly unknown[];
  tasks: readonly unknown[];
  eventing?: FeatureEventing;
}): ModuleContributions<Declaration, Repositories, App, Dependencies, Members> {
  const contributions = {
    ...declaration,
    workers,
    tasks,
    eventing,
    withWorkers: (...next: readonly unknown[]) =>
      withContributions({ declaration, workers: [...workers, ...next], tasks, eventing }),
    withTasks: (...next: readonly unknown[]) => {
      const [bind] = next;
      if (next.length === 1 && isTaskBinder(bind)) {
        return withContributions({
          declaration: bindingTasks(declaration, bind),
          workers,
          tasks,
          eventing,
        });
      }
      return withContributions({ declaration, workers, tasks: [...tasks, ...next], eventing });
    },
    withTransportFacts: (bind: ModuleTransportFacts<TokenMap, never, never>) =>
      withContributions({
        declaration: bindingTransportFacts(declaration, bind),
        workers,
        tasks,
        eventing,
      }),
    withEventing: (next: FeatureEventing) =>
      withContributions({
        declaration,
        workers,
        tasks,
        eventing: withAnotherPipeline(eventing, next),
      }),
  } as ModuleContributions<Declaration, Repositories, App, Dependencies, Members>;

  return contributions;
}

function isTaskBinder(value: unknown): value is ModuleTaskBinder<TokenMap, never, unknown, never> {
  return typeof value === "function";
}

/**
 * What a module is handed where the process composed no chain. Declaring costs
 * nothing, so this only ever fires on an actual resolve, naming both.
 */
function undeclaredSecrets(feature: string): ScopedSecrets {
  return new ScopedSecrets((handle) => {
    throw new FeatureSecretsUnavailableError(feature, handle.id);
  });
}

/**
 * The one process parse (§6) already produced this feature's slice, so the
 * declaration only gives it a type. This is the single boundary where the
 * parsed value stops being `unknown`; there is no second schema.
 */
function declaredConfig<Config>(value: unknown): Config {
  return value as Config;
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

function declaredOwner(app: object): {
  config?: ConfigSlice;
  secrets?: Readonly<Record<string, SecretHandle<unknown>>>;
  publicConfig?: (config: unknown) => unknown;
} {
  const owner = app as {
    config?: ConfigSlice;
    secrets?: Readonly<Record<string, SecretHandle<unknown>>>;
    publicConfig?: (config: unknown) => unknown;
  };
  return { config: owner.config, secrets: owner.secrets, publicConfig: owner.publicConfig };
}
