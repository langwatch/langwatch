import type { ScopedSecrets, SecretHandle } from "@langwatch/secrets";

import {
  DependencyCycleError,
  DuplicateFeatureError,
  DuplicateProviderError,
  MissingProviderError,
  RoleContributionError,
} from "./boot-errors.ts";
/** Declares, constructs and starts the process graph; see ADR-133. */
import {
  type DependencyToken,
  type TokenIdentity,
  type TokenMap,
  tokenName,
} from "./dependency-token.ts";
import type {
  FeatureTransportDescriptor,
  InstallableServerFeature,
  InstalledFeatureState,
  FeatureInstallArguments,
  FeatureProvider,
  ModuleConfigGuard,
  ModuleConfigRecord,
  ModuleSecretsScope,
  ServerFeatureDeclaration,
  ServerRole,
} from "./feature-installer.ts";
import { LocalFeatureApis } from "./local-feature-api.ts";
import { ModuleApiToken, type FeatureApiIdentity } from "./module-api-token.ts";
import {
  commandsOf,
  eventingHostFrom,
  type EventingHost,
  type FeatureEventing,
} from "./module-eventing.ts";
import { buildClaimedMembers, membersFor, noMembers, type MemberSource } from "./module-members.ts";
import {
  assertRepositoryOwnership,
  snapshotRepositories,
  type FeatureRepositories,
} from "./repository-ownership.ts";
import {
  repositoriesRequire,
  selectedRepositoryOwnership,
  validateRepositorySelection,
  type AnyRepositoryRegistry,
  type RepositorySelection,
} from "./repository-registry.ts";
import { ResourceScope } from "./resource-scope.ts";
import { RuntimeLifecycle, cleanupAfterFailure, type RuntimeService } from "./runtime-lifecycle.ts";
import { SupplyToken } from "./supply-token.ts";
import type { Tier } from "./tiers.ts";
import {
  mountDeclaredTransports,
  type DeclaredTransports,
  type FeatureTransportHosts,
  type MountedTransports,
} from "./transport-mounting.ts";
import { transportPeersOf, type TransportPeers } from "./transport-peers.ts";
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
    /** Members built: union of modules' required members, nothing else. */
    readonly members: Readonly<Partial<Members>>,
    /** Mounted transports, in install/namespace order. */
    readonly transports: MountedTransports<Rest, Trpc>,
    private readonly installed: ReadonlyMap<string, InstalledFeatureState>,
    private readonly provided: ReadonlyMap<TokenIdentity, unknown>,
    /** Background work this role owns (workers/tasks/empty for others). */
    readonly contributions: readonly unknown[],
    scope: ResourceScope,
    services: readonly RuntimeService[],
    /** Which feature declared each contribution, so a bad one can be named. */
    private readonly declaredBy: ReadonlyMap<unknown, string> = new Map(),
    /**
     * What this process serves: ONE composed handler, built by the surface the
     * chain exposed once everything mounted. Absent in every role that serves
     * no requests, and absent in a test, which passes no server.
     */
    readonly handler: unknown = void 0,
  ) {
    this.lifecycle = new RuntimeLifecycle(services, scope);
  }

  /**
   * The one-shot work this process runs, narrowed by the caller's own guard.
   *
   * `contributions` is `unknown[]` because the kernel depends on zod and
   * nothing else: `Task` is not a name it can hold, so it cannot check the
   * shape itself. The caller passes the predicate instead, which is what keeps
   * the narrowing honest at both ends -- no cast here, none at the call site --
   * and turns a module that declared something other than a task into a boot
   * failure naming that module, rather than a crash when the thing is run.
   */
  tasks<Task>(isTask: (contribution: unknown) => contribution is Task): readonly Task[] {
    if (this.role !== "tasks") {
      throw new Error(
        `Asked "${this.name}" for its one-shot tasks, but only the "tasks" role hosts them ` +
          `and this process is "${this.role}". Build it with createApp({ role: "tasks" }).`,
      );
    }
    const tasks: Task[] = [];
    for (const contribution of this.contributions) {
      if (isTask(contribution)) {
        tasks.push(contribution);
        continue;
      }
      throw new RoleContributionError(
        this.declaredBy.get(contribution) ?? "an unnamed feature",
        this.role,
        "something withTasks accepted that is not a task",
      );
    }
    return tasks;
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
  /** Repository tier: live or memory (withMemoryRepositories). */
  readonly tier: Tier;
  /** The handles this module declared, for the root to scope its resolver to. */
  readonly secrets?: Readonly<Record<string, SecretHandle<unknown>>>;
  readonly install: (args: FeatureInstallArguments<unknown>) => Promise<InstalledFeatureState>;
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
  /**
   * What this process serves, once every declared transport has mounted. Called
   * at the one moment it can be: the whole surface exists and nothing is
   * listening yet.
   */
  serve?: (() => unknown) | undefined;
}

