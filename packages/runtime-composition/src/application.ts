/** Declares, constructs and starts the process graph; see ADR-133. */
import { type DependencyToken, type TokenMap, tokenName } from "./dependency-token.ts";
import {
  DependencyCycleError,
  DuplicateFeatureError,
  DuplicateProviderError,
  MissingProviderError,
  RoleContributionError,
} from "./boot-errors.ts";
import type {
  InstallableServerFeature,
  InstalledFeatureState,
  FeatureInstallArguments,
  FeatureProvider,
  ServerFeatureDeclaration,
  ServerRole,
} from "./feature-installer.ts";
import { ResourceScope } from "./resource-scope.ts";
import { RuntimeLifecycle, cleanupAfterFailure, type RuntimeService } from "./runtime-lifecycle.ts";
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
export class BootedRuntime<Infrastructure> {
  private readonly lifecycle: RuntimeLifecycle;
  constructor(
    readonly name: string,
    readonly role: ServerRole,
    readonly infrastructure: Infrastructure,
    private readonly installed: ReadonlyMap<string, InstalledFeatureState>,
    private readonly provided: ReadonlyMap<DependencyToken<unknown>, unknown>,
    scope: ResourceScope,
    services: readonly RuntimeService[],
  ) {
    this.lifecycle = new RuntimeLifecycle(services, scope);
  }

  /**
   * One installed feature, typed by its own declaration. The stored state is
   * erased — the root installs features it knows nothing else about — so the
   * declaration's own types are what name it again here.
   */
  feature<
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
  readonly dependencies: TokenMap;
  readonly transportDependencies: TokenMap;
  readonly providers: readonly FeatureProvider<never>[];
  readonly contributesWorkerWork: boolean;
  readonly install: (args: FeatureInstallArguments<unknown>) => InstalledFeatureState;
}

/** An application with its infrastructure named, collecting declarations. */
export class ApplicationBuilder<Infrastructure> {
  private readonly features: DeclaredFeature[] = [];
  private readonly preProvided = new Map<DependencyToken<unknown>, unknown>();
  private readonly services: RuntimeService[] = [];

  constructor(
    private readonly name: string,
    private readonly infrastructure: Infrastructure,
  ) {}

  /** Declares one feature. Constructs nothing. */
  withFeature(declaration: InstallableServerFeature<Infrastructure>): this;
  withFeature<FeatureInfrastructure>(
    declaration: InstallableServerFeature<FeatureInfrastructure>,
    options: { infrastructure: FeatureInfrastructure },
  ): this;
  withFeature<FeatureInfrastructure>(
    declaration: InstallableServerFeature<FeatureInfrastructure>,
    options?: { infrastructure: FeatureInfrastructure },
  ): this {
    if (options) return this.addFeature(declaration, options.infrastructure);
    return this.addFeature(declaration, this.infrastructure as Infrastructure & FeatureInfrastructure);
  }

  private addFeature<FeatureInfrastructure>(
    declaration: InstallableServerFeature<FeatureInfrastructure>,
    featureInfrastructure: FeatureInfrastructure,
  ): this {
    this.features.push({
      name: declaration.name,
      dependencies: declaration.dependencies,
      transportDependencies: declaration.transportDependencies,
      providers: declaration.providers,
      contributesWorkerWork: declaration.contributesWorkerWork,
      install: (args) => declaration.install({ ...args, infrastructure: featureInfrastructure }),
    });
    return this;
  }

  /**
   * Hands an already-constructed service in under its token.
   *
   * This is the seam that lets a converted feature depend on one that is still
   * composed by hand: the existing composition builds the service as it always
   * did and provides it here, and the graph validates exactly as if a
   * declaration had provided it.
   */
  withProvided<Instance>(token: DependencyToken<Instance>, instance: Instance): this {
    if (this.preProvided.has(token)) {
      throw new DuplicateProviderError(tokenName(token), ["<already provided>"]);
    }
    this.preProvided.set(token, instance);
    return this;
  }

  /** Something the runtime starts and stops around the feature graph. */
  withService(service: RuntimeService): this {
    this.services.push(service);
    return this;
  }

