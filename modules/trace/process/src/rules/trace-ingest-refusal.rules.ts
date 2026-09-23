import { HandledError } from "@langwatch/handled-error";

/** The credential refusals the trace doors answer in their own wire, and nothing else. */
const DOOR_REFUSAL_CODES: ReadonlySet<string> = new Set([
  "missing_credentials",
  "invalid_credentials",
  "api_key_permission_denied",
]);

/** A refusal the credential chain raised that a trace door renders itself. */
export function isTraceDoorRefusal(error: unknown): error is HandledError {
  return HandledError.isHandled(error) && DOOR_REFUSAL_CODES.has(error.code);
}

/** Whether the refusal is "we do not know this credential", not a ceiling on a key we know. */
export function isUnknownCredentialRefusal(error: HandledError): boolean {
  return error.code === "missing_credentials" || error.code === "invalid_credentials";
}

/** The trace doors preserve the key directory's two authentication statuses. */
export function traceDoorRefusalStatus(error: HandledError): 401 | 403 {
  return error.httpStatus === 401 ? 401 : 403;
}

/**
 * The body the trace doors have always answered a credential refusal with: the
 * sentence alone for an unknown credential, else the code as the discriminant,
 * the meta bag spread flat and the remediation channel alongside.
 */
export function traceDoorRefusalBody(error: HandledError): object {
  if (isUnknownCredentialRefusal(error)) return { message: error.message };

  const { code, message, meta, tips, docsUrl, fault, retryable } = error;
  return {
    error: code,
    message,
    ...meta,
    ...(tips?.length ? { tips } : {}),
    ...(docsUrl ? { docsUrl } : {}),
    ...(fault ? { fault } : {}),
    retryable: retryable === true,
  };
}
