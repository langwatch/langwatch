import { useCallback, useRef, useState } from "react";
import { describeError, explainSerializedError } from "../features/errors";
import type {
  UncheckedReason,
  ValidationResult,
} from "../server/modelProviders/providerValidation";
import { api } from "../utils/api";

/**
 * Running a credential check against a provider that is already saved.
 *
 * The sibling `useModelProviderApiKeyValidation` checks a credential being
 * typed; this one checks the credential already stored, which is the one the
 * form deliberately never shows back. Nothing here sends a key — the row id
 * goes out and a verdict comes back.
 *
 * The three verdicts are kept apart on purpose. "We could not check this" is
 * an answer, not a soft yes: six of the sixteen providers cannot be probed at
 * all, and a control that rendered them as working would be wrong about more
 * than a third of the list — worse than offering nothing, because the
 * customer would stop looking too.
 */

/**
 * The wire shape of a verdict — the server's own type, not a copy of it.
 *
 * `import type` and not a value import: the module that owns this type reaches
 * the provider repository, and through it Prisma and the encryption helpers, so
 * importing anything from it by value would pull both into the browser bundle.
 * Types are erased, so this costs nothing at runtime and buys the one thing a
 * redeclaration cannot — a rename or a new `outcome` on the server becomes a
 * type error here instead of a sentence that quietly stops being true.
 */
type ConnectionTestResult = ValidationResult;

export type ConnectionTestState =
  | { status: "testing" }
  | { status: "works" }
  | { status: "refused"; message: string }
  | { status: "unchecked"; message: string };

/**
 * What to say when the check never ran.
 *
 * Deliberately short of the reason we hold internally. "This provider signs
 * every request with AWS credentials, which a listing endpoint does not
 * exercise" is true and is not the customer's problem; what they need to know
 * is whether they still have something to do. Only the cases they can act on
 * get a next step.
 */
const uncheckedMessage = (reason: UncheckedReason): string => {
  if (reason === "no_credential" || reason === "credential_masked") {
    // Not "nothing is stored": a credential written before the encryption
    // secret was rotated is unreadable rather than absent, and the two are
    // indistinguishable by the time they reach here (the repository drops an
    // undecryptable value to null). Telling that customer to enter a key they
    // already entered is the misdiagnosis this whole area exists to avoid.
    return "No credential could be read for this provider.";
  }
  return "This provider can't be tested automatically — its settings are checked when you first use it.";
};

/**
 * A verdict, turned into what the row should say.
 *
 * A pure function rather than three branches inside the hook: the mapping is
 * the part worth reading on its own, and keeping it out here is what lets the
 * exhaustiveness check below be the only place a new outcome has to be
 * handled.
 */
function toState(result: ConnectionTestResult): ConnectionTestState {
  if (result.outcome === "verified") {
    return { status: "works" };
  }

  if (result.outcome === "refused") {
    // The refusal is a serialized handled error riding on the payload, so it
    // is read with `explainSerializedError` rather than `describeError`. Both
    // land in the same code-keyed registry; only the transport differs. The
    // provider's own sentence never appears in either — a rejected-credential
    // body is where the credential itself tends to turn up.
    const { title, description } = explainSerializedError(result.domainError);
    return {
      status: "refused",
      message: description ? `${title}. ${description}` : title,
    };
  }

  if (result.outcome === "unchecked") {
    return { status: "unchecked", message: uncheckedMessage(result.reason) };
  }

  // A fourth outcome would otherwise fall into the branch above and be
  // described as "can't be tested automatically" — a confident sentence about
  // a verdict nobody has classified. This turns that into a compile error at
  // the moment the server grows one.
  //
  // The discriminator only, never the payload: this message reaches
  // `describeError` in the caller's catch, which can render a plain Error's
  // text to the customer, and nothing promises a future outcome's fields are
  // free of credential material.
  const unhandled: never = result;
  throw new Error(
    `Unhandled connection test outcome: ${String(
      (unhandled as { outcome?: unknown }).outcome,
    )}`,
  );
}

export function useModelProviderConnectionTest({
  projectId,
  organizationId,
}: {
  projectId: string | undefined;
  organizationId: string | undefined;
}) {
  const [results, setResults] = useState<Record<string, ConnectionTestState>>({});
  const { mutateAsync: testConnection } = api.modelProvider.testConnection.useMutation();

  /**
   * Which round of verdicts the visible ones belong to.
   *
   * Clearing the map is not enough on its own. A probe already in flight when
   * the map is cleared still resolves afterwards and writes its verdict back,
   * so the state a customer sees would be a verdict about the credential that
   * was in the row *before* they edited it — the very thing clearing was meant
   * to prevent, arriving a second later. Bumping a generation and discarding
   * anything stamped with an older one closes that window; a counter rather
   * than a boolean because several rows can be in flight at once.
   */
  const generation = useRef(0);

  const setResult = useCallback(
    (modelProviderId: string, state: ConnectionTestState, from: number) =>
      setResults((current) =>
        from === generation.current ? { ...current, [modelProviderId]: state } : current,
      ),
    [],
  );

  /**
   * Forget every verdict.
   *
   * A verdict is about the credential that was in the row when it was asked,
   * and nothing about the row's identity changes when its key does. Left
   * alone, a green "Connection works" survives the customer pasting a bad key
   * and saving — which is a success verdict about a credential that was never
   * checked, the one thing this feature must not produce. The drawer closing
   * is the moment a row may have changed underneath us, and re-asking is one
   * click, so the cheap and correct move is to drop them all rather than
   * reason about which row was touched.
   *
   * `useCredentialProbeGate` makes the same argument for the save-time probe:
   * a refusal must not outlive the credential it was about.
   *
   * Bumping the generation is what makes this hold for a probe still in
   * flight, whose answer would otherwise land after the clear.
   */
  const clearResults = useCallback(() => {
    generation.current += 1;
    setResults({});
  }, []);

  const test = useCallback(
    async (modelProviderId: string) => {
      const asked = generation.current;
      setResult(modelProviderId, { status: "testing" }, asked);

      try {
        // No cast. Asserting the shape here would give back exactly what
        // importing the server's type was meant to prevent: a renamed field or
        // a new outcome would compile, and `toState`'s `never` check would stop
        // catching it.
        const result: ConnectionTestResult = await testConnection({
          modelProviderId,
          projectId,
          organizationId,
        });

        setResult(modelProviderId, toState(result), asked);
      } catch (error) {
        // Not `error.message`: a handled error's message is replaced by its
        // stable code on the wire, so reading it renders a slug like
        // `model_provider_test_rate_limited` at the customer. A failure to
        // ask is reported as such, never as a verdict on the credential.
        setResult(
          modelProviderId,
          {
            status: "unchecked",
            message: describeError({
              error,
              fallbackTitle: "Couldn't test this connection",
            }),
          },
          asked,
        );
      }
    },
    [organizationId, projectId, setResult, testConnection],
  );

  return { results, test, clearResults };
}
