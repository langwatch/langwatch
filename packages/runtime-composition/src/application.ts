import {
  assertRepositoryOwnership,
  snapshotRepositories,
  type FeatureRepositories,
} from "./repository-ownership.ts";
/** Declares, constructs and starts the process graph; see ADR-133. */
import {
  type DependencyToken,
  type TokenIdentity,
  type TokenMap,
  tokenName,
} from "./dependency-token.ts";
import {
  DependencyCycleError,
  DuplicateFeatureError,
  DuplicateProviderError,
  MissingProviderError,
  RoleContributionError,
} from "./boot-errors.ts";
import type {
  FeatureTransportDescriptor,
  InstallableServerFeature,
  InstalledFeatureState,
  FeatureInstallArguments,
  FeatureProvider,
  ServerFeatureDeclaration,
  ServerRole,
} from "./feature-installer.ts";
import {
  mountDeclaredTransports,
  type DeclaredTransports,
  type FeatureTransportHosts,
  type MountedTransports,
} from "./transport-mounting.ts";
import { assertInfrastructure } from "./infrastructure-needs.ts";
import { ResourceScope } from "./resource-scope.ts";
import { RuntimeLifecycle, cleanupAfterFailure, type RuntimeService } from "./runtime-lifecycle.ts";
import { ModuleApiToken, type FeatureApiIdentity } from "./module-api-token.ts";
import { LocalFeatureApis } from "./local-feature-api.ts";
import {
  selectedRepositoryOwnership,
  validateRepositorySelection,
  type RepositoryRegistry,
} from "./repository-registry.ts";
export type { RuntimeService } from "./runtime-lifecycle.ts";

/** What a booted runtime hands back for one feature. */
export interface InstalledFeature<Provided, Rest, Trpc, Worker> {
  /** Whatever that feature's setup constructed. Both doors read this one. */
  readonly provided: Provided;
  /** The feature's REST contribution, throws when unavailable in this role. */
  rest(): Rest;
  /** The feature's tRPC contribution, throws when unavailable in this role. */
  trpc(): Trpc;
  /** The feature's background contribution, throws when unavailable in this role. */
  worker(): Worker;
}

/** A booted application: everything constructed, nothing serving yet. */
export class BootedRuntime<Infrastructure, Rest = never, Trpc = never> {
  private readonly lifecycle: RuntimeLifecycle;
  constructor(
    readonly name: string,
    readonly role: ServerRole,
    readonly infrastructure: Infrastructure,
    /**
     * Every declared transport this process mounted, in install order for REST
     * and by namespace for tRPC. Empty where the application was given no door.
     */
    readonly transports: MountedTransports<Rest, Trpc>,
    private readonly installed: ReadonlyMap<string, InstalledFeatureState>,
    private readonly provided: ReadonlyMap<TokenIdentity, unknown>,
    /**
     * The background work this role owns: everything the installed modules
     * declared with `withWorkers` under the worker role, and with `withTasks`
     * under the tasks role. Every other role reads an empty list.
     */
    readonly contributions: readonly unknown[],
    scope: ResourceScope,
    services: readonly RuntimeService[],
  ) {
    this.lifecycle = new RuntimeLifecycle(services, scope);
  }

  /**
   * One installed module, typed by its own declaration. The stored state is
   * erased — the root installs modules it knows nothing else about — so the
   * declaration's own types are what name it again here.
   */
  module<
    Config,
    Dependencies extends TokenMap,
    TransportDependencies extends TokenMap,
    Provided,
    Transport,
    Rest,
    Trpc,
    Worker,
    FeatureInfrastructure,
  >(
    declaration: ServerFeatureDeclaration<
      Config,
      FeatureInfrastructure,
      Dependencies,
      TransportDependencies,
      Provided,
      Transport,
      Rest,
      Trpc,
      Worker
    >,
  ): InstalledFeature<Provided, Rest, Trpc, Worker> {
    const state = this.installed.get(declaration.name);
    if (!state) {
      throw new Error(`Feature "${declaration.name}" is not installed on ${this.name}.`);
    }
    return {
      provided: state.provided as Provided,
      rest: (state.rest ?? unavailable(declaration.name, this.role, "REST")) as () => Rest,
      trpc: (state.trpc ?? unavailable(declaration.name, this.role, "tRPC")) as () => Trpc,
      worker: (state.worker ?? unavailable(declaration.name, this.role, "worker")) as () => Worker,
    };
  }

