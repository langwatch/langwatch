import { snapshotRepositories, type FeatureRepositories } from "./repository-ownership.ts";
/** One feature installer. A feature declares its config, the contract services */
import type {
  DependencyToken,
  ResolvedTokens,
  TokenIdentity,
  TokenMap,
} from "./dependency-token.ts";
import type { ModuleName, PublicNamespace } from "./module-namespace.ts";
import type { NeedsResult } from "./infrastructure-needs.ts";
import { publicNamespace, publicNamespaceFromUnknown } from "./module-namespace.ts";
import type { ResourceOwnership } from "./resource-scope.ts";
import { FeatureConfigError } from "./boot-errors.ts";
import { ModuleApiToken, type FeatureApiIdentity } from "./module-api-token.ts";
import {
  instantiateRepositories,
  type RepositoriesFor,
  type RepositoryRegistry,
} from "./repository-registry.ts";

/** Which process is booting. A role hosts only the work that role owns. */
export type ServerRole = "api" | "worker" | "tasks";

/** As much of Zod as a feature's config needs, so this package depends on none. */
export interface FeatureConfigSchema<Config> {
  parse(value: unknown): Config;
}

/** The complete context supplied to a server app's static factory. */
export type FeatureSetup<
  Dependencies extends TokenMap,
  Infrastructure,
  Config,
  Repositories = never,
> = Readonly<{
  readonly dependencies: ResolvedTokens<Dependencies>;
  readonly config: Config;
  readonly resources: ResourceOwnership;
}> &
  ([Infrastructure] extends [never]
    ? object
    : Readonly<{ readonly infrastructure: Infrastructure }>) &
  ([Repositories] extends [never] ? object : Readonly<{ readonly repositories: Repositories }>);

type AppContract<Dependencies extends TokenMap, App> =
  | Readonly<{
      contract: ModuleApiToken<App>;
      dependencies: Dependencies & Readonly<Record<string, FeatureApiIdentity>>;
    }>
  | Readonly<{ contract: abstract new (...args: never[]) => App; dependencies: Dependencies }>;

/** Static construction metadata owned by a server app implementation. */
export type AppDefinition<Dependencies extends TokenMap, Infrastructure, Config, App> = AppContract<
  Dependencies,
  App
> &
  Readonly<{
    readonly configSchema: FeatureConfigSchema<Config>;
    readonly repositories?: FeatureRepositories;
    readonly create: (
      setup: FeatureSetup<NoInfer<Dependencies>, Infrastructure, NoInfer<Config>>,
    ) => NoInfer<App>;
  }>;

/** Static construction metadata for an app with no semantic configuration. */
export type AppDefinitionWithoutConfig<
  Dependencies extends TokenMap,
  Infrastructure,
  App,
> = AppContract<Dependencies, App> &
  Readonly<{
    readonly repositories?: FeatureRepositories;
    readonly create: (
      setup: FeatureSetup<NoInfer<Dependencies>, Infrastructure, undefined>,
    ) => NoInfer<App>;
  }>;

/** An inert API descriptor retained for the process root to mount later. */
export type FeatureTransportDescriptor = Readonly<{
  readonly protocol: "rest" | "trpc";
  /** The family's path segment, or the tRPC namespace the record keys it by. */
  readonly namespace?: string;
  readonly router: (...args: never[]) => object;
}>;

/** What a setup is handed, once per process. */
export interface FeatureSetupArguments<Config, Infrastructure, Dependencies> {
  readonly resources: ResourceOwnership;
  readonly config: Config;
  readonly infrastructure: Infrastructure;
  readonly dependencies: Dependencies;
  readonly persistence?: FeatureInstallArguments<Infrastructure>["persistence"];
}

/** What the one transport assembly is handed, in a role that serves doors. */
export interface FeatureTransportSetupArguments<
  Config,
  Infrastructure,
  Dependencies,
  TransportDependencies,
  Provided,
