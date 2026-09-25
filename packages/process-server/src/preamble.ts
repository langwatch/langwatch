/**
 * `Server.create("name")` starts this builder; `start()` runs fatal handlers, config parse, secrets
 * chain and preflight, telemetry, metrics. Order is load-bearing: config feeds secrets, both
 * precede telemetry.
 */
import process from "node:process";

import { ACTOR_SECRET_LOG_PATHS } from "@langwatch/actor";
import { parseProcessConfig, type ConfigOwner, type ProcessConfigOf } from "@langwatch/config";
import {
  refuseDoubleClaims,
  SecretsChain,
  SecretsResolver,
  type ScopedSecrets,
  type SecretHandle,
} from "@langwatch/secrets";

import { ProcessServer } from "./process-server.ts";
import type { ServerComponent, ServerContribution, ServerLogger } from "./server.ts";

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
  /** What every log record masks: the actor's secret fields. */
  redactPaths: readonly string[];
}>;

type ChainBuilder<Owners extends readonly PreambleOwner[]> = (
  config: ProcessConfigOf<Owners>,
  secrets: SecretsChain,
) => SecretsChain;

export class ServerPreamble<Owners extends readonly PreambleOwner[] = readonly []> {
  static create(name: string): ServerPreamble {
    return new ServerPreamble(name, {});
  }

  private constructor(
    private readonly name: string,
    private readonly state: Readonly<{
      owners?: Owners;
      chain?: ChainBuilder<Owners>;
      telemetry?: (context: FactoryContext<Owners>) => Telemetry | Promise<Telemetry>;
      metrics?: (context: FactoryContext<Owners>) => Metrics | Promise<Metrics>;
      healthPort?: number;
      ownsProcess?: boolean;
    }>,
  ) {}

  /** The installed owners, whose own schemas ARE the process config (§6). */
  withConfig<Next extends readonly PreambleOwner[]>(owners: Next): ServerPreamble<Next> {
    return new ServerPreamble<Next>(this.name, { owners });
  }

  /** The lookup order, built from a handed-in chain; config feeds it. */
  withSecrets(build: ChainBuilder<Owners>): ServerPreamble<Owners> {
    return new ServerPreamble(this.name, { ...this.state, chain: build });
  }

  withTelemetry(
    factory: (context: FactoryContext<Owners>) => Telemetry | Promise<Telemetry>,
  ): ServerPreamble<Owners> {
    return new ServerPreamble(this.name, { ...this.state, telemetry: factory });
  }

  withMetrics(
    factory: (context: FactoryContext<Owners>) => Metrics | Promise<Metrics>,
  ): ServerPreamble<Owners> {
    return new ServerPreamble(this.name, { ...this.state, metrics: factory });
  }

  withHealthPort(port: number | undefined): ServerPreamble<Owners> {
    if (port === undefined) {
      return this;
    }

    return new ServerPreamble(this.name, { ...this.state, healthPort: port });
  }

  withProcessOwnership(ownsProcess: boolean): ServerPreamble<Owners> {
    return new ServerPreamble(this.name, { ...this.state, ownsProcess });
  }

  async start(): Promise<ProcessServer> {
    const owners = this.state.owners ?? ([] as unknown as Owners);
    const environment = process.env;
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
    const telemetry = await this.state.telemetry?.({
      config,
      secrets: frameworkSecrets,
      redactPaths: ACTOR_SECRET_LOG_PATHS,
    });

    const boundary: Parameters<typeof ProcessServer.create>[0] = {
      name: this.name,
      logger: telemetry?.logger ?? silentLogger(),
      config,
      resolver,
      ownsProcess: this.state.ownsProcess,
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
        redactPaths: ACTOR_SECRET_LOG_PATHS,
      })) {
        server.with(contribution);
      }
    }

    return server;
  }
}

/** A process that composed no telemetry logs nowhere rather than crashing. */
function silentLogger(): ServerLogger {
  return { info: () => undefined, error: () => undefined };
}