  /**
   * The instance behind one token, for code that has not been converted yet
   * and holds no declaration to read it from.
   */
  service<Instance>(token: DependencyToken<Instance>): Instance {
    if (!this.provided.has(token)) {
      throw new Error(`Nothing on ${this.name} provides ${tokenName(token)}.`);
    }
    return this.provided.get(token) as Instance;
  }

  start(): Promise<void> {
    return this.lifecycle.start();
  }

  stop(): Promise<void> {
    return this.lifecycle.stop();
  }
}

/** One feature declared on an application, before boot looks at it. */
interface DeclaredFeature {
  readonly name: string;
  /** The background work this module declared, started by the worker role. */
  readonly workers: readonly unknown[];
  /** The one-shot work this module declared, exposed by the tasks role. */
  readonly tasks: readonly unknown[];
  readonly transports: readonly FeatureTransportDescriptor[];
  readonly facts: readonly unknown[];
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
  /** The pool members this module named, read off the pool before any create. */
  readonly requiredInfrastructure: readonly string[];
  readonly install: (args: FeatureInstallArguments<unknown>) => InstalledFeatureState;
}

/** What a builder collects, shared when one is re-parameterised by its doors. */
interface BuilderState<Rest, Trpc> {
  readonly features: DeclaredFeature[];
  readonly services: RuntimeService[];
  hosts: FeatureTransportHosts<Rest, Trpc>;
}

/** What a process is: a role, its parsed config and its one pool (ADR-144). */
export interface ApplicationOptions<Pool> {
  readonly role: ServerRole;
  /** One slice per module name, for the modules that declared a config. */
  readonly config?: Readonly<Record<string, unknown>>;
  readonly infrastructure: Pool;
}

/** An application with its infrastructure named, collecting declarations. */
export class ApplicationBuilder<Infrastructure, Rest = never, Trpc = never> {
  private readonly state: BuilderState<Rest, Trpc>;
  private readonly role: ServerRole;
  private readonly config: Readonly<Record<string, unknown>>;
  private readonly infrastructure: Infrastructure;
  readonly name: string;

  constructor(options: ApplicationOptions<Infrastructure>, state?: BuilderState<Rest, Trpc>) {
    this.role = options.role;
    this.config = options.config ?? {};
    this.infrastructure = options.infrastructure;
    this.name = options.role;
    this.state = state ?? { features: [], services: [], hosts: {} };
  }

  /**
   * The doors this process opens. Every transport an installed feature
   * declares is mounted on them at boot, and a feature declaring one for a
   * protocol named here is refused by name.
   */
  withTransports<NextRest, NextTrpc>(
    hosts: FeatureTransportHosts<NextRest, NextTrpc>,
  ): ApplicationBuilder<Infrastructure, NextRest, NextTrpc> {
    return new ApplicationBuilder<Infrastructure, NextRest, NextTrpc>(
      { role: this.role, config: this.config, infrastructure: this.infrastructure },
      { ...this.state, hosts },
    );
  }

  /**
   * Every module this process installs. A module whose Infrastructure names a
   * member this pool lacks is not assignable, so the list fails to compile.
   */
  withModules(modules: readonly InstallableServerFeature<Infrastructure>[]): this {
    for (const module of modules) this.addFeature(module);
    return this;
  }