/** Factory to build doors after all modules install (needed when doors read modules). */
export type TransportHostFactory<Rest, Trpc> = (
  peers: TransportPeers,
) => FeatureTransportHosts<Rest, Trpc>;

/** Either shape a caller may name its doors in. */
export type TransportHostSource<Rest, Trpc> =
  | FeatureTransportHosts<Rest, Trpc>
  | TransportHostFactory<Rest, Trpc>;

/** Process role, config, and member sources (ADR-144). */
export interface ApplicationOptions<
  Members,
  Config extends ModuleConfigRecord = ModuleConfigRecord,
> {
  readonly role: ServerRole;
  /** Module config slices, checked at install. */
  readonly config?: Config;
  /** Member sources; omitted means no client, module refusing by name. */
  readonly members?: MemberSource<Members>;
  /**
   * Scopes the process's resolver to one module's own declared handles (§6).
   * A process that states no secrets chain omits it, and a module resolving
   * one anyway is refused by name rather than reading an undeclared secret.
   */
  readonly secrets?: ModuleSecretsScope;
}

/** An application with its members named, collecting declarations. */
export class ApplicationBuilder<
  Members,
  Rest = never,
  Trpc = never,
  Config extends ModuleConfigRecord = ModuleConfigRecord,
> {
  private readonly state: BuilderState<Rest, Trpc>;
  private readonly role: ServerRole;
  private readonly config: Readonly<Record<string, unknown>>;
  private readonly source: MemberSource<Members>;
  private readonly secrets: ModuleSecretsScope | undefined;
  readonly name: string;

  constructor(options: ApplicationOptions<Members, Config>, state?: BuilderState<Rest, Trpc>) {
    this.role = options.role;
    this.config = options.config ?? {};
    this.source = options.members ?? noMembers<Members>();
    this.secrets = options.secrets;
    this.name = options.role;
    this.state = state ?? { features: [], services: [], provisions: [], hosts: {} };
  }

  /**
   * Process doors; features' transports mount on them. Can be a factory
   * run after all modules install.
   */
  withTransports<NextRest, NextTrpc>(
    hosts: TransportHostSource<NextRest, NextTrpc>,
    serve?: () => unknown,
  ): ApplicationBuilder<Members, NextRest, NextTrpc, Config> {
    return new ApplicationBuilder<Members, NextRest, NextTrpc, Config>(
      {
        role: this.role,
        config: this.config as Config,
        members: this.source,
        ...(this.secrets ? { secrets: this.secrets } : {}),
      },
      { ...this.state, hosts, serve },
    );
  }

  /** Modules to install; guards ensure members and config align. */
  withModules<const Modules extends readonly InstallableServerFeature<Members>[]>(
    modules: Modules & ModuleConfigGuard<Modules, Config>,
  ): this {
    for (const module of modules as readonly InstallableServerFeature<Members>[]) {
      this.addFeature(module);
    }
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
      // Copied member by member above, so an omission here silently disables a
      // seam rather than failing to compile: without this the root scopes every
      // module's resolver to nothing and every declared handle reads undeclared.
      ...(declaration.secrets ? { secrets: declaration.secrets } : {}),
      install: (args) => declaration.install(args as FeatureInstallArguments<Members>),
    });
    return this;
  }

  /** Provide a peer by token; install module providing same token to refuse. */
  withProvided<Instance>(token: DependencyToken<Instance>, instance: Instance): this {
    if (this.state.provisions.some((provision) => provision.token === token)) {
      throw new DuplicateProviderError(tokenName(token), ["the process", "the process"]);
    }
    this.state.provisions.push({ token, instance });
    return this;
  }

  /** Exactly this module's own handles: a peer's are not reachable by name. */
  private secretsFor(declaration: DeclaredFeature): { secrets?: ScopedSecrets } {
    if (!this.secrets) return {};

    return { secrets: this.secrets(declaration.name, Object.values(declaration.secrets ?? {})) };
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
      declarations.map((declaration) => [declaration.name, { tier: declaration.tier, members }]),
    );
    // Belt and braces over the union above: a source that answered a claimed
    // member with null built something a factory cannot use.
    assertRepositoryBackend(declarations, selections);
    const eventing = eventingHostFrom(eventingMemberFor(declarations, this.source), role);
    const scope = new ResourceScope();
    const featureServices: RuntimeService[] = [];
    const installed = new Map<string, InstalledFeatureState>();
    const provided = new Map<TokenIdentity, unknown>();
    const apis = new LocalFeatureApis();
    const declared: DeclaredTransports[] = [];
    this.allocateApiClients(apis, providerOf, provided);
    let transports: MountedTransports<Rest, Trpc> = { rest: [], trpc: {} };
    let handler: unknown;
    try {
      for (const declaration of order) {
        const resources = new ResourceScope();
        scope.own(declaration.name, () => resources.close());
        const state = await declaration.install({
          resources,
          config: config[declaration.name],
          ...this.secretsFor(declaration),
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
        // Now: all Apps exist, nothing serves yet. Only moment doors can be built.
        const hosts = this.openDoors((token) => provided.get(token));
        if (hosts.rest !== void 0 || hosts.trpc !== void 0) {
          transports = mountDeclaredTransports({ declared, hosts });
        }
        // A bundle-only API still serves even when neither protocol has declarations.
        handler = this.state.serve?.();
      }
    } catch (error) {
      apis.close();
      return cleanupAfterFailure(error, () => scope.close());
    }

    const contributions = roleContributions(declarations, role);

    return new BootedRuntime<Members, Rest, Trpc>(
      this.name,
      role,
      members as Readonly<Partial<Members>>,
      transports,
      installed,
      provided,
      contributions.contributions,
      scope,
      [...featureServices, ...this.state.services],
      contributions.declaredBy,
      handler,
    );
  }

  /**
   * The doors this process opens, resolved once. A caller that named the hosts
   * outright gets them back; one that named a factory has it run here, with
   * every installed module's App reachable by its own contract token.
   */
  private openDoors(resolve: (token: TokenIdentity) => unknown): FeatureTransportHosts<Rest, Trpc> {
    const source = this.state.hosts;
    return typeof source === "function" ? source(transportPeersOf(resolve)) : source;
  }

  /** Store peer instances as-is; declare module API tokens. */
  private allocateApiClients(
    apis: LocalFeatureApis,
    providerOf: ReadonlyMap<TokenIdentity, string>,
    provided: Map<TokenIdentity, unknown>,
  ): void {
    for (const provision of this.state.provisions)
      provided.set(provision.token, provision.instance);
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
    /**
     * A module's contract token claims the module's name; the process claims no
     * name, so a core token named for a module is not thereby that module's API.
     */
    const register = (token: TokenIdentity, owner: string, claimsName: boolean): void => {
      const existing =
        providerOf.get(token) ??
        (claimsName && token instanceof ModuleApiToken ? apiOwners.get(token.name) : void 0);
      if (existing !== void 0) {
        throw new DuplicateProviderError(tokenName(token), [existing, owner]);
      }
      if (claimsName && token instanceof ModuleApiToken) apiOwners.set(token.name, owner);
      providerOf.set(token, owner);
    };
    // The process's own provisions first, so a module answering for the very
    // same token is refused rather than silently overwriting what the caller
    // handed in. That check is by identity, so it holds for both.
    for (const provision of this.state.provisions) {
      register(provision.token, "the process", false);
    }
    for (const declaration of declarations) {
      for (const provider of declaration.providers) {
        register(provider.token, declaration.name, true);
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
        if (!(token instanceof ModuleApiToken) && !(token instanceof SupplyToken)) {
          throw new Error(
            `Feature "${declaration.name}" dependency "${key}" must use a dependency token.`,
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
export function createApp<Members, const Config extends ModuleConfigRecord = ModuleConfigRecord>(
  options: ApplicationOptions<Members, Config>,
): ApplicationBuilder<Members, never, never, Config> {
  return new ApplicationBuilder<Members, never, never, Config>(options);
}

/** The eventing runtime member if this process holds one and eventing is declared. */
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

/** Install module's eventing pipeline if runtime exists. */
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

/**
 * What this role starts: declared workers on a worker, declared tasks on tasks.
 *
 * The declaring feature is kept beside each contribution. Flattening loses it
 * otherwise, and a module that declared the wrong thing is then only findable
 * by reading every `withTasks` call in the tree.
 */
function roleContributions(
  declarations: readonly DeclaredFeature[],
  role: ServerRole,
): { contributions: readonly unknown[]; declaredBy: ReadonlyMap<unknown, string> } {
  const declaredBy = new Map<unknown, string>();
  const contributions: unknown[] = [];
  for (const declaration of declarations) {
    const declared =
      role === "worker" ? declaration.workers : role === "tasks" ? declaration.tasks : [];
    for (const contribution of declared) {
      contributions.push(contribution);
      if (typeof contribution === "object" && contribution !== null) {
        declaredBy.set(contribution, declaration.name);
      }
    }
  }
  return { contributions, declaredBy };
}

/** Verify each module's tier has required members; no inference from environment. */
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
): readonly (readonly [string, TokenIdentity])[] {
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
