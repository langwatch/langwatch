/**
 * Builds four of the small ports `ScenarioApp` used to receive as members
 * (`apps/api/src/features/scenario/scenario.composition.ts`, deleted by
 * b383462d96): the scenario and test-suite id generators, the clock, and the
 * stored-secret cipher. `ScenarioApp.create` now builds them itself from the
 * one member it reads — `encryption` — since none of the four needs anything
 * else from the process.
 *
 * The remaining pre-b383462d96 collaborators (`agentTesting`,
 * `scenarioExecution`, `simulations`, `scenarioTabs`, `resultAtoms`,
 * `runConfigurations`, `broadcast`, `activity`, `publicBaseUrl`) still arrive
 * as members/dependencies exactly as they did before this change; see the
 * scenario-composition-green handover for the triage recorded there.
 */
import { generate } from "@langwatch/ksuid";
import { nanoid } from "nanoid";
import { nowInstant, toDate } from "@langwatch/time";
import { HandledError } from "@langwatch/handled-error";
import type { Encryption } from "@langwatch/infrastructure/members";
import type {
  ScenarioClock,
  ScenarioId,
  ScenarioSecretCipher,
  ScenarioTestSuiteId,
} from "./scenario.app.ts";

const SCENARIO_KSUID_RESOURCE = "scenario";

/** The scenario id, in the persisted ksuid format the other tier reads. */
class KsuidScenarioId implements ScenarioId {
  next(): string {
    return generate(SCENARIO_KSUID_RESOURCE).toString();
  }
}

/** The folder id, in the `suite_` format the other tier reads. */
class NanoidScenarioTestSuiteId implements ScenarioTestSuiteId {
  next(): string {
    return `suite_${nanoid()}`;
  }
}

class SystemScenarioClock implements ScenarioClock {
  now(): Date {
    return toDate(nowInstant());
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

/** Refuses decryption without the deployment key before a provider receives invalid credentials. */
export class ScenarioSecretsUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor() {
    super(
      "service_unavailable",
      "This deployment cannot store or read scenario secrets, because it has no encryption key configured.",
      { httpStatus: 503, fault: "platform" },
    );
    this.name = "ScenarioSecretsUnavailableError";
  }
}

/**
 * A scenario secret this deployment can neither write nor read. Kept for a
 * process that reads no `encryption` member at all; a process that DOES
 * declare the read is handed a real one by boot, per the closed member set's
 * own contract (ADR: a declared read either resolves or refuses the module).
 */
class UnavailableScenarioSecretCipher implements ScenarioSecretCipher {
  encrypt(): string {
    throw new ScenarioSecretsUnavailableError();
  }

  decrypt(): string {
    throw new ScenarioSecretsUnavailableError();
  }
}

/** What this process hands `ScenarioApp` at boot, built from its own member and three pure ports. */
export function buildScenarioComposition(input: { encryption: Encryption | undefined }): {
  ids: ScenarioId;
  testSuiteIds: ScenarioTestSuiteId;
  clock: ScenarioClock;
  secretCipher: ScenarioSecretCipher;
} {
  return {
    ids: new KsuidScenarioId(),
    testSuiteIds: new NanoidScenarioTestSuiteId(),
    clock: new SystemScenarioClock(),
    secretCipher: input.encryption
      ? new ApiScenarioSecretCipher(input.encryption)
      : new UnavailableScenarioSecretCipher(),
  };
}
