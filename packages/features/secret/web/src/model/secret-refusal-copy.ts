/**
 * What a customer reads when a secret write is refused.
 *
 * THE FOUR CODES THIS FEATURE RAISES HAVE NEVER HAD CUSTOMER-FACING COPY.
 * `secret_already_exists`, `secret_limit_reached`, `secret_name_reserved` and
 * `secret_not_found` are declared as `HandledError` subclasses in
 * `@langwatch/secret-contract`, but none of them is listed in
 * `platform/app/src/features/errors/logic/codes.ts`, so the presentation
 * registry's exhaustiveness never demanded an entry and none was written. The
 * page's `showErrorToast({ error, fallbackTitle })` therefore degraded every one
 * of them to "Couldn't create the secret" plus the generic
 * "something went wrong on our side" line — which is untrue for all four: each
 * one is something the reader can fix in the dialog they are looking at.
 *
 * That is the bug class CLAUDE.md names outright ("Letting a knowable failure
 * surface as a generic unknown error"), and the model-config family's precedent
 * says where the fix goes while the registry harvest is still owed: A CODE-KEYED
 * COPY TABLE BELONGS TO THE FEATURE THAT RAISES THE CODES. So the words live
 * here, the screen resolves them and hands them to the host, and this module
 * dies the day the four codes are added to the registry.
 *
 * A DELIBERATE ADDITION, NAMED. A page move should not have any, and this is
 * one: a customer who hits the fifty-secret ceiling now reads why. It is written
 * down here and in the manifests so somebody can disagree with it.
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
 * The code a failure carries, whichever boundary sent it.
 *
 * tRPC nests the handled payload under `data.error`; a REST route sends it flat
 * with the code in `error`. Anything else is an unhandled failure and has no
 * code to read, which is the `undefined` this returns. The same nine lines
 * `@langwatch/gateway-web` and `@langwatch/automation-web` carry, and they die
 * together with the registry harvest.
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