> extends FeatureSetupArguments<Config, Infrastructure, Dependencies> {
  /** The tokens this feature needs only where it serves a transport. */
  readonly transportDependencies: TransportDependencies;
  /** Whatever the setup returned. */
  readonly provided: Provided;
}

/** What a door's contribution is handed, after the transport assembly ran. */
export interface FeatureTransportArguments<
  Config,
  Infrastructure,
  Dependencies,
  TransportDependencies,
  Provided,
  Transport,
> extends FeatureTransportSetupArguments<
  Config,
  Infrastructure,
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
  Infrastructure,
  Dependencies,
  Provided,
> extends FeatureSetupArguments<Config, Infrastructure, Dependencies> {
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
  /** Bound contribution readers; absent where the feature declared none. */
  readonly rest: (() => unknown) | undefined;
  readonly trpc: (() => unknown) | undefined;
  readonly worker: (() => unknown) | undefined;
}

/** What `install` is handed by the application root. */
export interface FeatureInstallArguments<Infrastructure> {
  readonly resources: ResourceOwnership;
  readonly config: unknown;
  readonly infrastructure: Infrastructure;
  /** The process-selected repository backend, present only for repository-aware features. */
  readonly persistence?: Readonly<{
    backend: string;
    infrastructure: Readonly<Record<string, unknown>>;
  }>;
  readonly role: ServerRole;
  /** The instance the graph resolved for one token. */
  resolve(token: TokenIdentity): unknown;
}

/**
 * A declaration as the application root holds it: every type parameter but the
 * infrastructure erased, because the root installs features it knows nothing
 * else about.
 */
export interface InstallableServerFeature<Infrastructure> {
  readonly name: string;
  /** Every door this feature declared, for the process root to mount at boot. */
  readonly transports?: readonly FeatureTransportDescriptor[];
  readonly repositories?: FeatureRepositories;
  readonly repositoryRegistry?: RepositoryRegistry<
    Record<
      string,
      Readonly<{ requires: readonly string[]; create: (...arguments_: never[]) => unknown }>
    >
  >;
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
   * The pool members this module named with `needs`. Types erase, so this is
   * what boot reads to refuse a process whose pool supplies one as undefined.
   */
  readonly requiredInfrastructure?: readonly string[];
  readonly install: (args: FeatureInstallArguments<Infrastructure>) => InstalledFeatureState;
}

/** A built declaration, with the types its own call sites read back. */
export interface ServerFeatureDeclaration<
  Config,
  Infrastructure,
  Dependencies extends TokenMap,
  TransportDependencies extends TokenMap,
  Provided,
  Transport,
  Rest,
  Trpc,
  Worker,
> extends InstallableServerFeature<Infrastructure> {
  /** Present only so the declaration's types are reachable from a runtime read. */
  readonly reads: {
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
> {
  readonly name: string;
  readonly configSchema: FeatureConfigSchema<Config> | undefined;
  readonly dependencies: Dependencies;
  readonly transportDependencies: TransportDependencies;
}

/**
 * The first stage: everything a feature states before it says how it is built.
 * Nothing here depends on anything else here, which is why one class can carry
 * all of it without an assertion when a type parameter changes.
 */
export class ServerFeatureBuilder<
  Config,
  Infrastructure,
  Dependencies extends TokenMap,
  TransportDependencies extends TokenMap,
> {
  constructor(private readonly shape: FeatureShape<Config, Dependencies, TransportDependencies>) {}

  /** The typed config slice `boot({ config })` must carry for this feature. */
  withConfig<NextConfig>(
    schema: FeatureConfigSchema<NextConfig>,
  ): ServerFeatureBuilder<NextConfig, Infrastructure, Dependencies, TransportDependencies> {
    return new ServerFeatureBuilder({ ...this.shape, configSchema: schema });
  }

  /** The contract services this feature needs in EVERY role it is installed in. */
  withDependencies<NextDependencies extends TokenMap>(
    dependencies: NextDependencies,
  ): ServerFeatureBuilder<Config, Infrastructure, NextDependencies, TransportDependencies> {
    return new ServerFeatureBuilder({ ...this.shape, dependencies });
  }

  /** The tokens this feature needs only where it serves a transport. They are */
  withTransportDependencies<NextTransportDependencies extends TokenMap>(
    transportDependencies: NextTransportDependencies,
  ): ServerFeatureBuilder<Config, Infrastructure, Dependencies, NextTransportDependencies> {
    return new ServerFeatureBuilder({ ...this.shape, transportDependencies });
  }

  /** Ordinary code, run once per process, that constructs what this feature owns. */
  withSetup<Provided>(
    setup: (
      args: FeatureSetupArguments<Config, Infrastructure, ResolvedTokens<Dependencies>>,
    ) => Provided,
  ): ServerFeatureAssembly<
    Config,
    Infrastructure,
    Dependencies,
    TransportDependencies,
    Provided,
    undefined,
    undefined,
    undefined,
    undefined
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
    });
  }
}

