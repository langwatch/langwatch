import { z } from "zod";
import registryData from "../keys.json" with { type: "json" };

/**
 * The four classes an environment variable falls into. Only `secret` and
 * `composite` carry a credential; `pointer` names one on disk and `config`
 * is everything else, which is free to appear in a log line verbatim.
 */
export const secretClassSchema = z.enum(["secret", "composite", "pointer", "config"]);

export type SecretClass = z.infer<typeof secretClassSchema>;

/** What a development machine is expected to do when the key is absent. */
export const secretDevPolicySchema = z.enum(["generate", "required", "optional"]);

export type SecretDevPolicy = z.infer<typeof secretDevPolicySchema>;

export const secretRegistryEntrySchema = z.object({
  key: z.string().min(1),
  class: secretClassSchema.exclude(["config"]),
  dev: secretDevPolicySchema,
});

export type SecretRegistryEntry = z.infer<typeof secretRegistryEntrySchema>;

export const secretRegistrySchema = z.object({
  version: z.number().int().positive(),
  keys: z.array(secretRegistryEntrySchema).min(1),
});

export type SecretRegistry = z.infer<typeof secretRegistrySchema>;

/**
 * `keys.json` is the one source of truth for the classification: this module
 * parses it, and haven reads the same file in Go so a key added here is masked
 * there without a second list to keep in step.
 */
export const SECRET_REGISTRY: SecretRegistry = secretRegistrySchema.parse(registryData);

const BY_KEY: ReadonlyMap<string, SecretRegistryEntry> = new Map(
  SECRET_REGISTRY.keys.map((entry) => [entry.key, entry]),
);

function keysOfClass(secretClass: SecretClass): readonly string[] {
  return SECRET_REGISTRY.keys.filter((entry) => entry.class === secretClass).map(({ key }) => key);
}

/** Every rotating credential, sorted. Never printed, logged, or written by tooling. */
export const SECRET_KEYS: readonly string[] = keysOfClass("secret");

/** Shape and credential in one string, redacted structurally rather than wholesale. */
export const COMPOSITE_KEYS: readonly string[] = keysOfClass("composite");

/** Names a credential on disk; the file it names is the vault's problem. */
export const POINTER_KEYS: readonly string[] = keysOfClass("pointer");

/** The keys the two generate-on-first-run scripts are allowed to write into `.env`. */
export const DEV_GENERATED_KEYS: readonly string[] = SECRET_REGISTRY.keys
  .filter((entry) => entry.dev === "generate")
  .map(({ key }) => key);

/** The class of one environment variable name. Unlisted names are `config`. */
export function classOf({ key }: { key: string }): SecretClass {
  return BY_KEY.get(key)?.class ?? "config";
}

/** Whether the key holds a credential in whole (`secret`) or in part (`composite`). */
export function carriesCredential({ key }: { key: string }): boolean {
  const secretClass = classOf({ key });

  return secretClass === "secret" || secretClass === "composite";
}
