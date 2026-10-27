/**
 * Customer-facing copy for refusals the four secret error codes raise. These codes were
 * never added to the presentation registry, so this feature-level override exists. It will
 * be obsolete when the codes are registered. Spec: specs/secrets/secrets-manager.feature
 */

import { MAX_SECRETS_PER_PROJECT } from "@langwatch/secret-contract";

/** One refusal, as a title and the sentence under it. */
export type SecretRefusalCopy = { title: string; description: string };

const SECRET_REFUSAL_COPY: Readonly<Record<string, SecretRefusalCopy>> = {
  secret_already_exists: {
    title: "That name is already taken",
    description:
      "This project already has a secret with that name. Pick a different name, or update the existing one.",
  },
  secret_limit_reached: {
    title: "This project has all the secrets it can hold",
    description: `A project can hold ${MAX_SECRETS_PER_PROJECT} secrets. Delete one you no longer use, then add this one.`,
  },
  secret_name_reserved: {
    title: "That name is reserved",
    description:
      "LangWatch uses that name for a credential it manages itself. Pick a different one.",
  },
  secret_not_found: {
    title: "That secret is no longer here",
    description:
      "It was deleted, possibly by someone else on your team. Close this and reload the list.",
  },
};

/**
 * Extracts the error code from a failure, handling both tRPC (nested under data.error)
 * and REST (flat error) formats. Returns undefined for unhandled failures. This duplicated
 * logic lives elsewhere and will be obsolete with the registry harvest.
 */
export function readSecretRefusalCode(error: unknown): string | undefined {
  const nested = (error as { data?: { error?: { code?: unknown } } } | null)?.data?.error?.code;
  if (typeof nested === "string") return nested;
  const flat = (error as { error?: unknown } | null)?.error;
  if (typeof flat === "string") return flat;
  return void 0;
}

/**
 * The words for one refusal, or `undefined` when this feature has nothing
 * better to say than the action name the host already has.
 */
export function describeSecretRefusal(error: unknown): SecretRefusalCopy | undefined {
  const code = readSecretRefusalCode(error);
  return code === void 0 ? void 0 : SECRET_REFUSAL_COPY[code];
}

/** Every code this table answers, for the test that pins it against the contract. */
export const SECRET_REFUSAL_CODES = Object.keys(SECRET_REFUSAL_COPY);