/** What the assembly stage accumulates once a setup exists. */
interface FeatureAssemblyState<
  Config,
  Infrastructure,
  Dependencies extends TokenMap,
  TransportDependencies extends TokenMap,
  Provided,
  Transport,
  Rest,
  Trpc,
  Worker,
> extends FeatureShape<Config, Dependencies, TransportDependencies> {
  readonly setup: (
    args: FeatureSetupArguments<Config, Infrastructure, ResolvedTokens<Dependencies>>,
  ) => Provided;
  readonly providers: readonly FeatureProvider<Provided>[];
  readonly transport:
    | ((
        args: FeatureTransportSetupArguments<
          Config,
          Infrastructure,
          ResolvedTokens<Dependencies>,
          ResolvedTokens<TransportDependencies>,
          Provided
        >,
      ) => Transport)
    | undefined;
  readonly rest: DoorContribution<
    Config,
    Infrastructure,
    Dependencies,
    TransportDependencies,
    Provided,
    Transport,
    Rest
  >;
  readonly trpc: DoorContribution<
    Config,
    Infrastructure,
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
          Infrastructure,
          ResolvedTokens<Dependencies>,
          Provided
        >,
      ) => Worker)
    | undefined;
  readonly close: ((provided: Provided) => void | Promise<void>) | undefined;
}

/** One door's contribution, or nothing where the feature declared no such door. */
type DoorContribution<
  Config,
  Infrastructure,
  Dependencies extends TokenMap,
  TransportDependencies extends TokenMap,
  Provided,
  Transport,
  Result,
