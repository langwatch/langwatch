// Builds id generators, clock, and secret cipher from encryption member
// (previously separate members of ScenarioApp)
import { generate } from "@langwatch/ksuid";
import type { Encryption } from "@langwatch/process-stores/members";
import {
  ScenarioSecretsUnavailableError,
  ScenarioSimulationWritesUnavailableError,
} from "@langwatch/scenario-contract";
import { nowInstant, type Instant } from "@langwatch/time";

import { SimulationClickHouseRepository } from "../repositories/clickhouse/simulation-clickhouse.repository.ts";
import { SimulationExecutionRepository } from "../repositories/simulation-execution.repository.ts";
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
 * The write half of the simulation pipeline, for a process that composed only
 * the reads. Every dispatch refuses by name: the worker that drains the
 * pipeline owns these, and a silent no-op would lose the run.
 */
class ReadOnlySimulationExecution extends SimulationExecutionRepository {
  queueRun(): Promise<never> {
    return this.refuse("queue a simulation run");
  }
  startRun(): Promise<never> {
    return this.refuse("start a simulation run");
  }
  messageSnapshot(): Promise<never> {
    return this.refuse("record a simulation message");
  }
  textMessageStart(): Promise<never> {
    return this.refuse("record a message start");
  }
  textMessageEnd(): Promise<never> {
    return this.refuse("record a message end");
  }
  finishRun(): Promise<never> {
    return this.refuse("finish a simulation run");
  }
  recordEvaluations(): Promise<never> {
    return this.refuse("record a simulation run's evaluator results");
  }
  cancelRun(): Promise<never> {
    return this.refuse("cancel a simulation run");
  }
  deleteRun(): Promise<never> {
    return this.refuse("delete a simulation run");
  }
  recordAgentInstance(): Promise<never> {
    return this.refuse("record the agent instance that served a simulation run");
  }

  private refuse(capability: string): Promise<never> {
    return Promise.reject(new ScenarioSimulationWritesUnavailableError(capability));
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
          new ReadOnlySimulationExecution(),
        )
      : void 0,
  };
}
