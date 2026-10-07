/**
 * `Server.create("name")` starts this builder; `start()` runs fatal handlers, config parse, secrets
 * chain and preflight, telemetry, metrics. Order is load-bearing: config feeds secrets, both
 * precede telemetry.
 */
import { SESSION_SECRET_LOG_PATHS } from "@langwatch/authorization";
import { parseProcessConfig, type ConfigOwner, type ProcessConfigOf } from "@langwatch/config";
import {
  refuseDoubleClaims,
  SecretsChain,
  SecretsResolver,
  type ScopedSecrets,
  type SecretHandle,
  secretLogRedactPaths,
} from "@langwatch/secrets";

import { isProcessModule } from "./process-container.ts";
import { ProcessServer } from "./process-server.ts";
import {
  Server as ServerBoundary,
  type ServerComponent,
  type ServerContribution,
  type ServerLogger,
  type ServerOptions,
} from "./server.ts";
import { assertGatedRole, type UpgradeGatedRole, type UpgradeGate } from "./upgrade-gate.ts";

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

/** The serving gate's factory: resolves what it needs before boot seals secrets, opens nothing. */
type UpgradeGateFactory<Owners extends readonly PreambleOwner[]> = (
  context: FactoryContext<Owners> & Readonly<{ role: UpgradeGatedRole }>,
) => UpgradeGate | Promise<UpgradeGate>;

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
   * behind their image, and write presence once admitted. Tasks is never gated.
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

  async start(): Promise<ProcessServer> {
    const owners = this.state.owners;
    const environment = this.state.environment;
    if (!environment) {
      throw new Error(`${this.name}: the preamble starts only after withEnvironment(...)`);
    }
    const config = parseProcessConfig({ owners, environment });

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
    const telemetry = await this.state.telemetry?.({
      config,
      secrets: frameworkSecrets,
      redactPaths,
    });

    const boundary: Parameters<typeof ProcessServer.create>[0] = {
      name: this.name,
      logger: telemetry?.logger ?? silentLogger(),
      config,
      resolver,
      ownsProcess: this.state.ownsProcess,
      modules: owners.filter(isProcessModule),
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
      const { role } = upgradeGate;
      const gate = await upgradeGate.gate({ config, secrets: frameworkSecrets, redactPaths, role });
      server.hostUpgradeGate({ role, gate, logger: boundary.logger });
    }

    return server;
  }
}

/** A process that composed no telemetry logs nowhere rather than crashing. */
function silentLogger(): ServerLogger {
  return { info: () => undefined, error: () => undefined };
}

export class Server extends ServerBoundary {
  static create(name: string): ServerPreamble;
  static create(options: ServerOptions): ServerBoundary;
  static create(value: string | ServerOptions): ServerPreamble | ServerBoundary {
    if (typeof value === "string") return ServerPreamble.create(value);
    return ServerBoundary.create(value);
  }
}