> =
  | ((
      args: FeatureTransportArguments<
        Config,
        Infrastructure,
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
  Infrastructure,
  Dependencies extends TokenMap,
  TransportDependencies extends TokenMap,
  Provided,
  Transport,
  Rest,
  Trpc,
  Worker,
> {
  constructor(
    private readonly state: FeatureAssemblyState<
      Config,
      Infrastructure,
      Dependencies,
      TransportDependencies,
      Provided,
      Transport,
      Rest,
      Trpc,
      Worker
    >,
  ) {}

  /** Publishes the setup result as the feature’s single public app contract. */
  provides<Instance>(
    token: DependencyToken<Instance> & ([Provided] extends [Instance] ? unknown : never),
  ): ServerFeatureAssembly<
    Config,
    Infrastructure,
    Dependencies,
    TransportDependencies,
    Provided,
    Transport,
    Rest,
    Trpc,
    Worker
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
        Infrastructure,
        ResolvedTokens<Dependencies>,
        ResolvedTokens<TransportDependencies>,
        Provided
      >,
    ) => NextTransport,
  ): ServerFeatureAssembly<
    Config,
    Infrastructure,
    Dependencies,
    TransportDependencies,
    Provided,
    NextTransport,
    undefined,
    undefined,
    Worker
  > {
    return new ServerFeatureAssembly({
      ...this.state,
      transport: create,
      rest: undefined,
      trpc: undefined,
    });
  }

  /** What this feature contributes to the process's REST surface. */
  withRest<NextRest>(
    create: (
      args: FeatureTransportArguments<
        Config,
        Infrastructure,
        ResolvedTokens<Dependencies>,
        ResolvedTokens<TransportDependencies>,
        Provided,
        Transport
      >,
    ) => NextRest,
  ): ServerFeatureAssembly<
    Config,
    Infrastructure,
    Dependencies,
    TransportDependencies,
    Provided,
    Transport,
    NextRest,
    Trpc,
    Worker
  > {
    return new ServerFeatureAssembly({ ...this.state, rest: create });
  }

  /** What this feature contributes to the process's tRPC surface. */
  withTrpc<NextTrpc>(
    create: (
      args: FeatureTransportArguments<
        Config,
        Infrastructure,
        ResolvedTokens<Dependencies>,
        ResolvedTokens<TransportDependencies>,
        Provided,
        Transport
      >,
    ) => NextTrpc,
  ): ServerFeatureAssembly<
    Config,
    Infrastructure,
    Dependencies,
    TransportDependencies,
    Provided,
    Transport,
    Rest,
    NextTrpc,
    Worker
  > {
    return new ServerFeatureAssembly({ ...this.state, trpc: create });
  }

  /** The consumers and schedulers this feature contributes to a worker. */
  withWorker<NextWorker>(
    create: (
      args: FeatureWorkerArguments<Config, Infrastructure, ResolvedTokens<Dependencies>, Provided>,
    ) => NextWorker,
  ): ServerFeatureAssembly<
    Config,
    Infrastructure,
    Dependencies,
    TransportDependencies,
    Provided,
    Transport,
    Rest,
    Trpc,
    NextWorker
  > {
    return new ServerFeatureAssembly({ ...this.state, worker: create });
  }

  /** Releases what the setup acquired. Runs in reverse construction order. */
  withClose(
    close: (provided: Provided) => void | Promise<void>,
  ): ServerFeatureAssembly<
    Config,
    Infrastructure,
    Dependencies,
    TransportDependencies,
    Provided,
    Transport,
    Rest,
    Trpc,
    Worker
  > {
    return new ServerFeatureAssembly({ ...this.state, close });
  }

  /** The immutable declaration. Building it constructs nothing. */
  build(): ServerFeatureDeclaration<
    Config,
    Infrastructure,
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
      reads: undefined as never,

      install: (args: FeatureInstallArguments<Infrastructure>): InstalledFeatureState => {
        const config = parseFeatureConfig(state.name, state.configSchema, args.config);
        const dependencies = resolveTokens(
          state.dependencies,
          args.resolve,
        ) as ResolvedTokens<Dependencies>;
        const setupArguments = {
          config,
          infrastructure: args.infrastructure,
          dependencies,
          resources: args.resources,
          persistence: args.persistence,
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
            : { rest: void 0, trpc: void 0 };
        return {
          provided,
          rest: doors.rest,
          trpc: doors.trpc,
          worker: args.role === "worker" && worker ? () => workerResult : undefined,
        };
      },
    };
    return Object.freeze(declaration);
  }

  private bindTransports(
    setupArguments: FeatureSetupArguments<Config, Infrastructure, ResolvedTokens<Dependencies>>,
    provided: Provided,
    args: FeatureInstallArguments<Infrastructure>,
  ): { rest: (() => unknown) | undefined; trpc: (() => unknown) | undefined } {
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
    };
  }
}

/**
 * Names one feature installer. The infrastructure type is stated here because
 * it is what the application root must be able to supply, and stating it at the
 * end would let a feature declare a need no root could see.
 */
export function serverFeature<Infrastructure>(
  name: string,
): ServerFeatureBuilder<undefined, Infrastructure, Record<never, never>, Record<never, never>> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("A feature installer needs a name.");
  return new ServerFeatureBuilder({
    name: trimmed,
    configSchema: undefined,
    dependencies: {},
    transportDependencies: {},
  });
}

/** Names a feature whose App owns its factory and peer API declarations. */
export function defineModule<const Name extends ModuleName>(
  name: Name,
): DefinedFeatureBuilder<Name> {
  publicNamespaceFromUnknown(name);
  return new DefinedFeatureBuilder(name);
}

