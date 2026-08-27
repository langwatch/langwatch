/**
 * Encrypts and decrypts the secret parameter values a run supplies.
 *
 * A secret value crosses two boundaries it must not cross in clear: the queued
 * event, which is durable, and the process-manager inbox and outbox rows, which
 * are durable too. It is encrypted at the request that starts the run and
 * decrypted once, in the prefetch that builds the child's job, so nothing in
 * between holds a readable credential.
 *
 * @see specs/scenarios/secret-run-parameters.feature
 */

import type { RunSecretCiphertext } from "@langwatch/scenario-contract";
import { decrypt, encrypt } from "~/utils/encryption";

/**
 * Ciphertext keyed by parameter name.
 *
 * Deliberately not `runParameterValuesSchema`: that schema caps a value at
 * 4096 characters, and the hex envelope of a long secret is larger than the
 * secret itself, so reusing it would reject values the plain path accepts.
 */
/** Encrypts each supplied secret value, keeping the names in clear. */
export function encryptRunSecretValues(values: Record<string, string>): RunSecretCiphertext {
  return Object.fromEntries(Object.entries(values).map(([name, value]) => [name, encrypt(value)]));
}

/**
 * Decrypts each value back for delivery to the target.
 *
 * A failure names the parameter and nothing else. The usual cause is a
 * CREDENTIALS_SECRET that changed between the request and the run, and the run
 * fails closed: a target that ran with a missing credential would report a
 * result about the credential, not about the scenario.
 */
export function decryptRunSecretValues(values: RunSecretCiphertext): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([name, ciphertext]) => {
      try {
        return [name, decrypt(ciphertext)];
      } catch {
        throw new Error(`Secret parameter "${name}" could not be decrypted for this run`);
      }
    }),
  );
}
