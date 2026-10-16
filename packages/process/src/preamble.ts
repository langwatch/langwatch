/**
 * `Server.create("name")` starts this builder; `start()` runs fatal handlers, config parse, secrets
 * chain and preflight, telemetry, metrics. Order is load-bearing: config feeds secrets, both
 * precede telemetry.
 */
import { SESSION_SECRET_LOG_PATHS } from "@langwatch/authorization";
import { parseProcessConfig, type ConfigOwner, type ProcessConfigOf } from "@langwatch/config";
import { createLogger } from "@langwatch/observability";
import {
  refuseDoubleClaims,
  SecretsChain,
  SecretsResolver,
  type ScopedSecrets,
  type SecretHandle,
  secretLogRedactPaths,
} from "@langwatch/secrets";

import type { IdIndexRetention } from "./migration/id-index-fill-step.ts";
import {
  assertGatedRole,
  type UpgradeGatedRole,
  type UpgradeGate,
  type UpgradeGateModules,
} from "./migration/upgrade-gate.ts";
import { isProcessModule } from "./process-container.ts";
import { setProcessGlobals } from "./process-globals.ts";
import { ProcessServer } from "./process-server.ts";
import {
  Server as ServerBoundary,
  type ServerComponent,
  type ServerContribution,
  type ServerLogger,
  type ServerOptions,
} from "./server.ts";

/** An owner as the preamble reads one: a name, and what it declared (§6). */
export type PreambleOwner = ConfigOwner &
  Readonly<{ secrets?: Readonly<Record<string, SecretHandle<unknown>>> }>;

/** What a telemetry factory answers with: the process logger, plus lifecycle. */
export type Telemetry = Readonly<{ logger: ServerLogger; component?: ServerComponent }>;

/**
 * What a metrics factory answers with. A push transport is one lifecycle
 * component; a scrape transport is that plus the door it is read through.
 */
export type Metrics = readonly ServerContribution[];

type FactoryContext<Owners extends readonly PreambleOwner[]> = Readonly<{
  config: ProcessConfigOf<Owners>;
  secrets: ScopedSecrets;
  /** What every log record masks: the actor's secret fields and every declared secret. */
  redactPaths: readonly string[];
}>;

/** Metrics also get the process logger, so boot names a scrape door it left unmounted. */
type MetricsContext<Owners extends readonly PreambleOwner[]> = FactoryContext<Owners> &
  Readonly<{ logger: ServerLogger }>;

/** The environment the process was started with, as its main hands it in. */
export type PreambleEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * The serving gate's factory: resolves what it needs before boot seals secrets, opens nothing.
 * The worker is also handed the environment and its modules, to run the upgrade in-process.
 */
type UpgradeGateFactory<Owners extends readonly PreambleOwner[]> = (
  context: FactoryContext<Owners> &
    Readonly<{
      role: UpgradeGatedRole;
      environment: PreambleEnvironment;
      bootModules?: UpgradeGateModules;
    }>,
) => UpgradeGate | Promise<UpgradeGate>;

/** What `start` and `runUpgradeOnce` both read before anything else: config and secrets. */
type Prepared<Owners extends readonly PreambleOwner[]> = Readonly<{
  owners: Owners;
  environment: PreambleEnvironment;
  config: ProcessConfigOf<Owners>;
  resolver: SecretsResolver;
  frameworkSecrets: ScopedSecrets;
  redactPaths: readonly string[];
}>;

type ChainBuilder<Owners extends readonly PreambleOwner[]> = (
  config: ProcessConfigOf<Owners>,
  secrets: SecretsChain,
) => SecretsChain;

export class ServerPreamble<Owners extends readonly PreambleOwner[] = readonly []> {
  static create(name: string): ServerPreamble {
    return new ServerPreamble(name, { owners: [] });
  }

  private constructor(
    private readonly name: string,
    private readonly state: Readonly<{
      owners: Owners;
      chain?: ChainBuilder<Owners>;
      telemetry?: (context: FactoryContext<Owners>) => Telemetry | Promise<Telemetry>;
      metrics?: (context: MetricsContext<Owners>) => Metrics | Promise<Metrics>;
      healthPort?: number;
      ownsProcess?: boolean;
      environment?: PreambleEnvironment;
      upgradeGate?: Readonly<{ role: UpgradeGatedRole; gate: UpgradeGateFactory<Owners> }>;
      idIndexRetention?: IdIndexRetention;
    }>,
  ) {}

