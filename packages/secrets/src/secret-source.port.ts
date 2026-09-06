/**
 * One place a secret value can come from.
 *
 * `resolve` is batched rather than per-key so a source backed by a subprocess
 * or an HTTP call pays once per boot instead of once per variable. Absence is
 * a missing map entry, never an empty string and never a throw; a throw from
 * a source means the source itself failed (signed out, unreachable), which
 * needs different words than "that secret does not exist".
 *
 * An AWS Secrets Manager adapter drops in here unchanged: one class, one
 * `resolve`, no other seam to touch.
 */
export abstract class SecretSource {
  abstract readonly name: string;

  abstract resolve({ keys }: { keys: readonly string[] }): Promise<Map<string, string>>;
}
