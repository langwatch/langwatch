import type { SerializedHandledError } from "@langwatch/handled-error";
import { useCallback, useState } from "react";
import { describeError, explainSerializedError } from "../features/errors";
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
 * The wire shape of a verdict.
 *
 * Declared here rather than imported from the server module that owns it.
 * That module value-imports the provider repository, which reaches Prisma and
 * the encryption helpers, so importing the type by value would pull both into
 * the browser bundle. The frontend-boundary test guards server code reaching
 * browser packages, not the reverse, so the mistake would ship quietly.
 */
type ConnectionTestResult =
  | { outcome: "verified" }
  | { outcome: "refused"; domainError: SerializedHandledError }
  | { outcome: "unchecked"; reason: string };

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
const uncheckedMessage = (reason: string): string => {
  if (reason === "no_credential" || reason === "credential_masked") {
    return "No credential is stored for this provider yet.";
  }
  return "This provider can't be tested automatically — its settings are checked when you first use it.";
};

export function useModelProviderConnectionTest({
  projectId,
  organizationId,
}: {
  projectId: string | undefined;
  organizationId: string | undefined;
}) {
  const [results, setResults] = useState<Record<string, ConnectionTestState>>(
    {},
  );
  const { mutateAsync: testConnection } =
    api.modelProvider.testConnection.useMutation();

  const setResult = useCallback(
    (modelProviderId: string, state: ConnectionTestState) =>
      setResults((current) => ({ ...current, [modelProviderId]: state })),
    [],
  );

  const test = useCallback(
    async (modelProviderId: string) => {
      setResult(modelProviderId, { status: "testing" });

      try {
        const result = (await testConnection({
          modelProviderId,
          projectId,
          organizationId,
        })) as ConnectionTestResult;

        if (result.outcome === "verified") {
          setResult(modelProviderId, { status: "works" });
          return;
        }

        if (result.outcome === "refused") {
          // The refusal is a serialized handled error riding on the payload,
          // so it is read with `explainSerializedError` rather than
          // `describeError`. Both land in the same code-keyed registry; only
          // the transport differs. The provider's own sentence never appears
          // in either — a rejected-credential body is where the credential
          // itself tends to turn up.
          const { title, description } = explainSerializedError(
            result.domainError,
          );
          setResult(modelProviderId, {
            status: "refused",
            message: description ? `${title}. ${description}` : title,
          });
          return;
        }

        setResult(modelProviderId, {
          status: "unchecked",
          message: uncheckedMessage(result.reason),
        });
      } catch (error) {
        // Not `error.message`: a handled error's message is replaced by its
        // stable code on the wire, so reading it renders a slug like
        // `model_provider_test_rate_limited` at the customer. A failure to
        // ask is reported as such, never as a verdict on the credential.
        setResult(modelProviderId, {
          status: "unchecked",
          message: describeError({
            error,
            fallbackTitle: "Couldn't test this connection",
          }),
        });
      }
    },
    [organizationId, projectId, setResult, testConnection],
  );

  return { results, test };
}
