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
import { transportPeersOf, type TransportPeers } from "./transport-peers.ts";
import {
  buildClaimedMembers,
  membersFor,
  noMembers,
  type MemberClaim,
  type MemberSource,
} from "./module-members.ts";
import {
  commandsOf,
  eventingHostFrom,
  type EventingHost,
  type FeatureEventing,
} from "./module-eventing.ts";
import { ResourceScope } from "./resource-scope.ts";
import { RuntimeLifecycle, cleanupAfterFailure, type RuntimeService } from "./runtime-lifecycle.ts";
import { ModuleApiToken, type FeatureApiIdentity } from "./module-api-token.ts";
import { LocalFeatureApis } from "./local-feature-api.ts";
import {
  repositoriesRequire,
  selectedRepositoryOwnership,
  validateRepositorySelection,
  type AnyRepositoryRegistry,
  type RepositorySelection,
} from "./repository-registry.ts";
import type { Tier } from "./tiers.ts";
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
export class BootedRuntime<Members, Rest = never, Trpc = never> {
  private readonly lifecycle: RuntimeLifecycle;
  constructor(
    readonly name: string,
    readonly role: ServerRole,
    /**
     * The members this process actually built: exactly the union its installed
     * modules declared and their repository tiers required, and nothing else.
     * It is partial because that union is the point - a process builds no
     * client no module asked for.
     */
    readonly members: Readonly<Partial<Members>>,
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
    FeatureMembers,
  >(
    declaration: ServerFeatureDeclaration<
      Config,
      FeatureMembers,
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
  /** The event sourcing this module declared, installed where a runtime exists. */
  readonly eventing: FeatureEventing | undefined;
  /** The background work this module declared, started by the worker role. */
  readonly workers: readonly unknown[];
  /** The one-shot work this module declared, exposed by the tasks role. */
  readonly tasks: readonly unknown[];
  readonly transports: readonly FeatureTransportDescriptor[];
  readonly repositories?: FeatureRepositories;
  readonly repositoryRegistry?: AnyRepositoryRegistry;
  readonly apiContract?: FeatureApiIdentity;
  readonly dependencies: TokenMap;
  readonly transportDependencies: TokenMap;
  readonly providers: readonly FeatureProvider<never>[];
  readonly contributesWorkerWork: boolean;
  /** What this module's App declared it reads, built before any create runs. */
  readonly requiredMembers: readonly string[];
  /**
   * Which of the module's two repository tiers this process installs. Live
   * unless the caller said otherwise in code with `withMemoryRepositories`,
   * which is the one seam that may say "memory" and the only way to run a
   * module without its stores.
   */
  readonly tier: Tier;
  readonly install: (args: FeatureInstallArguments<unknown>) => InstalledFeatureState;
}

/** One instance the process itself answers for, by the token that names it. */
interface ProcessProvision {
  readonly token: TokenIdentity;
  readonly instance: unknown;
}

/** What a builder collects, shared when one is re-parameterised by its doors. */
interface BuilderState<Rest, Trpc> {
  readonly features: DeclaredFeature[];
  readonly services: RuntimeService[];
  /** Peers the process hands in itself, rather than by installing their module. */
  readonly provisions: ProcessProvision[];
  hosts: TransportHostSource<Rest, Trpc>;
}

/**
 * A process's doors, stated either as the hosts themselves or as the factory
 * that builds them once every module's App exists. The factory is what a
 * process whose doors read a module - every credential this one resolves -
 * has to state, because there is no earlier moment at which it could.
 */
export type TransportHostFactory<Rest, Trpc> = (
  peers: TransportPeers,
) => FeatureTransportHosts<Rest, Trpc>;

/** Either shape a caller may name its doors in. */
export type TransportHostSource<Rest, Trpc> =
  | FeatureTransportHosts<Rest, Trpc>
  | TransportHostFactory<Rest, Trpc>;

/**
 * What a process is: a role, its parsed config, and where its members come
 * from (ADR-144).
 *
 * There is no word here for which backend a store has. A store's ADDRESS is
 * the statement - `DATABASE_URL` present means Postgres is reached, absent
 * means every repository that needs it refuses at boot naming the module and
 * the member - so a lost variable can never read as a decision. The only way
 * to run a module without its stores is to say so in code, by installing it
 * with `withMemoryRepositories`.
 */
export interface ApplicationOptions<Members> {
  readonly role: ServerRole;
  /** One slice per module name, for the modules that declared a config. */
  readonly config?: Readonly<Record<string, unknown>>;
  /**
   * Where the members come from, built by `@langwatch/infrastructure`.
   *
   * Omitted, the process opens no client. That is not a quiet downgrade: a
   * module that reads a member still refuses by name at boot.
   */
  readonly members?: MemberSource<Members>;
}

/** An application with its members named, collecting declarations. */
export class ApplicationBuilder<Members, Rest = never, Trpc = never> {
  private readonly state: BuilderState<Rest, Trpc>;
  private readonly role: ServerRole;
  private readonly config: Readonly<Record<string, unknown>>;
  private readonly source: MemberSource<Members>;
  readonly name: string;

  constructor(options: ApplicationOptions<Members>, state?: BuilderState<Rest, Trpc>) {
    this.role = options.role;
    this.config = options.config ?? {};
    this.source = options.members ?? noMembers<Members>();
    this.name = options.role;
    this.state = state ?? { features: [], services: [], provisions: [], hosts: {} };
  }

  /**
   * The doors this process opens. Every transport an installed feature
   * declares is mounted on them at boot, and a feature declaring one for a
   * protocol this process opened no door for is refused by name.
   *
   * A process whose doors are built from what its own modules resolve - every
   * credential this api answers behind - states a FACTORY instead of the
   * hosts. Boot runs it once, after every module is installed and its App
   * bound, and before anything is mounted or served.
   */
  withTransports<NextRest, NextTrpc>(
    hosts: TransportHostSource<NextRest, NextTrpc>,
  ): ApplicationBuilder<Members, NextRest, NextTrpc> {
    return new ApplicationBuilder<Members, NextRest, NextTrpc>(
      { role: this.role, config: this.config, members: this.source },
      { ...this.state, hosts },
    );
  }

  /**
   * Every module this process installs. A module whose Members names a
   * member this pool lacks is not assignable, so the list fails to compile.
   */
  withModules(modules: readonly InstallableServerFeature<Members>[]): this {
    for (const module of modules) this.addFeature(module);
    return this;
  }

  private addFeature(declaration: InstallableServerFeature<Members>): this {
    this.state.features.push({
      name: declaration.name,
      transports: declaration.transports ?? [],
      repositories: snapshotRepositories(declaration.repositories),
      repositoryRegistry: declaration.repositoryRegistry,
      apiContract: declaration.apiContract,
      dependencies: declaration.dependencies,
      transportDependencies: declaration.transportDependencies,
      providers: declaration.providers,
      contributesWorkerWork: declaration.contributesWorkerWork,
      requiredMembers: declaration.members ?? [],
      tier: declaration.tier ?? "live",
      workers: declaration.workers ?? [],
      tasks: declaration.tasks ?? [],
      eventing: declaration.eventing,
      install: (args) => declaration.install(args as FeatureInstallArguments<Members>),
    });
    return this;
  }

  /**
   * One peer this process answers for itself, by the token that names it.
   *
   * A peer is not a member: it is another module's App, and the alternative to
   * this seam is installing that module, which installs its peers after it,
   * down to the authorization ledger. A process that hands a peer in AND
   * installs the module that provides it is refused by the token both claim.
   */
  withProvided<Instance>(token: DependencyToken<Instance>, instance: Instance): this {
    if (this.state.provisions.some((provision) => provision.token === token)) {
      throw new DuplicateProviderError(tokenName(token), ["the process", "the process"]);
    }
    this.state.provisions.push({ token, instance });
    return this;
  }

  /** Something the runtime starts and stops around the feature graph. */
  withService(service: RuntimeService): this {
    this.state.services.push(service);
    return this;
  }

  /** Validates providers, allocates peer clients and constructs Apps before serving. */
  async boot(): Promise<BootedRuntime<Members, Rest, Trpc>> {
    const role = this.role;
    const config = this.config;

    const declarations = this.state.features;
    // Everything readable off the declarations alone comes first, so a graph
    // that cannot be built is refused before this process opens one client.
    // Table ownership is the first of them: two modules writing the same rows
    // is a fact about the code, not about what this deployment configured.
    assertRepositoryOwnership(
      declarations.map((declaration) => ({
        ...declaration,
        repositories: {
          ...declaration.repositories,
          ...(declaration.repositoryRegistry
            ? selectedRepositoryOwnership(declaration.repositoryRegistry, {
                tier: declaration.tier,
                members: {},
              })
            : {}),
        },
      })),
    );
    // Providers next: the same feature declared twice is reported by the token
    // it claims twice, which is the thing a reader can act on. A feature that
    // provides nothing still gets the plainer refusal below. All of it is read
    // off the declarations, so a graph that cannot be built is refused before
    // this process opens a single client.
    const providerOf = this.resolveProviders(declarations);
    this.assertApiDeclarations(declarations);
    this.assertUniqueFeatures(declarations);
    this.assertEveryDependencyProvided(declarations, providerOf, role);
    const order = orderByDependency(declarations, providerOf, role);

    // Exactly the union of what every installed module declared it reads and
    // what its chosen repository tier requires, built eagerly and in the
    // source's own construction order. A member this process cannot supply
    // refuses HERE, naming the module and the member, rather than on the first
    // request that reaches it.
    const members = buildClaimedMembers({
      source: this.source,
      claims: declarations.map((declaration) => ({
        module: declaration.name,
        members: claimedBy(declaration),
      })),
    });
    const selections = new Map<string, RepositorySelection>(
      declarations.map((declaration) => [
        declaration.name,
        { tier: declaration.tier, members },
      ]),
    );
    // Belt and braces over the union above: a source that answered a claimed
    // member with null built something a factory cannot use.
    assertRepositoryBackend(declarations, selections);
    const eventing = eventingHostFrom(eventingMemberFor(declarations, this.source));
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
          // Each module is handed the members it declared and nothing else, so
          // one that never named a client cannot reach for one.
          members: membersFor(members, declaration.requiredMembers) as Members,
          repositorySelection: selections.get(declaration.name),
          role,
          resolve: (token) =>
            provided.has(token)
              ? provided.get(token)
              : token instanceof ModuleApiToken
                ? apis.reference(token)
                : void 0,
        });
        featureServices.push(...resources.sealServices());
        this.bindProviders(declaration, state, apis, provided);
        const installedState = declaration.apiContract
          ? { ...state, provided: apis.reference(declaration.apiContract) }
          : state;
        installed.set(declaration.name, installedState);
        installModuleEventing(declaration, state, eventing);
        declared.push(...declaredTransportsOf(declaration, installedState));
      }
      apis.ready();
      scope.own("feature API bindings", () => apis.close());
      // After every application exists, so a handler reaching a peer through
      // its own app gets the same instance every other caller holds.
      if (role === "api") {
        // The one moment both are true: every App exists, and nothing is
        // serving yet. A door built from a module could not be built before
        // this line, and a route mounted after it would never be reached.
        // `provided` holds one reference per installed module's contract token
        // and per peer the process handed in itself, so it IS the answer to
        // what this build installed.
        const hosts = this.openDoors((token) => provided.get(token));
        if (hosts.rest !== void 0 || hosts.trpc !== void 0) {
          transports = mountDeclaredTransports({ declared, hosts });
        }
      }
    } catch (error) {
      apis.close();
      return cleanupAfterFailure(error, () => scope.close());
    }

    return new BootedRuntime<Members, Rest, Trpc>(
      this.name,
      role,
      members as Readonly<Partial<Members>>,
      transports,
      installed,
      provided,
      roleContributions(declarations, role),
      scope,
      [...featureServices, ...this.state.services],
    );
  }

  /**
   * The doors this process opens, resolved once. A caller that named the hosts
   * outright gets them back; one that named a factory has it run here, with
   * every installed module's App reachable by its own contract token.
   */
  private openDoors(
    resolve: (token: TokenIdentity) => unknown,
  ): FeatureTransportHosts<Rest, Trpc> {
    const source = this.state.hosts;
    return typeof source === "function" ? source(transportPeersOf(resolve)) : source;
  }

  /**
   * A reference per module-provided API token, and the instance itself for a
   * peer the process handed in. An instance a caller made is stored as it
   * stands: wrapping it would make a test double answer for whatever it does
   * not implement, which is the opposite of what a double is for.
   */
  private allocateApiClients(
    apis: LocalFeatureApis,
    providerOf: ReadonlyMap<TokenIdentity, string>,
    provided: Map<TokenIdentity, unknown>,
  ): void {
    for (const provision of this.state.provisions) provided.set(provision.token, provision.instance);
    for (const [token, owner] of providerOf) {
      if (owner !== "the process" && token instanceof ModuleApiToken) apis.declare(token);
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
    // The process's own provisions first, so a module that also claims the
    // token is refused by the token both answer for rather than silently
    // overwriting what the caller handed in.
    for (const provision of this.state.provisions) register(provision.token, "the process");
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
export function createApp<Members>(
  options: ApplicationOptions<Members>,
): ApplicationBuilder<Members> {
  return new ApplicationBuilder<Members>(options);
}

/**
 * Every member one module makes this process build: what its App declared it
 * reads, and what the repository tier it is installed on requires.
 *
 * A module installed on its memory tier requires nothing, which is what makes
 * `withMemoryRepositories` the whole of "run this without its stores": the
 * client is never asked for, so nothing refuses and nothing is opened.
 */
/**
 * The event-sourcing runtime this process holds, where it holds one.
 *
 * It is the one member read outside the declared union, and the one absence
 * that is not a refusal: which log a role appends to and whether it claims the
 * queue are role decisions carried as a collaborator rather than an address, so
 * a role that runs no event sourcing has nothing to lose and every declaration
 * is inert. A STORE never behaves this way - an absent address always refuses.
 */
function eventingMemberFor<Members>(
  declarations: readonly DeclaredFeature[],
  source: MemberSource<Members>,
): Readonly<Record<string, unknown>> {
  const named = source.order.find((member) => member === "eventing");
  if (named === void 0) return {};
  if (!declarations.some((declaration) => declaration.eventing)) return {};
  try {
    return { eventing: source.read(named) };
  } catch {
    return {};
  }
}

function claimedBy(declaration: DeclaredFeature): readonly string[] {
  const registry = declaration.repositoryRegistry;
  const tier = registry === void 0 ? [] : repositoriesRequire(registry, declaration.tier);
  return [...declaration.requiredMembers, ...tier];
}

/**
 * Installs one module's event sourcing, where this process runs any. The
 * pipeline is built after the module's app, over the app and the same
 * repository instances it was given. A pool with no eventing runtime installs
 * nothing, so a role that runs none ignores the declaration.
 */
function installModuleEventing(
  declaration: DeclaredFeature,
  state: InstalledFeatureState,
  eventing: EventingHost | undefined,
): void {
  const module = declaration.eventing;
  if (!module || !eventing) return;
  const definition = module.build({
    participation: eventing.participation,
    repositories: state.repositories,
    app: state.provided,
    processStore: eventing.processStore,
  });
  const registration = eventing.register(definition);
  module.connect?.({ app: state.provided, commands: commandsOf(registration) });
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
 * Every module's chosen tier has the members it requires.
 *
 * Nothing here infers a tier from what the process happens to hold: a module
 * asks for the tier it was installed on and gets it or a refusal. The old
 * `pool.prisma === undefined ? "memory" : "postgres"` is what this replaces,
 * and it was the exact failure the design exists to delete - a lost
 * `DATABASE_URL` read as a decision, and an API served empty lists out of
 * memory while readiness stayed green.
 */
function assertRepositoryBackend(
  declarations: readonly DeclaredFeature[],
  selections: ReadonlyMap<string, RepositorySelection>,
): void {
  for (const declaration of declarations) {
    const selection = selections.get(declaration.name);
    if (!declaration.repositoryRegistry || !selection) continue;
    validateRepositorySelection(declaration.repositoryRegistry, selection);
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
      // What the MODULE bound for the facts its own routes name, built by its
      // install in this role. The process binds only its own doors' facts and
      // never re-declares a route to supply a module's.
      facts: state.facts ?? [],
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
      `Feature "${declaration.name}" must provide its API through defineServerModule().withApp().`,
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
