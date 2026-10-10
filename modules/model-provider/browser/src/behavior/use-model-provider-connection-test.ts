/**
 * Checks a credential already stored (by row id, never re-sent) — the counterpart to
 * `useModelProviderApiKeyValidation`'s typed-credential check. The three verdicts stay distinct
 * because "we could not check this" must read as its own answer, not a soft yes.
 */

import type {
  ModelProviderCredentialVerdict,
  ModelProviderUncheckedReason,
} from "@langwatch/model-provider-contract";
import { useCallback, useRef, useState } from "react";

import { describeFailure, describeRefusal } from "../model/connection-verdict-copy.ts";
import { modelProviderApi } from "./model-provider-api.ts";

/**
 * The contract's own verdict type, not a copy — an earlier extraction that duplicated it let the
 * transport and this hook disagree silently, and every provider rendered as untestable.
 */
type ConnectionTestResult = ModelProviderCredentialVerdict;

export type ConnectionTestState =
  | { status: "testing" }
  | { status: "works" }
  | { status: "refused"; message: string }
  | { status: "unchecked"; message: string };

/**
 * Deliberately vaguer than the reason held internally — only cases the customer can act on get
 * a next step, to avoid misdiagnosing an unreadable credential as a missing one.
 */
const uncheckedMessage = (reason: ModelProviderUncheckedReason): string => {
  if (reason === "no_credential" || reason === "credential_masked") {
    // Not "nothing is stored": a credential written before the encryption
    // secret was rotated is unreadable rather than absent, and the two are
    // indistinguishable by the time they reach here (the repository drops an
    // undecryptable value to null). Telling that customer to enter a key they
    // already entered is the misdiagnosis this whole area exists to avoid.
    return "No credential could be read for this provider.";
  }
  return "This provider can't be tested from here. Its settings are checked the first time you use it.";
};

/**
 * A pure function, kept outside the hook, so the compiler owns exhaustiveness: the `switch` has
 * no `default`, so a verdict added to the contract later fails to compile here instead of
 * silently falling through to "can't be tested from here".
 */
function toState(result: ConnectionTestResult): ConnectionTestState {
  switch (result.outcome) {
    case "verified":
      return { status: "works" };
    case "refused":
      // The refusal is a serialized handled error riding on the payload, so its
      // copy is read out of the code-keyed table rather than off the payload.
      // The provider's own sentence never appears — a rejected-credential body
      // is where the credential itself tends to turn up.
      return { status: "refused", message: describeRefusal(result.domainError) };
    case "unchecked":
      return { status: "unchecked", message: uncheckedMessage(result.reason) };
  }
}

export function useModelProviderConnectionTest({
  projectId,
  organizationId,
}: {
  projectId: string | undefined;
  organizationId: string | undefined;
}) {
  const [results, setResults] = useState<Record<string, ConnectionTestState>>({});
  const { mutateAsync: testConnection } =
    modelProviderApi.modelProvider.testConnection.useMutation();

  /**
   * Which round of verdicts is visible. Clearing the map alone isn't enough — a probe already in
   * flight can still resolve after a clear and write a stale verdict back, so bumping the
   * generation and discarding older-stamped results closes that window.
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
   * Forget every verdict: a verdict describes the credential that was in the row when asked, and a
   * changed key must not keep showing a stale "Connection works". Bumping the generation covers a
   * probe already in flight, whose answer would otherwise land after this clear.
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
        // No cast. Asserting the shape here would give back exactly what naming
        // the contract type was meant to prevent: a renamed field or a new
        // outcome would compile, and `toState`'s exhaustiveness would stop
        // catching it.
        const result: ConnectionTestResult = await testConnection({
          modelProviderId,
          projectId,
          organizationId,
        });

        setResult(modelProviderId, toState(result), asked);
      } catch {
        // Not `error.message`: a handled error's message is replaced by its
        // stable code on the wire, so reading it renders a slug like
        // `model_provider_test_rate_limited` at the customer. A failure to ask
        // is reported as such, never as a verdict on the credential.
        setResult(
          modelProviderId,
          {
            status: "unchecked",
            message: describeFailure({ fallbackTitle: "Couldn't test this connection" }),
          },
          asked,
        );
      }
    },
    [organizationId, projectId, setResult, testConnection],
  );

  return { results, test, clearResults };
}