  /** The installed owners, whose own schemas ARE the process config (§6). */
  withConfig<Next extends readonly PreambleOwner[]>(owners: Next): ServerPreamble<Next> {
    return new ServerPreamble<Next>(this.name, { owners, environment: this.state.environment });
  }

  /** The lookup order, built from a handed-in chain; config feeds it. */
  withSecrets(build: ChainBuilder<Owners>): ServerPreamble<Owners> {
    return new ServerPreamble(this.name, { ...this.state, chain: build });
  }

  /**
   * The serving gate (D5): api and worker refuse to start, by name, when the installation is
   * behind their image, and write a roster entry once admitted. Tasks is never gated.
   */
  withUpgradeGate({
    role,
    gate,
  }: Readonly<{
    role: UpgradeGatedRole;
    gate: UpgradeGateFactory<Owners>;
  }>): ServerPreamble<Owners> {
    assertGatedRole(role);
    return new ServerPreamble(this.name, { ...this.state, upgradeGate: { role, gate } });
  }

  /**
   * How each module's id-index fill raises its indexes' retention before their ready markers:
   * the application passes a function over the retention owner's API (id-index plan §3).
   */
  withIdIndexRetention(raise: IdIndexRetention): ServerPreamble<Owners> {
    return new ServerPreamble(this.name, { ...this.state, idIndexRetention: raise });
  }

  withTelemetry(
    factory: (context: FactoryContext<Owners>) => Telemetry | Promise<Telemetry>,
  ): ServerPreamble<Owners> {
    return new ServerPreamble(this.name, { ...this.state, telemetry: factory });
  }

  withMetrics(
    factory: (context: MetricsContext<Owners>) => Metrics | Promise<Metrics>,
  ): ServerPreamble<Owners> {
    return new ServerPreamble(this.name, { ...this.state, metrics: factory });
  }

  withHealthPort(port: number | undefined): ServerPreamble<Owners> {
    if (port === undefined) {
      return this;
    }

    return new ServerPreamble(this.name, { ...this.state, healthPort: port });
  }

  /** What config and the secrets chain read; only an app's main hands the environment in. */
  withEnvironment(environment: PreambleEnvironment): ServerPreamble<Owners> {
    return new ServerPreamble(this.name, { ...this.state, environment });
  }

  withProcessOwnership(ownsProcess: boolean): ServerPreamble<Owners> {
    return new ServerPreamble(this.name, { ...this.state, ownsProcess });
  }

  /** Config, the secrets chain and its preflight: what `start` and `runUpgradeOnce` share. */
  private async prepare(): Promise<Prepared<Owners>> {
    const owners = this.state.owners;
    const environment = this.state.environment;
    if (!environment) {
      throw new Error(`${this.name}: the preamble starts only after withEnvironment(...)`);
    }
    const config = parseProcessConfig({ owners, environment });
    // Before any module is built, so no id is minted without the install's prefix.
    if (this.state.ownsProcess !== false) setProcessGlobals({ environment });

    const chain = (this.state.chain ?? ((_, secrets) => secrets.withEnv()))(
      config,
      SecretsChain.start({ environment }),
    );
    const resolver = SecretsResolver.over(chain);
    // One credential declared by two owners is two claims on it, and which
    // one this deployment meant would be a guess.
    refuseDoubleClaims(owners);
    const declared = owners.flatMap((owner) => Object.values(owner.secrets ?? {}));
    await resolver.preflight(declared);

    const frameworkSecrets = resolver.scopeTo(this.name, declared);
    const redactPaths = [...SESSION_SECRET_LOG_PATHS, ...secretLogRedactPaths(declared)];
    return { owners, environment, config, resolver, frameworkSecrets, redactPaths };
  }