/**
 * Names a module's server half. The canonical name for `defineModule`, which
 * keeps answering until every module is repointed at this one.
 */
export function defineServerModule<const Name extends ModuleName>(
  name: Name,
): DefinedFeatureBuilder<Name> {
  publicNamespaceFromUnknown(name);
  return new DefinedFeatureBuilder(name);
}

class DefinedFeatureBuilder<Name extends ModuleName> {
  constructor(
    private readonly name: Name,
    private readonly declaredNeeds: readonly string[] = [],
  ) {}

  /**
   * The pool members this module reads, named. The interface is explicit and
   * the tuple infers, so an incomplete tuple resolves to a type that names
   * what is missing and carries no further builder methods.
   */
  needs<Infrastructure extends object>() {
    return <const Members extends readonly (keyof Infrastructure & string)[]>(
      ...members: Members
    ): NeedsResult<Infrastructure, Members, DefinedFeatureBuilder<Name>> =>
      new DefinedFeatureBuilder(this.name, members) as NeedsResult<
        Infrastructure,
        Members,
        DefinedFeatureBuilder<Name>
      >;
  }

  withRepositories<
    Definitions extends Record<
      string,
      Readonly<{ requires: readonly string[]; create: (...arguments_: never[]) => unknown }>
    >,
  >(
    repositories: RepositoryRegistry<Definitions>,
  ): RepositoryDefinedFeatureBuilder<Name, Definitions> {
    return new RepositoryDefinedFeatureBuilder(this.name, repositories, this.declaredNeeds);
  }

  withApp<Dependencies extends TokenMap, Infrastructure, Config, App>(
    app: AppDefinition<Dependencies, Infrastructure, Config, App>,
  ): ConfiguredAppBuilder<Name, Dependencies, Infrastructure, Config, App>;
  withApp<Dependencies extends TokenMap, Infrastructure, App>(
    app: AppDefinitionWithoutConfig<Dependencies, Infrastructure, App>,
  ): UnconfiguredAppBuilder<Name, Dependencies, Infrastructure, App>;
  withApp(
    app:
      | AppDefinition<TokenMap, unknown, unknown, unknown>
      | AppDefinitionWithoutConfig<TokenMap, unknown, unknown>,
  ):
    | ConfiguredAppBuilder<Name, TokenMap, unknown, unknown, unknown>
    | UnconfiguredAppBuilder<Name, TokenMap, unknown, unknown> {
    if ("configSchema" in app) {
      return new ConfiguredAppBuilder(this.name, app, this.declaredNeeds);
    }
    return new UnconfiguredAppBuilder(this.name, app, this.declaredNeeds);
  }
}

type RepositoryAppDefinition<
  Dependencies extends TokenMap,
  Infrastructure,
  Config,
  Repositories,
  App,
> = AppContract<Dependencies, App> &
  Readonly<{
    readonly configSchema: FeatureConfigSchema<Config>;
    readonly create: (
      setup: FeatureSetup<NoInfer<Dependencies>, never, NoInfer<Config>, Repositories> &
        Readonly<{ infrastructure: Infrastructure }>,
    ) => NoInfer<App>;
  }>;

type RepositoryAppDefinitionWithoutConfig<
  Dependencies extends TokenMap,
  Infrastructure,
  Repositories,
  App,
> = AppContract<Dependencies, App> &
  Readonly<{
    readonly create: (
      setup: FeatureSetup<NoInfer<Dependencies>, never, undefined, Repositories> &
        Readonly<{ infrastructure: Infrastructure }>,
    ) => NoInfer<App>;
  }>;

class RepositoryDefinedFeatureBuilder<
  Name extends ModuleName,
  Definitions extends Record<
    string,
    Readonly<{ requires: readonly string[]; create: (...arguments_: never[]) => unknown }>
  >,
