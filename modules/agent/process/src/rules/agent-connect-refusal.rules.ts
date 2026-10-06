/**
 * How the HTTP connect routes answer a refusal: main's `{ frame }` at the status of its reason
 * (main connect.v1.ts `refusedOrThrow`, long-poll.transport.ts `refusedAnswer`), which both SDKs
 * read at the body's root. Anything main never answered as a frame is declined to the boundary.
 */
import {
  AgentRegisterRefusedError,
  PROTOCOL_VERSION,
  type RefusedCode,
  type RefusedFrame,
} from "@langwatch/agent-contract";
import { HandledError } from "@langwatch/handled-error";

/** A refused frame to write, or nothing of the protocol's own. */
export type AgentConnectRefusal =
  | Readonly<{ kind: "frame"; status: number; body: Readonly<{ frame: unknown }> }>
  | Readonly<{ kind: "declined" }>;

const BODY_REFUSALS: ReadonlySet<string> = new Set(["malformed_request", "validation_error"]);

const DECLINED: AgentConnectRefusal = { kind: "declined" };

/** Register: every refusal main answered as a frame, a body that is no register frame included. */
export function registerRefusal(failure: Error): AgentConnectRefusal {
  if (isBodyRefusal(failure)) {
    return protocolInvalid(`The body must be a register frame with protocol ${PROTOCOL_VERSION}.`);
  }

  return refusedFrameOf(failure);
}

/** Poll: a credential refusal is a frame; an unknown instance token stays main's error. */
export function pollRefusal(failure: Error): AgentConnectRefusal {
  return refusedFrameOf(failure);
}

/** Frames: a body with no ack, result or deregister frame is main's `protocol_invalid` frame. */
export function framesRefusal(failure: Error): AgentConnectRefusal {
  if (isBodyRefusal(failure)) {
    return protocolInvalid("The body must carry ack, result and deregister frames under frames.");
  }

  return refusedFrameOf(failure);
}

function refusedFrameOf(failure: Error): AgentConnectRefusal {
  return failure instanceof AgentRegisterRefusedError ? frameOf(failure) : DECLINED;
}

/** A door refusal the connect protocol answers as its own frame, or one it never framed. */
export type ConnectRefusal =
  | Readonly<{
      framed: true;
      refusal: Readonly<{ reason: RefusedCode; message: string; meta?: Record<string, unknown> }>;
    }>
  | Readonly<{ framed: false }>;

const INVALID_KEY = "The API key is not valid for this project.";

const PERMISSION_DENIALS: ReadonlySet<string> = new Set([
  "api_key_permission_denied",
  "api_key_permission_not_delegable",
]);

const UNFRAMED: ConnectRefusal = { framed: false };

/**
 * A door refusal at main's connect reason and message. A person's access token stays an
 * unknown key, as on main; anything else the protocol never framed stays unframed.
 */
export function connectRefusalOf(failure: Error): ConnectRefusal {
  if (!HandledError.isHandled(failure)) return UNFRAMED;
  if (PERMISSION_DENIALS.has(failure.code)) {
    return framed({
      reason: "permission_denied",
      message: "The API key needs the scenarios:manage permission to connect an agent.",
    });
  }

  switch (failure.code) {
    case "missing_credentials":
      return framed({
        reason: "api_key_invalid",
        message: "Send the API key as Authorization: Bearer <key>.",
      });
    case "invalid_credentials":
      return framed({ reason: "api_key_invalid", message: INVALID_KEY });
    case "key_type_not_allowed":
      return failure.meta.kind === "access_token"
        ? framed({ reason: "api_key_invalid", message: INVALID_KEY })
        : framed({
            reason: "key_type_not_allowed",
            message:
              "An ingestion key or a Langy session key cannot connect an agent. Use a personal or a project API key.",
          });
    case "project_required":
      return framed({
        reason: "project_required",
        message:
          "This API key reaches several projects. Send the project id in the X-Project-Id header.",
        meta: { projects: failure.meta.projects ?? [] },
      });
    default:
      return UNFRAMED;
  }
}

function framed(refusal: {
  reason: RefusedCode;
  message: string;
  meta?: Record<string, unknown>;
}): ConnectRefusal {
  return { framed: true, refusal };
}

function frameOf(refused: AgentRegisterRefusedError): AgentConnectRefusal {
  return { kind: "frame", status: refused.httpStatus, body: { frame: refused.meta?.frame } };
}

/** Main's 422 for a body its schema refused: the status of `protocol_invalid` in the contract. */
function protocolInvalid(message: string): AgentConnectRefusal {
  const frame: RefusedFrame = {
    type: "refused",
    protocol: PROTOCOL_VERSION,
    code: "protocol_invalid",
    message,
  };

  return { kind: "frame", status: 422, body: { frame } };
}

function isBodyRefusal(failure: Error): boolean {
  return HandledError.isHandled(failure) && BODY_REFUSALS.has(failure.code);
}