  /** The gate this preamble composed, over the prepared config and secrets; the worker's runs. */
  private async gateOver({
    prepared,
    gate: { role, gate },
  }: {
    prepared: Prepared<Owners>;
    gate: Readonly<{ role: UpgradeGatedRole; gate: UpgradeGateFactory<Owners> }>;
  }): Promise<UpgradeGate> {
    const { config, frameworkSecrets, redactPaths, environment } = prepared;
    return gate({
      config,
      secrets: frameworkSecrets,
      redactPaths,
      role,
      environment,
      ...(role === "worker" ? { bootModules: this.bootModulesInTasksRole() } : {}),
    });
  }

  /**
   * The installed list booted in the tasks role inside this process, as `withTasksApp` does in
   * the tasks app: its own server, no telemetry of its own, closed once `use` settles.
   */
  private bootModulesInTasksRole(): UpgradeGateModules {
    const { owners, chain, environment } = this.state;
    const { idIndexRetention } = this.state;
    return async (use) => {
      const server = await new ServerPreamble(`${this.name}-upgrade`, {
        owners,
        ...(chain ? { chain } : {}),
        ...(environment ? { environment } : {}),
        ...(idIndexRetention ? { idIndexRetention } : {}),
        healthPort: 0,
        ownsProcess: false,
      }).start();
      try {
        const app = await server.container("tasks").boot();
        await server.run(app);
        return await use(app);
      } finally {
        await server.close();
      }
    };
  }

  /**
   * Runs the upgrade once and answers its exit code (0 done, 1 failed, 3 lease not acquired):
   * `pnpm task upgrade` starts the worker this way (Alex, 2026-10-11, slice 2).
   */
  async runUpgradeOnce(): Promise<number> {
    const upgradeGate = this.state.upgradeGate;
    if (!upgradeGate) throw new Error(`${this.name}: runUpgradeOnce needs withUpgradeGate(...)`);
    const prepared = await this.prepare();
    const gate = await this.gateOver({ prepared, gate: upgradeGate });
    try {
      if (!gate.runOnce) throw new Error(`${this.name}: this gate cannot run the upgrade`);
      return await gate.runOnce();
    } finally {
      await gate.release();
    }
  }

  async start(): Promise<ProcessServer> {
    const prepared = await this.prepare();
    const { owners, config, resolver, frameworkSecrets, redactPaths } = prepared;
    const telemetry = await this.state.telemetry?.({
      config,
      secrets: frameworkSecrets,
      redactPaths,
    });

    const boundary: Parameters<typeof ProcessServer.create>[0] = {
      name: this.name,
      logger: telemetry?.logger ?? hostLogger(this.name),
      config,
      resolver,
      ownsProcess: this.state.ownsProcess,
      modules: owners.filter(isProcessModule),
      ...(this.state.idIndexRetention ? { idIndexRetention: this.state.idIndexRetention } : {}),
    };

    if (this.state.healthPort !== undefined) {
      boundary.healthPort = this.state.healthPort;
    }

    const server = ProcessServer.create(boundary);

    if (telemetry?.component) server.with(telemetry.component);

    if (this.state.metrics) {
      for (const contribution of await this.state.metrics({
        config,
        secrets: frameworkSecrets,
        redactPaths,
        logger: boundary.logger,
      })) {
        server.with(contribution);
      }
    }

    // Hosted before boot's components: asked before the application starts, stopped after it.
    const upgradeGate = this.state.upgradeGate;
    if (upgradeGate) {
      const gate = await this.gateOver({ prepared, gate: upgradeGate });
      server.hostUpgradeGate({ role: upgradeGate.role, gate, logger: boundary.logger });
    }

    return server;
  }
}

/**
 * A process that composed no telemetry (an api embedded beside the worker) still logs: telemetry
 * owns exporters, not lines. Taken per line, so it writes as the host configured logging.
 */
function hostLogger(name: string): ServerLogger {
  const logger = () => createLogger(`langwatch:${name}`);
  return {
    info: (fields, line) => logger().info(fields, line),
    warn: (fields, line) => logger().warn(fields, line),
    error: (fields, line) => logger().error(fields, line),
  };
}

export class Server extends ServerBoundary {
  static create(name: string): ServerPreamble;
  static create(options: ServerOptions): ServerBoundary;
  static create(value: string | ServerOptions): ServerPreamble | ServerBoundary {
    if (typeof value === "string") return ServerPreamble.create(value);
    return ServerBoundary.create(value);
  }
}