> {
  constructor(
    private readonly name: Name,
    private readonly repositories: RepositoryRegistry<Definitions>,
    private readonly needs: readonly string[] = [],
  ) {}

  withApp<Dependencies extends TokenMap, Infrastructure extends object, Config, App>(
    app: RepositoryAppDefinition<
      Dependencies,
      Infrastructure,
      Config,
      RepositoriesFor<RepositoryRegistry<Definitions>, keyof Definitions>,
      App
    >,
  ): RepositoryAppBuilder<Name, Definitions, Dependencies, Infrastructure, Config, App>;
  withApp<Dependencies extends TokenMap, Infrastructure extends object = object, App = unknown>(
    app: RepositoryAppDefinitionWithoutConfig<
      Dependencies,
      Infrastructure,
      RepositoriesFor<RepositoryRegistry<Definitions>, keyof Definitions>,
      App
    >,
  ): RepositoryUnconfiguredAppBuilder<Name, Definitions, Dependencies, Infrastructure, App>;
  withApp<Dependencies extends TokenMap, Infrastructure extends object, Config, App>(
    app:
      | RepositoryAppDefinition<
          Dependencies,
          Infrastructure,
          Config,
          RepositoriesFor<RepositoryRegistry<Definitions>, keyof Definitions>,
          App
        >
      | RepositoryAppDefinitionWithoutConfig<
          Dependencies,
          Infrastructure,
          RepositoriesFor<RepositoryRegistry<Definitions>, keyof Definitions>,
          App
        >,
  ) {
    if ("configSchema" in app) {
      return new RepositoryAppBuilder(this.name, this.repositories, app, this.needs);
    }
    return new RepositoryUnconfiguredAppBuilder(this.name, this.repositories, app, this.needs);
  }
}

class RepositoryAppBuilder<
  Name extends ModuleName,
  Definitions extends Record<
    string,
    Readonly<{ requires: readonly string[]; create: (...arguments_: never[]) => unknown }>
  >,
  Dependencies extends TokenMap,
  Infrastructure,
  Config,
  App,
> {
  constructor(
    private readonly name: Name,
    private readonly repositories: RepositoryRegistry<Definitions>,
    private readonly app: RepositoryAppDefinition<
      Dependencies,
      Infrastructure,
      Config,
      RepositoriesFor<RepositoryRegistry<Definitions>, keyof Definitions>,
      App
    >,
    protected readonly needs: readonly string[] = [],
  ) {}

  withTransports<const Transports extends readonly FeatureTransportDescriptor[]>(
    ...transports: Transports
  ): ModuleContributions<
    ReturnType<
      RepositoryAppBuilder<Name, Definitions, Dependencies, Infrastructure, Config, App>["build"]
    > & { readonly transports: Transports; readonly namespace: PublicNamespace<Name> }
  > {
    return withContributions(
      { ...this.build(), transports, namespace: publicNamespace(this.name) },
      [],
      [],
    );
  }

  /** Background work this module contributes to the worker role. */
  withWorkers(...workers: readonly unknown[]) {
    return withContributions(this.build(), workers, []);
  }

  /** One-shot work this module contributes to the tasks role. */
  withTasks(...tasks: readonly unknown[]) {
    return withContributions(this.build(), [], tasks);
  }

  build(): ServerFeatureDeclaration<
    Config,
    Infrastructure,
    Dependencies,
    Record<never, never>,
    App,
    undefined,
    undefined,
    undefined,
    undefined
  > {
    const app = this.app;
    const registry = this.repositories;
    const setup = serverFeature<Infrastructure>(this.name)
      .withConfig(app.configSchema)
      .withDependencies(app.dependencies)
      .withSetup(({ dependencies, infrastructure, config, resources, persistence }) => {
        if (!persistence) {
          throw new Error(`Feature "${this.name}" requires process persistence.`);
        }
        const repositories = instantiateRepositories(registry, persistence);
        return app.create({ dependencies, infrastructure, config, resources, repositories });
      })
      .provides(app.contract)
      .build();
    return {
      ...setup,
      requiredInfrastructure: this.needs,
      repositoryRegistry: registry,
      ...(app.contract instanceof ModuleApiToken ? { apiContract: app.contract } : {}),
    };
  }
}