  private addFeature(declaration: InstallableServerFeature<Infrastructure>): this {
    const infrastructure = this.infrastructure;
    this.state.features.push({
      name: declaration.name,
      transports: declaration.transports ?? [],
      facts: [],
      repositories: snapshotRepositories(declaration.repositories),
      repositoryRegistry: declaration.repositoryRegistry,
      apiContract: declaration.apiContract,
      dependencies: declaration.dependencies,
      transportDependencies: declaration.transportDependencies,
      providers: declaration.providers,
      contributesWorkerWork: declaration.contributesWorkerWork,
      requiredInfrastructure: declaration.requiredInfrastructure ?? [],
      workers: declaration.workers ?? [],
      tasks: declaration.tasks ?? [],
      install: (args) => declaration.install({ ...args, infrastructure }),
    });
    return this;
  }

  /** Something the runtime starts and stops around the feature graph. */
  withService(service: RuntimeService): this {
    this.state.services.push(service);
    return this;
  }

  /** Validates providers, allocates peer clients and constructs Apps before serving. */
  async boot(): Promise<BootedRuntime<Infrastructure, Rest, Trpc>> {
    const role = this.role;
    const config = this.config;
    const persistence = persistenceFor(this.infrastructure);

    const declarations = this.state.features;
    for (const declaration of declarations) {
      assertInfrastructure({
        module: declaration.name,
        members: declaration.requiredInfrastructure ?? [],
        infrastructure: this.infrastructure,
      });
    }
    assertRepositoryBackend(declarations, persistence);
    assertRepositoryOwnership(
      declarations.map((declaration) => ({
        ...declaration,
        repositories: {
          ...declaration.repositories,
          ...(declaration.repositoryRegistry
            ? selectedRepositoryOwnership(declaration.repositoryRegistry, persistence)
            : {}),
        },
      })),
    );
    // Providers first: the same feature declared twice is reported by the token
    // it claims twice, which is the thing a reader can act on. A feature that
    // provides nothing still gets the plainer refusal below.
    const providerOf = this.resolveProviders(declarations);
    this.assertApiDeclarations(declarations);
    this.assertUniqueFeatures(declarations);
    this.assertEveryDependencyProvided(declarations, providerOf, role);
    const order = orderByDependency(declarations, providerOf, role);

    const scope = new ResourceScope();
    const featureServices: RuntimeService[] = [];
    const installed = new Map<string, InstalledFeatureState>();
    const provided = new Map<TokenIdentity, unknown>();
    const apis = new LocalFeatureApis();
    const declared: DeclaredTransports[] = [];
    this.allocateApiClients(apis, providerOf, provided);
    let transports: MountedTransports<Rest, Trpc> = { rest: [], trpc: {} };
    try {
      for (const declaration of order) {
        const resources = new ResourceScope();
        scope.own(declaration.name, () => resources.close());
        const state = declaration.install({
          resources,
          config: config[declaration.name],
          infrastructure: this.infrastructure,
          persistence,
          role,
          resolve: (token) =>
            token instanceof ModuleApiToken ? apis.reference(token) : provided.get(token),
        });
        featureServices.push(...resources.sealServices());
        this.bindProviders(declaration, state, apis, provided);
        const installedState = declaration.apiContract
          ? { ...state, provided: apis.reference(declaration.apiContract) }
          : state;
        installed.set(declaration.name, installedState);
        declared.push(...declaredTransportsOf(declaration, installedState));
      }
      apis.ready();
      scope.own("feature API bindings", () => apis.close());
      // After every application exists, so a handler reaching a peer through
      // its own app gets the same instance every other caller holds.
      if (this.opensDoors(role)) {
        transports = mountDeclaredTransports({ declared, hosts: this.state.hosts });
      }
    } catch (error) {
      apis.close();
      return cleanupAfterFailure(error, () => scope.close());
    }

    return new BootedRuntime<Infrastructure, Rest, Trpc>(
      this.name,
      role,
      this.infrastructure,
      transports,
      installed,
      provided,
      roleContributions(declarations, role),
      scope,
      [...featureServices, ...this.state.services],
    );
  }

