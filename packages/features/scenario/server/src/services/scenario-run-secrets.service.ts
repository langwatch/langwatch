import type { RunSecretCiphertext } from "@langwatch/scenario-contract";
import type { ScenarioSecretCipherPort } from "../ports/scenario-secret-cipher.port";

/** Owns the durable encryption boundary for per-run secret parameters. */
export class ScenarioRunSecretsService {
  static create(cipherPort: ScenarioSecretCipherPort): ScenarioRunSecretsService {
    return new ScenarioRunSecretsService(cipherPort);
  }

  private constructor(private readonly cipherPort: ScenarioSecretCipherPort) {}

  encrypt(values: Record<string, string>): RunSecretCiphertext {
    return Object.fromEntries(
      Object.entries(values).map(([name, value]) => [
        name,
        this.cipherPort.encrypt(value),
      ]),
    );
  }

  decrypt(values: RunSecretCiphertext): Record<string, string> {
    return Object.fromEntries(
      Object.entries(values).map(([name, ciphertext]) => {
        try {
          return [name, this.cipherPort.decrypt(ciphertext)];
        } catch {
          throw new Error(
            `Secret parameter "${name}" could not be decrypted for this run`,
          );
        }
      }),
    );
  }
}
