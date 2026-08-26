import { describe, expect, it } from "vitest";
import { ScenarioSecretCipherPort } from "../src";
import { ScenarioRunSecretsService } from "../src/services/scenario-run-secrets.service";

class ReversibleCipherPort extends ScenarioSecretCipherPort {
  encrypt(plaintext: string): string {
    return `cipher:${plaintext}`;
  }

  decrypt(ciphertext: string): string {
    if (!ciphertext.startsWith("cipher:")) throw new Error("bad ciphertext");
    return ciphertext.slice("cipher:".length);
  }
}

describe("ScenarioRunSecretsService", () => {
  it("keeps ciphertext durable while restoring the target-facing plaintext", () => {
    const secrets = ScenarioRunSecretsService.create(new ReversibleCipherPort());
    const encrypted = secrets.encrypt({ apiToken: "tok-live-abc" });

    expect(encrypted).toEqual({ apiToken: "cipher:tok-live-abc" });
    expect(secrets.decrypt(encrypted)).toEqual({ apiToken: "tok-live-abc" });
  });

  it("names the secret key without exposing an unreadable ciphertext", () => {
    const secrets = ScenarioRunSecretsService.create(new ReversibleCipherPort());

    expect(() => secrets.decrypt({ apiToken: "invalid:tok-live-abc" })).toThrow(
      'Secret parameter "apiToken" could not be decrypted for this run',
    );
  });
});