  /**
   * Whether this application mounts what its features declared. Only a process
   * that named a door does, and only in the role that serves one.
   */
  private opensDoors(role: ServerRole): boolean {
    if (role !== "api") return false;

    return this.state.hosts.rest !== undefined || this.state.hosts.trpc !== undefined;
  }

  private allocateApiClients(
    apis: LocalFeatureApis,
    providerOf: ReadonlyMap<TokenIdentity, string>,
    provided: Map<TokenIdentity, unknown>,
  ): void {
    for (const token of providerOf.keys()) {
      if (token instanceof ModuleApiToken) apis.declare(token);
    }
  }

  private bindProviders(
    declaration: DeclaredFeature,
    state: InstalledFeatureState,
    apis: LocalFeatureApis,
    provided: Map<TokenIdentity, unknown>,
  ): void {
    for (const provider of declaration.providers) {
      const value = provider.read(state.provided as never);
      if (provider.token instanceof ModuleApiToken) {
        apis.bind(provider.token, value);
        provided.set(provider.token, apis.reference(provider.token));
      } else {
        provided.set(provider.token, value);
      }
    }
  }

  private assertUniqueFeatures(declarations: readonly DeclaredFeature[]): void {
    const seen = new Set<string>();
    for (const declaration of declarations) {
      if (seen.has(declaration.name)) throw new DuplicateFeatureError(declaration.name);
      seen.add(declaration.name);
    }
  }

  /** Which feature answers for each token, refusing a token claimed twice. */
  private resolveProviders(
    declarations: readonly DeclaredFeature[],
  ): ReadonlyMap<TokenIdentity, string> {
    const providerOf = new Map<TokenIdentity, string>();
    const apiOwners = new Map<string, string>();
    const register = (token: TokenIdentity, owner: string): void => {
      const existing =
        token instanceof ModuleApiToken ? apiOwners.get(token.name) : providerOf.get(token);
      if (existing !== void 0) {
        throw new DuplicateProviderError(tokenName(token), [existing, owner]);
      }
      if (token instanceof ModuleApiToken) apiOwners.set(token.name, owner);
      providerOf.set(token, owner);
    };
    for (const declaration of declarations) {
      for (const provider of declaration.providers) {
        register(provider.token, declaration.name);
      }
    }
    return providerOf;
  }

  private assertApiDeclarations(declarations: readonly DeclaredFeature[]): void {
    for (const declaration of declarations) {
      if (!declaration.apiContract) {
        assertLegacyProviders(declaration);
        continue;
      }
      if (declaration.apiContract.name !== declaration.name) {
        throw new Error(
          `Feature "${declaration.name}" cannot provide API "${declaration.apiContract.name}".`,
        );
      }
      for (const [key, token] of Object.entries(declaration.dependencies)) {
        if (!(token instanceof ModuleApiToken)) {
          throw new Error(
            `Feature "${declaration.name}" dependency "${key}" must use a peer API token.`,
          );
        }
      }
    }
  }

  private assertEveryDependencyProvided(
    declarations: readonly DeclaredFeature[],
    providerOf: ReadonlyMap<TokenIdentity, string>,
    role: ServerRole,
  ): void {
    for (const declaration of declarations) {
      for (const [key, token] of dependenciesFor(declaration, role)) {
        if (!providerOf.has(token)) {
          throw new MissingProviderError(declaration.name, key, tokenName(token));
        }
      }
    }
  }
}

/**
 * A process, named by its role and holding its config and its one pool.
 * Nothing is constructed until `boot`.
 */
export function createApp<Pool>(options: ApplicationOptions<Pool>): ApplicationBuilder<Pool> {
  return new ApplicationBuilder<Pool>(options);
}

/** What this role starts: declared workers on a worker, declared tasks on tasks. */
function roleContributions(
  declarations: readonly DeclaredFeature[],
  role: ServerRole,
): readonly unknown[] {
  if (role === "worker") return declarations.flatMap((declaration) => declaration.workers);
  if (role === "tasks") return declarations.flatMap((declaration) => declaration.tasks);
  return [];
}

