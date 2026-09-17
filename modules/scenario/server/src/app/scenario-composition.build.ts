// Builds id generators, clock, and secret cipher from encryption member
// (previously separate members of ScenarioApp)
import { generate } from "@langwatch/ksuid";
import { nowInstant, type Instant } from "@langwatch/time";
import { ScenarioSecretsUnavailableError } from "@langwatch/scenario-contract";
import type { Encryption } from "@langwatch/infrastructure/members";
import type {
  ScenarioClock,
  ScenarioId,
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
 * What this process hands `ScenarioApp` at boot, built from its own member
 * and three pure ports.
 */
export function buildScenarioComposition(input: { encryption: Encryption | undefined }): {
  ids: ScenarioId;
  testSuiteIds: ScenarioTestSuiteId;
  clock: ScenarioClock;
  secretCipher: ScenarioSecretCipher;
} {
  return {
    ids: new KsuidScenarioId(),
    testSuiteIds: new KsuidScenarioTestSuiteId(),
    clock: new SystemScenarioClock(),
    secretCipher: input.encryption
      ? new ApiScenarioSecretCipher(input.encryption)
      : new UnavailableScenarioSecretCipher(),
  };
}
