/**
 * The words a connection-test verdict is rendered as.
 *
 * A refusal travels as a SERIALIZED handled error on the verdict payload — a
 * return value rather than a throw, because asking a provider and being told no
 * is a successful question — so its copy is resolved from the stable `code` the
 * same way every other failure in the product is. `platform/app`'s
 * `explainSerializedError` did that against the ~90-entry presentation registry
 * in `features/errors`, which a feature-web package may not reach.
 *
 * SO THIS FAMILY CARRIES THE SEVEN CODES ITS OWN PROBE RAISES, VERBATIM, rather
 * than degrading them to the generic line the way `describe-error.ts` does in
 * `gateway-web`, `ops-web` and `user-web`. The difference is what the copy is
 * FOR: on those surfaces a code-specific sentence is a nicety, and here it is
 * the whole feature — "that API key was refused" and "nothing answered, so this
 * key was not checked" send a customer to two different places, and collapsing
 * them into "something went wrong" is the misdiagnosis this area exists to
 * avoid. The seven entries below are copied from
 * `platform/app/src/features/errors/logic/presentation.ts` and must be kept in
 * step with it until the registry harvest lands; `provider-refusal-copy.unit.test.ts`
 * is what says so.
 *
 * THE PROVIDER'S OWN SENTENCE IS NEVER RENDERED. A rejected-credential body is
 * where the credential itself tends to turn up — Gemini puts the key in the
 * query string it quotes back — so an unregistered code gets our generic line
 * and nothing of what arrived with it.
 */

/** The generic line for a failure we cannot name, and the floor under the rest. */
export const UNKNOWN_FAILURE_DESCRIPTION =
  "Something went wrong on our side. Try again in a moment.";

/** What a code is rendered as: a title, and a description that may read `meta`. */
type RefusalCopy = {
  title: string;
  describe: (meta: Readonly<Record<string, unknown>>) => string;
};

const PROVIDER_REFUSAL_COPY: Readonly<Record<string, RefusalCopy>> = {
  provider_key_invalid: {
    // The provider positively identified the credential as wrong, which is the
    // one refusal a new key actually fixes. Deliberately says nothing about WHY
    // beyond that.
    title: "That API key was refused",
    describe: () =>
      "The provider didn't recognise it. Check you copied the whole key, and that it belongs to the right account.",
  },
  provider_endpoint_redirected: {
    // Not "we couldn't reach it" — something answered, and it wants us
    // somewhere else. Saying so is the difference between the customer checking
    // their network and the customer fixing a URL.
    title: "That endpoint redirects somewhere else",
    describe: () =>
      "We don't follow redirects when sending a credential. Point the base URL at the address the provider actually serves — an http:// URL redirecting to https:// is the usual cause.",
  },
  provider_key_missing: {
    title: "No API key to check",
    describe: () => "Nothing is stored for this provider yet. Enter a key, then try again.",
  },
  provider_key_restricted: {
    // Fixable, but never by minting a new key, which is what "invalid" would
    // send them off to do. The reason is a discriminant from a set Google
    // enumerates, so branching copy on it is safe.
    title: "This key's restrictions block the request",
    describe: (meta) => {
      if (meta.reason !== "API_KEY_SERVICE_BLOCKED") {
        return "Its application restrictions don't allow a call from our servers. Adjust them in the Google Cloud console, then try again.";
      }
      return meta.googleDoor === "agent-platform"
        ? "This key can't call the Agent Platform service. If it is an AI Studio key, clear the Google Cloud Project and Location fields and save again; otherwise allow the Agent Platform API in the Google Cloud console."
        : "This key belongs to a different Google service. If it is a Gemini Enterprise Agent Platform key, fill in the Google Cloud Project and Location fields and save again; otherwise allow the Generative Language API in the Google Cloud console.";
    },
  },
  provider_refused: {
    // The provider answered and said no, but not in terms we can map — a 429 or
    // a 503 is theirs to fix, so the copy must not send the customer hunting
    // through their own key settings.
    title: "The provider refused the check",
    describe: () =>
      "It answered, but wouldn't confirm the key. This is usually temporary — try again in a moment.",
  },
  provider_service_disabled: {
    // The single most useful thing this whole flow says: the key is fine, the
    // API is switched off for its project.
    title: "That API isn't enabled for this key",
    describe: () =>
      "The key works, but its Google Cloud project doesn't have the Generative Language API turned on. Enable it in the console, or set up a Vertex AI provider, which uses service-account credentials.",
  },
  provider_unreachable: {
    // Nothing answered the credential check, so this says nothing about whether
    // the key is good — the copy must not read as a refusal.
    title: "Couldn't reach the provider",
    describe: (meta) =>
      meta.hasConfigurableEndpoint === true
        ? "Nothing answered, so this API key was not checked. Check your network connection, and check the base URL is correct and reachable."
        : "Nothing answered, so this API key was not checked. Check your network connection, then try again.",
  },
};

/** The codes this module can say something specific about, for its own test. */
export const REGISTERED_REFUSAL_CODES = Object.keys(PROVIDER_REFUSAL_COPY);

/** A refusal, as the row should read it: one sentence, no provider prose. */
export function describeRefusal(domainError: {
  code: string;
  meta?: Readonly<Record<string, unknown>>;
}): string {
  const registered = PROVIDER_REFUSAL_COPY[domainError.code];
  if (!registered) {
    // An unregistered code is, by definition, the branch least able to vouch
    // for what arrived with it — so it gets our generic line and none of it.
    return `The credential was refused. ${UNKNOWN_FAILURE_DESCRIPTION}`;
  }
  return `${registered.title}. ${registered.describe(domainError.meta ?? {})}`;
}

/**
 * The whole explanation as one string, for a slot that can only take text.
 *
 * The stand-in for `platform/app`'s `describeError`, used where the probe
 * itself failed to run rather than where a provider refused — there is no code
 * to read on that path, so it says what the reader was doing and stops.
 */
export function describeFailure({ fallbackTitle }: { fallbackTitle: string }): string {
  return `${fallbackTitle}. ${UNKNOWN_FAILURE_DESCRIPTION}`;
}