  /**
   * Validates the declarations, then constructs in dependency order. Nothing is
   * constructed until every refusal below has been ruled out.
   */
  async boot(options: {
    role: ServerRole;
    /** One slice per feature name, for the features that declared a config. */
    config?: Readonly<Record<string, unknown>>;
  }): Promise<BootedRuntime<Infrastructure>> {
    const { role } = options;
    const config = options.config ?? {};

    const declarations = this.features;
    // Providers first: the same feature declared twice is reported by the token
    // it claims twice, which is the thing a reader can act on. A feature that
    // provides nothing still gets the plainer refusal below.
    const providerOf = this.resolveProviders(declarations);
    this.assertUniqueFeatures(declarations);
    this.assertEveryDependencyProvided(declarations, providerOf, role);
    const order = orderByDependency(declarations, providerOf, role);

    const scope = new ResourceScope();
    const installed = new Map<string, InstalledFeatureState>();
    const provided = new Map<DependencyToken<unknown>, unknown>(this.preProvided);
    try {
      for (const declaration of order) {
        const resources = new ResourceScope();
        scope.own(declaration.name, () => resources.close());
        const state = declaration.install({
          resources,
          config: config[declaration.name],
          infrastructure: this.infrastructure,
          role,
          resolve: (token) => provided.get(token),
        });
        installed.set(declaration.name, state);
        for (const provider of declaration.providers) {
          provided.set(provider.token, provider.read(state.provided as never));
        }
      }
    } catch (error) {
      return cleanupAfterFailure(error, () => scope.close());
    }

    return new BootedRuntime(this.name, role, this.infrastructure, installed, provided, scope, [
      ...this.services,
    ]);
  }

  private assertUniqueFeatures(
    declarations: readonly DeclaredFeature[],
  ): void {
    const seen = new Set<string>();
    for (const declaration of declarations) {
      if (seen.has(declaration.name)) throw new DuplicateFeatureError(declaration.name);
      seen.add(declaration.name);
    }
  }

  /** Which feature answers for each token, refusing a token claimed twice. */
  private resolveProviders(
    declarations: readonly DeclaredFeature[],
  ): ReadonlyMap<DependencyToken<unknown>, string> {
    const providerOf = new Map<DependencyToken<unknown>, string>();
    for (const token of this.preProvided.keys()) {
      providerOf.set(token, "<provided by the application root>");
    }
    for (const declaration of declarations) {
      for (const provider of declaration.providers) {
        const existing = providerOf.get(provider.token);
        if (existing !== undefined) {
          throw new DuplicateProviderError(tokenName(provider.token), [existing, declaration.name]);
        }
        providerOf.set(provider.token, declaration.name);
      }
    }
    return providerOf;
  }

  private assertEveryDependencyProvided(
    declarations: readonly DeclaredFeature[],
    providerOf: ReadonlyMap<DependencyToken<unknown>, string>,
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

/** Names an application. Nothing is constructed until `boot`. */
export function createApp(options: { name: string }): {
  withInfrastructure<Infrastructure>(
    infrastructure: Infrastructure,
  ): ApplicationBuilder<Infrastructure>;
} {
  const name = options.name.trim();
  if (!name) throw new Error("An application needs a name.");
  return {
    withInfrastructure<Infrastructure>(infrastructure: Infrastructure) {
      return new ApplicationBuilder<Infrastructure>(name, infrastructure);
    },
  };
}

/** Every token one feature needs in this role, with the key that names it. */
function dependenciesFor(
  declaration: DeclaredFeature,
  role: ServerRole,
): ReadonlyArray<readonly [string, DependencyToken<unknown>]> {
  const always = Object.entries(declaration.dependencies);
  const transport = role === "api" ? Object.entries(declaration.transportDependencies) : [];
  return [...always, ...transport];
}

/**
 * Construction order: a feature is constructed after every feature that
 * provides something it needs. Depth-first, refusing a cycle by the path that
 * closed it rather than by a stack overflow ten frames later.
 */
function orderByDependency(
  declarations: readonly DeclaredFeature[],
  providerOf: ReadonlyMap<DependencyToken<unknown>, string>,
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
    for (const [, token] of dependenciesFor(declaration, role)) {
      const provider = providerOf.get(token);
      const dependency = provider === undefined ? undefined : byName.get(provider);
      if (dependency) visit(dependency);
    }
    path.pop();
    done.add(declaration.name);
    ordered.push(declaration);
  };

  for (const declaration of declarations) visit(declaration);
  return ordered;
}

function unavailable(feature: string, role: ServerRole, contribution: string): () => never {
  return () => {
    throw new RoleContributionError(feature, role, `${contribution} (unavailable)`);
  };
}
