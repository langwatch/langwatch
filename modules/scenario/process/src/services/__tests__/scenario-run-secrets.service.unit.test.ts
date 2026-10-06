import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import type { ScenarioSecretCipher } from "../../app/scenario.app.ts";
import { PrismaScenarioRepository } from "../../repositories/prisma/scenario.repository.ts";
import { ScenarioRunSecretsService } from "../scenario-run-secrets.service.ts";

class ReversibleCipher implements ScenarioSecretCipher {
  encrypt(plaintext: string): string {
    return `cipher:${plaintext}`;
  }

  decrypt(ciphertext: string): string {
    if (!ciphertext.startsWith("cipher:")) throw new Error("bad ciphertext");
    return ciphertext.slice("cipher:".length);
  }
}

/** The live repository over a reversible cipher: the service seals and opens through it. */
function sealedThroughTheRepository() {
  return PrismaScenarioRepository.create(createApiFixture<PrismaClient>(), new ReversibleCipher());
}

describe("ScenarioRunSecretsService", () => {
  it("keeps ciphertext durable while restoring the target-facing plaintext", () => {
    const secrets = ScenarioRunSecretsService.create(sealedThroughTheRepository());
    const encrypted = secrets.encrypt({ apiToken: "tok-live-abc" });

    expect(encrypted).toEqual({ apiToken: "cipher:tok-live-abc" });
    expect(secrets.decrypt(encrypted)).toEqual({ apiToken: "tok-live-abc" });
  });

  it("names the secret key without exposing an unreadable ciphertext", () => {
    const secrets = ScenarioRunSecretsService.create(sealedThroughTheRepository());

    expect(() => secrets.decrypt({ apiToken: "invalid:tok-live-abc" })).toThrow(
      'Secret parameter "apiToken" could not be decrypted for this run',
    );
  });
});