/**
 * The pool decides persistence: a pool holding a Prisma client selects the
 * postgres backend, and one without it selects the memory backend, so a test
 * and production differ by their pool and by nothing else.
 */
function persistenceFor(
  infrastructure: unknown,
): Readonly<{ backend: string; infrastructure: Readonly<Record<string, unknown>> }> {
  const pool = (infrastructure ?? {}) as Readonly<Record<string, unknown>>;
  return Object.freeze({
    backend: pool.prisma === undefined ? "memory" : "postgres",
    infrastructure: pool,
  });
}

function assertRepositoryBackend(
  declarations: readonly DeclaredFeature[],
  persistence: Readonly<{ backend: string; infrastructure: Readonly<Record<string, unknown>> }>,
): void {
  for (const declaration of declarations) {
    if (!declaration.repositoryRegistry) continue;
    validateRepositorySelection(declaration.repositoryRegistry, persistence);
  }
}

/** What one feature contributes to the process's doors, or nothing. */
function declaredTransportsOf(
  declaration: DeclaredFeature,
  state: InstalledFeatureState,
): readonly DeclaredTransports[] {
  if (declaration.transports.length === 0) return [];

  return [
    {
      feature: declaration.name,
      transports: declaration.transports,
      provided: () => state.provided,
      facts: declaration.facts,
    },
  ];
}

/** Every token one feature needs in this role, with the key that names it. */
function dependenciesFor(
  declaration: DeclaredFeature,
  role: ServerRole,
): ReadonlyArray<readonly [string, TokenIdentity]> {
  const always = Object.entries(declaration.dependencies);
  const transport = role === "api" ? Object.entries(declaration.transportDependencies) : [];
  return [...always, ...transport];
}

/** Only legacy constructor dependencies impose construction order; API clients are preallocated. */
function orderByDependency(
  declarations: readonly DeclaredFeature[],
  providerOf: ReadonlyMap<TokenIdentity, string>,
  role: ServerRole,
): readonly DeclaredFeature[] {
  const byName = new Map(declarations.map((declaration) => [declaration.name, declaration]));
  const ordered: DeclaredFeature[] = [];
  const done = new Set<string>();
  const path: string[] = [];

  const visit = (declaration: DeclaredFeature): void => {
    if (done.has(declaration.name)) return;
    if (path.includes(declaration.name)) {
      throw new DependencyCycleError([
        ...path.slice(path.indexOf(declaration.name)),
        declaration.name,
      ]);
    }
    path.push(declaration.name);
    for (const dependency of constructorDependencies(declaration, role, providerOf, byName)) {
      visit(dependency);
    }
    path.pop();
    done.add(declaration.name);
    ordered.push(declaration);
  };

  for (const declaration of declarations) visit(declaration);
  return ordered;
}

function assertLegacyProviders(declaration: DeclaredFeature): void {
  const providesApi = declaration.providers.some(
    (provider) => provider.token instanceof ModuleApiToken,
  );
  if (providesApi) {
    throw new Error(
      `Feature "${declaration.name}" must provide its API through defineModule().withApp().`,
    );
  }
}

function constructorDependencies(
  declaration: DeclaredFeature,
  role: ServerRole,
  providerOf: ReadonlyMap<TokenIdentity, string>,
  byName: ReadonlyMap<string, DeclaredFeature>,
): DeclaredFeature[] {
  const dependencies: DeclaredFeature[] = [];
  for (const [, token] of dependenciesFor(declaration, role)) {
    if (token instanceof ModuleApiToken) continue;
    const provider = providerOf.get(token);
    const dependency = provider === void 0 ? void 0 : byName.get(provider);
    if (dependency) dependencies.push(dependency);
  }
  return dependencies;
}

function unavailable(feature: string, role: ServerRole, contribution: string): () => never {
  return () => {
    throw new RoleContributionError(feature, role, `${contribution} (unavailable)`);
  };
}
