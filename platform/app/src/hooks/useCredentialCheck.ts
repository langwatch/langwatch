import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { describeError } from "../features/errors";
import type { UncheckedReason } from "../server/modelProviders/providerValidation";
import { api } from "../utils/api";
import {
  type ConnectionTestState,
  toConnectionTestState,
  uncheckedMessage,
} from "./connectionTestState";

/**
 * Checking a credential from the drawer it is being typed into.
 *
 * The provider list checks a row that is finished and saved. Here the customer
 * is mid-edit, so what has to be checked is what is on screen — including the
 * half of it that has not been saved yet. Which of the two routes carries that
 * depends on what the drawer actually has:
 *
 *   - No row yet, because the provider is being created. There is nothing in
 *     storage to check, so the typed credential goes out on its own.
 *   - A row, and nothing edited. Nothing is sent: the stored credential is
 *     checked where it lives, which is the only way to check a key the form
 *     deliberately never shows back.
 *   - A row, and something edited. The settings on screen are sent whole. Not
 *     merged with the stored ones — the server refuses to combine them, and
 *     this end has no business trying either.
 *
 * The third case is the one that makes this worth a hook. A customer who
 * changes an endpoint and leaves the key masked would otherwise be told about
 * the endpoint they just replaced, which is a green answer about a
 * configuration nobody is looking at.
 */
export function useCredentialCheck({
  projectId,
  organizationId,
  modelProviderId,
  provider,
  customKeys,
  scopes,
  hasEdits,
}: {
  projectId: string | undefined;
  organizationId: string | undefined;
  /** The row being edited, or undefined while creating one. */
  modelProviderId: string | undefined;
  provider: string;
  customKeys: Record<string, string>;
  scopes?: Array<{
    scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
    scopeId: string;
  }>;
  /** Whether anything in the credential differs from what is stored. */
  hasEdits: boolean;
}) {
  const [state, setState] = useState<ConnectionTestState | undefined>();

  const { mutateAsync: testConnection } =
    api.modelProvider.testConnection.useMutation();
  const { mutateAsync: validateApiKey } =
    api.modelProvider.validateApiKey.useMutation();

  /**
   * A verdict is about the credential that was on screen when it was asked
   * for, so it cannot survive that credential changing. Comparing a
   * fingerprint rather than clearing on every render is what makes this hold
   * while a check is still in flight: the answer that lands afterwards is
   * about keys that are no longer there.
   *
   * `useCredentialProbeGate` makes the same argument for the save-time probe.
   */
  const credentialsFingerprint = useMemo(
    () => JSON.stringify(customKeys),
    [customKeys],
  );

  /**
   * The fingerprint as of the latest render, readable from inside a callback
   * that closed over an older one.
   *
   * A ref rather than the value itself, and this is the whole point: `check`
   * captures the credentials it was called with, so comparing the captured
   * fingerprint against the captured credentials compares a value with itself
   * and is true however much has changed since. The ref is the only thing in
   * scope that moves, so it is the only thing that can answer "are these still
   * the credentials on screen?".
   */
  const latestFingerprint = useRef(credentialsFingerprint);
  useEffect(() => {
    latestFingerprint.current = credentialsFingerprint;
    setState(undefined);
  }, [credentialsFingerprint, modelProviderId]);

  const check = useCallback(async () => {
    const asked = credentialsFingerprint;
    // Discard anything that arrives about credentials the customer has since
    // changed, rather than showing a verdict about keys that are gone. Without
    // this an answer still in flight when they edit lands afterwards and puts
    // a green result back on screen — about a credential that is no longer
    // there, which is the one thing this feature must never produce.
    const settle = (next: ConnectionTestState) =>
      setState((current) =>
        asked === latestFingerprint.current ? next : current,
      );

    setState({ status: "testing" });

    try {
      const result = modelProviderId
        ? await testConnection({
            modelProviderId,
            projectId,
            organizationId,
            // Only when there is something the row does not already know.
            // Sending an untouched form would send a blank or masked key and
            // get back "no credential" for a provider that is configured fine.
            ...(hasEdits ? { customKeys } : {}),
          })
        : await validateApiKey({
            projectId,
            organizationId,
            provider,
            customKeys,
            scopes: scopes && scopes.length > 0 ? scopes : undefined,
          });

      settle(toConnectionTestState(result, describeUncheckedInDrawer));
    } catch (error) {
      // Not `error.message`: a handled error's message is replaced by its
      // stable code on the wire, so reading it renders a slug like
      // `model_provider_test_rate_limited` at the customer. A failure to ask
      // is reported as such, never as a verdict on the credential.
      settle({
        status: "unchecked",
        reason: "request_failed",
        message: describeError({
          error,
          fallbackTitle: "Couldn't check this connection",
        }),
      });
    }
  }, [
    credentialsFingerprint,
    customKeys,
    hasEdits,
    modelProviderId,
    organizationId,
    projectId,
    provider,
    scopes,
    testConnection,
    validateApiKey,
  ]);

  return { state, check };
}

/**
 * Why a check did not run, said to someone who is still holding the form.
 *
 * Two reasons mean something different here than they do on the list. There, a
 * missing or masked credential is a fact about storage that a reader can only
 * note. Here it is the direct consequence of an edit they just made — they
 * changed a setting and left the credential hidden — and the next step is one
 * they can take.
 */
const describeUncheckedInDrawer = (
  reason: UncheckedReason | "request_failed",
): string => {
  if (reason === "credential_masked" || reason === "no_credential") {
    return "Enter the credential again to check these settings.";
  }
  return uncheckedMessage(reason as UncheckedReason);
};