class RepositoryUnconfiguredAppBuilder<
  Name extends ModuleName,
  Definitions extends Record<
    string,
    Readonly<{ requires: readonly string[]; create: (...arguments_: never[]) => unknown }>
  >,
  Dependencies extends TokenMap,
  Infrastructure extends object,
  App,
> extends RepositoryAppBuilder<Name, Definitions, Dependencies, Infrastructure, undefined, App> {
  constructor(
    name: Name,
    repositories: RepositoryRegistry<Definitions>,
    app: RepositoryAppDefinitionWithoutConfig<
      Dependencies,
      Infrastructure,
      RepositoriesFor<RepositoryRegistry<Definitions>, keyof Definitions>,
      App
    >,
    needs: readonly string[] = [],
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
        create: (setup) => app.create(setup),
      } as RepositoryAppDefinition<
        Dependencies,
        Infrastructure,
        undefined,
        RepositoriesFor<RepositoryRegistry<Definitions>, keyof Definitions>,
        App
      >,
      needs,
    );
  }
}

class ConfiguredAppBuilder<
  Name extends ModuleName,
  Dependencies extends TokenMap,
  Infrastructure,
  Config,
  App,
> {
  constructor(
    private readonly name: Name,
    private readonly app: AppDefinition<Dependencies, Infrastructure, Config, App>,
    private readonly needs: readonly string[] = [],
  ) {}

  withTransports<const Transports extends readonly FeatureTransportDescriptor[]>(
    ...transports: Transports
  ): ConfiguredAppWithTransportsBuilder<
    Name,
    Dependencies,
    Infrastructure,
    Config,
    App,
    Transports
  > {
    return new ConfiguredAppWithTransportsBuilder(this.name, this.app, transports, this.needs);
  }

  /** Background work this module contributes to the worker role. */
  withWorkers(...workers: readonly unknown[]) {
    return withContributions(this.build(), workers, []);
  }

  /** One-shot work this module contributes to the tasks role. */
  withTasks(...tasks: readonly unknown[]) {
    return withContributions(this.build(), [], tasks);
  }

  build(): ServerFeatureDeclaration<
    Config,
    Infrastructure,
    Dependencies,
    Record<never, never>,
    App,
    undefined,
    undefined,
    undefined,
    undefined
  > {
    const app = this.app;
    const declaration = serverFeature<Infrastructure>(this.name)
      .withConfig(app.configSchema)
      .withDependencies(app.dependencies)
      .withSetup(({ dependencies, infrastructure, config, resources }) =>
        app.create({
          dependencies,
          infrastructure,
          config,
          resources,
        }),
      )
      .provides(app.contract)
      .build();
    return {
      ...declaration,
      repositories: snapshotRepositories(app.repositories),
      requiredInfrastructure: this.needs,
      ...(app.contract instanceof ModuleApiToken ? { apiContract: app.contract } : {}),
    };
  }
}

class UnconfiguredAppBuilder<
  Name extends ModuleName,
  Dependencies extends TokenMap,
  Infrastructure,
  App,
> {
  constructor(
    private readonly name: Name,
    private readonly app: AppDefinitionWithoutConfig<Dependencies, Infrastructure, App>,
    private readonly needs: readonly string[] = [],
  ) {}

  withTransports<const Transports extends readonly FeatureTransportDescriptor[]>(
    ...transports: Transports
  ): UnconfiguredAppWithTransportsBuilder<Name, Dependencies, Infrastructure, App, Transports> {
    return new UnconfiguredAppWithTransportsBuilder(this.name, this.app, transports, this.needs);
  }

  /** Background work this module contributes to the worker role. */
  withWorkers(...workers: readonly unknown[]) {
    return withContributions(this.build(), workers, []);
  }

  /** One-shot work this module contributes to the tasks role. */
  withTasks(...tasks: readonly unknown[]) {
    return withContributions(this.build(), [], tasks);
  }

  build(): ServerFeatureDeclaration<
    undefined,
    Infrastructure,
    Dependencies,
    Record<never, never>,
    App,
    undefined,
    undefined,
    undefined,
    undefined
  > {
    const app = this.app;
    const declaration = serverFeature<Infrastructure>(this.name)
      .withConfig({ parse: () => void 0 })
      .withDependencies(app.dependencies)
      .withSetup(({ dependencies, infrastructure, config, resources }) =>
        app.create({
          dependencies,
          infrastructure,
          config,
          resources,
        }),
      )
      .provides(app.contract)
      .build();
    return {
      ...declaration,
      repositories: snapshotRepositories(app.repositories),
      requiredInfrastructure: this.needs,
      ...(app.contract instanceof ModuleApiToken ? { apiContract: app.contract } : {}),
    };
  }
}

