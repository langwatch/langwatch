// Builds id generators, clock, and secret cipher from encryption member
// (previously separate members of ScenarioApp)
import { generate } from "@langwatch/ksuid";
import { createLogger, type Logger } from "@langwatch/observability";
import type { Encryption } from "@langwatch/process-stores/members";
import { ScenarioSecretsUnavailableError } from "@langwatch/scenario-contract";
import { nowInstant, type Instant } from "@langwatch/time";

import type { SnapshotUpdateBroadcastSubscriberDeps } from "../eventing/snapshot-update-broadcast.subscriber.ts";
import { SimulationClickHouseRepository } from "../repositories/clickhouse/simulation-clickhouse.repository.ts";
import type { SimulationExecutionRepository } from "../repositories/simulation-execution.repository.ts";
import {
  SCENARIO_LOG_CONTEXT_ENV,
  type ScenarioLogContext,
  scenarioLogContextSchema,
} from "../rules/scenario-log-context.rules.ts";
import { SimulationService } from "../services/simulation.service.ts";
import type {
  ScenarioClock,
  ScenarioId,
  ScenarioReadOnlyClickHouse,
  ScenarioSecretCipher,
  ScenarioTestSuiteId,
} from "./scenario.app.ts";

const SCENARIO_KSUID_RESOURCE = "scenario";

/**
 * The app's KSUID resource for a test suite's folder id
 * (`KSUID_RESOURCES.SCENARIO_TEST_SUITE`): `suite_` is the format the
 * other tier already reads, so it belongs with the writer.
 */
const SCENARIO_TEST_SUITE_KSUID_RESOURCE = "suite";

/** The scenario id, in the persisted ksuid format the other tier reads. */
class KsuidScenarioId implements ScenarioId {
  next(): string {
    return generate(SCENARIO_KSUID_RESOURCE).toString();
  }
}

/** The folder id, in the `suite_` format the other tier reads. */
class KsuidScenarioTestSuiteId implements ScenarioTestSuiteId {
  next(): string {
    return generate(SCENARIO_TEST_SUITE_KSUID_RESOURCE).toString();
  }
}

class SystemScenarioClock implements ScenarioClock {
  now(): Instant {
    return nowInstant();
  }
}

/** A scenario's stored secret, under the deployment's own cipher. */
class ApiScenarioSecretCipher implements ScenarioSecretCipher {
  constructor(private readonly encryption: Encryption) {}

  encrypt(plaintext: string): string {
    return this.encryption.encrypt(plaintext);
  }

  decrypt(ciphertext: string): string {
    return this.encryption.decrypt(ciphertext);
  }
}

/**
 * A scenario secret this deployment can neither write nor read. Kept for a
 * process reading no `encryption` member; one that DOES declare the read
 * gets a real one at boot, per the closed member set's own contract.
 */
class UnavailableScenarioSecretCipher implements ScenarioSecretCipher {
  encrypt(): string {
    throw new ScenarioSecretsUnavailableError();
  }

  decrypt(): string {
    throw new ScenarioSecretsUnavailableError();
  }
}

/**
 * Adapts the process's ONE routing `clickhouse` member to the per-tenant
 * session the simulation repository was written against.
 */
class ScenarioClickHouseSession {
  constructor(
    private readonly clickhouse: ScenarioReadOnlyClickHouse,
    private readonly tenantId: string,
  ) {}

  async query(input: {
    query: string;
    query_params: Record<string, unknown>;
    format: "JSONEachRow";
  }): Promise<{ json<Result>(): Promise<Result[]> }> {
    const { rows } = await this.clickhouse.query<unknown>({
      tenantId: this.tenantId,
      sql: input.query,
      params: input.query_params,
    });

    return { json: <Result>() => Promise.resolve(rows as Result[]) };
  }
}

/**
 * What this process hands `ScenarioApp` at boot, built from its own members
 * and three pure ports. `simulations` is the reads the ClickHouse member
 * makes derivable — absent only where the deployment composed no ClickHouse.
 */
export function buildScenarioComposition(input: {
  encryption: Encryption | undefined;
  clickhouse: ScenarioReadOnlyClickHouse | undefined;
  /** The simulation writes, sent through simulation_processing's own commands. */
  execution: SimulationExecutionRepository;
}): {
  ids: ScenarioId;
  testSuiteIds: ScenarioTestSuiteId;
  clock: ScenarioClock;
  secretCipher: ScenarioSecretCipher;
  simulations: SimulationService | undefined;
} {
  const { clickhouse } = input;

  return {
    ids: new KsuidScenarioId(),
    testSuiteIds: new KsuidScenarioTestSuiteId(),
    clock: new SystemScenarioClock(),
    secretCipher: input.encryption
      ? new ApiScenarioSecretCipher(input.encryption)
      : new UnavailableScenarioSecretCipher(),
    simulations: clickhouse
      ? SimulationService.create(
          SimulationClickHouseRepository.create((tenantId) =>
            Promise.resolve(new ScenarioClickHouseSession(clickhouse, tenantId)),
          ),
          input.execution,
        )
      : void 0,
  };
}

/** No module offers scenario a tenant broadcast yet; main without Redis skipped it too. */
export function undeliveredSnapshotUpdates(): SnapshotUpdateBroadcastSubscriberDeps {
  return { broadcastUpdate: () => Promise.resolve() };
}

/**
 * Decode an env var value into a logger context object. Returns an empty
 * object when unset or malformed, never throwing; malformed JSON warns on
 * stderr so it's still visible during incident response.
 */
export function decodeScenarioLogContext(raw: string | undefined): ScenarioLogContext {
  if (!raw) {
    return {};
  }
  try {
    const parsed = scenarioLogContextSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    process.stderr.write(
      `[child-logger] ${SCENARIO_LOG_CONTEXT_ENV} is not valid JSON; ignoring\n`,
    );
    return {};
  }
}

/**
 * Build the base logger for a scenario child process: reads the context
 * env var, decodes it, and returns a child logger bound to those fields.
 * Call once at the top of `scenario-child-process.ts`.
 */
export function createChildProcessLogger(name: string, env: NodeJS.ProcessEnv): Logger {
  const context = decodeScenarioLogContext(env[SCENARIO_LOG_CONTEXT_ENV]);
  const base = createLogger(name);
  if (Object.keys(context).length === 0) {
    return base;
  }
  return base.child(context);
}
