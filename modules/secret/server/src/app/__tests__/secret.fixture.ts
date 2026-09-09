import { ResourceScope } from "@langwatch/runtime-composition";
import { SecretEncryptionPort } from "../../ports/secret.port.ts";
import { MemorySecretRepositories } from "../../repositories/memory/memory.secret.repositories.ts";
import type { SecretRepositories } from "../../repositories/secret.repositories.ts";
import { SecretApp } from "../secret.app.ts";

/**
 * A reversible stand-in for AES-GCM. It is not a cipher and does not pretend
 * to be one: what a service test needs from encryption is that what went in
 * comes back and that a ciphertext is not the plaintext.
 */
export class ReversibleTestSecretEncryption extends SecretEncryptionPort {
  encrypt(value: string): string {
    return `encrypted(${value})`;
  }

  decrypt(value: string): string {
    return value.replace(/^encrypted\((.*)\)$/, "$1");
  }
}

export function createSecretTestApp(
  input: Readonly<{
    repositories?: SecretRepositories;
    encryption?: SecretEncryptionPort;
  }> = {},
): SecretApp {
  return SecretApp.create({
    repositories: input.repositories ?? MemorySecretRepositories.create(),
    dependencies: {},
    infrastructure: { encryption: input.encryption ?? new ReversibleTestSecretEncryption() },
    config: void 0,
    resources: new ResourceScope(),
  });
}