class ConfiguredAppWithTransportsBuilder<
  Name extends ModuleName,
  Dependencies extends TokenMap,
  Infrastructure,
  Config,
  App,
  Transports extends readonly FeatureTransportDescriptor[],
> {
  constructor(
    private readonly name: Name,
    private readonly app: AppDefinition<Dependencies, Infrastructure, Config, App>,
    private readonly transports: Transports,
    private readonly needs: readonly string[] = [],
  ) {}

  /** Background work this module contributes to the worker role. */
  withWorkers(...workers: readonly unknown[]) {
    return withContributions(this.build(), workers, []);
  }

  /** One-shot work this module contributes to the tasks role. */
  withTasks(...tasks: readonly unknown[]) {
    return withContributions(this.build(), [], tasks);
  }

  build(): ServerFeatureDeclaration<
    Config,
    Infrastructure,
    Dependencies,
    Record<never, never>,
    App,
    undefined,
    undefined,
    undefined,
    undefined
  > & { readonly transports: Transports; readonly namespace: PublicNamespace<Name> } {
    const declaration = new ConfiguredAppBuilder(this.name, this.app, this.needs).build();
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
  Infrastructure,
  App,
  Transports extends readonly FeatureTransportDescriptor[],
> {
  constructor(
    private readonly name: Name,
    private readonly app: AppDefinitionWithoutConfig<Dependencies, Infrastructure, App>,
    private readonly transports: Transports,
    private readonly needs: readonly string[] = [],
  ) {}

  /** Background work this module contributes to the worker role. */
  withWorkers(...workers: readonly unknown[]) {
    return withContributions(this.build(), workers, []);
  }

  /** One-shot work this module contributes to the tasks role. */
  withTasks(...tasks: readonly unknown[]) {
    return withContributions(this.build(), [], tasks);
  }

  build(): ServerFeatureDeclaration<
    undefined,
    Infrastructure,
    Dependencies,
    Record<never, never>,
    App,
    undefined,
    undefined,
    undefined,
    undefined
  > & { readonly transports: Transports; readonly namespace: PublicNamespace<Name> } {
    const declaration = new UnconfiguredAppBuilder(this.name, this.app, this.needs).build();
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
export type ModuleContributions<Declaration> = Declaration &
  Readonly<{
    readonly workers: readonly unknown[];
    readonly tasks: readonly unknown[];
    withWorkers(...workers: readonly unknown[]): ModuleContributions<Declaration>;
    withTasks(...tasks: readonly unknown[]): ModuleContributions<Declaration>;
    build(): Declaration & Readonly<{ workers: readonly unknown[]; tasks: readonly unknown[] }>;
  }>;

/** Adds the worker and task halves to a built declaration. */
function withContributions<Declaration extends object>(
  declaration: Declaration,
  workers: readonly unknown[],
  tasks: readonly unknown[],
): ModuleContributions<Declaration> {
  const contributed = { ...declaration, workers, tasks };
  return {
    ...contributed,
    withWorkers: (...next: readonly unknown[]) =>
      withContributions(declaration, [...workers, ...next], tasks),
    withTasks: (...next: readonly unknown[]) =>
      withContributions(declaration, workers, [...tasks, ...next]),
    build: () => contributed,
  } as ModuleContributions<Declaration>;
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
