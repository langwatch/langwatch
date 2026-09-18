import type { RunSecretCiphertext } from "@langwatch/scenario-contract";
import type { ScenarioSecretCipher } from "../app/scenario.app.ts";

/** Owns the durable encryption boundary for per-run secret parameters. */
export class ScenarioRunSecretsService {
  static create(cipherPort: ScenarioSecretCipher): ScenarioRunSecretsService {
    return new ScenarioRunSecretsService(cipherPort);
  }

  private constructor(private readonly cipherPort: ScenarioSecretCipher) {}

  encrypt(values: Record<string, string>): RunSecretCiphertext {
    return Object.fromEntries(
      Object.entries(values).map(([name, value]) => [name, this.cipherPort.encrypt(value)]),
    );
  }

  decrypt(values: RunSecretCiphertext): Record<string, string> {
    return Object.fromEntries(
      Object.entries(values).map(([name, ciphertext]) => {
        try {
          return [name, this.cipherPort.decrypt(ciphertext)];
        } catch {
          throw new Error(`Secret parameter "${name}" could not be decrypted for this run`);
        }
      }),
    );
  }
}
