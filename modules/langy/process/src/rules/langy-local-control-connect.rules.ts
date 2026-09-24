import { canonicalErrorFor } from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import {
  LOCAL_CONTROL_PROTOCOL_VERSION,
  type LocalControlRefusedCode,
} from "@langwatch/langy-contract";

import type { ControlCredentialReader } from "./langy-local-session-contract.rules.ts";

/** What one connect route answers a refusal with: main's status and body, byte for byte. */
export type ConnectRefusalDocument = Readonly<{ status: number; body: unknown }>;

const BODY_REFUSALS: ReadonlySet<string> = new Set(["malformed_request", "validation_error"]);

/**
 * The bearer, Basic or legacy `X-Auth-Token` credential a request carries, in main's
 * precedence (`platform/app/src/server/api-key/auth-middleware.ts` `extractCredentials`).
 */
export const readSessionKeyCredential: ControlCredentialReader = (header) => {
  const authorization = header("authorization");
  const legacyToken = header("x-auth-token");
  const projectId = header("x-project-id") ?? null;

  if (authorization?.toLowerCase().startsWith("basic ")) {
    const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf-8");
    const colon = decoded.indexOf(":");
    const basicProject = colon === -1 ? "" : decoded.slice(0, colon);
    const basicToken = colon === -1 ? "" : decoded.slice(colon + 1);
    if (basicProject && basicToken) return { token: basicToken, projectId: basicProject };
  }

  if (authorization?.toLowerCase().startsWith("bearer ")) {
    const token = authorization.slice(7).trim();
    if (token) return { token, projectId };
  }

  return legacyToken ? { token: legacyToken, projectId } : null;
};

const FRAME_CODE_BY_REFUSAL: Readonly<Record<string, LocalControlRefusedCode>> = {
  missing_credentials: "api_key_invalid",
  langy_session_key_invalid: "api_key_invalid",
  langy_session_key_wrong_type: "key_type_not_allowed",
  langy_session_key_unbound: "conversation_mismatch",
};

/** Register's refusals: main's 422 for a body that is not a register frame, else its 403 frame. */
export function registerRefusalDocument(failure: Error): ConnectRefusalDocument {
  if (HandledError.isHandled(failure) && BODY_REFUSALS.has(failure.code)) {
    return refusedFrame({
      status: 422,
      code: "protocol_invalid",
      message: `The body must be a register frame with protocol ${LOCAL_CONTROL_PROTOCOL_VERSION}.`,
    });
  }

  const frameCode = HandledError.isHandled(failure)
    ? FRAME_CODE_BY_REFUSAL[failure.code]
    : undefined;
  if (frameCode === undefined) return canonicalErrorFor(failure);

  return refusedFrame({
    status: 403,
    code: frameCode,
    message:
      HandledError.isHandled(failure) && failure.code === "missing_credentials"
        ? "Send the Langy session key as a bearer token."
        : failure.message,
  });
}

/** Poll's refusals: main's 410 with no frames when the instance token is not known. */
export function pollRefusalDocument(failure: Error): ConnectRefusalDocument {
  if (isUnknownSession(failure)) return { status: 410, body: { frames: [] } };
  return canonicalErrorFor(failure);
}

/** Frames' refusals: main's 422 for a body that is no frame list, its 410 for an unknown token. */
export function framesRefusalDocument(failure: Error): ConnectRefusalDocument {
  if (HandledError.isHandled(failure) && BODY_REFUSALS.has(failure.code)) {
    return { status: 422, body: { accepted: 0 } };
  }
  if (isUnknownSession(failure)) return { status: 410, body: { accepted: 0 } };
  return canonicalErrorFor(failure);
}

function isUnknownSession(failure: Error): boolean {
  return HandledError.isHandled(failure) && failure.code === "langy_local_record_not_found";
}

function refusedFrame({
  status,
  code,
  message,
}: {
  status: number;
  code: LocalControlRefusedCode;
  message: string;
}): ConnectRefusalDocument {
  return {
    status,
    body: { frame: { type: "refused", protocol: LOCAL_CONTROL_PROTOCOL_VERSION, code, message } },
  };
}
