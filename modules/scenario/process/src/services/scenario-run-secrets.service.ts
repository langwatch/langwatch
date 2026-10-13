import type { RunSecretCiphertext } from "@langwatch/scenario-contract";

import type { ScenarioRunSecretSeal } from "../repositories/scenario.repository.ts";

/** A run's secret parameters, sealed and opened one by one through the scenario repository. */
export class ScenarioRunSecretsService {
  static create(seal: ScenarioRunSecretSeal): ScenarioRunSecretsService {
    return new ScenarioRunSecretsService(seal);
  }

  private constructor(private readonly seal: ScenarioRunSecretSeal) {}

  encrypt(values: Record<string, string>): RunSecretCiphertext {
    return Object.fromEntries(
      Object.entries(values).map(([name, value]) => [
        name,
        this.seal.sealRunSecret({ plain: value }),
      ]),
    );
  }

  decrypt(values: RunSecretCiphertext): Record<string, string> {
    return Object.fromEntries(
      Object.entries(values).map(([name, ciphertext]) => {
        try {
          return [name, this.seal.openRunSecret({ sealed: ciphertext })];
        } catch {
          throw new Error(`Secret parameter "${name}" could not be decrypted for this run`);
        }
      }),
    );
  }
}
