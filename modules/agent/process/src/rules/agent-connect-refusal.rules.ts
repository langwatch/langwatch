/**
 * How the HTTP connect routes answer a refusal: main's `{ frame }` at the status of its reason
 * (main connect.v1.ts `refusedOrThrow`, long-poll.transport.ts `refusedAnswer`), which both SDKs
 * read at the body's root. Anything main never answered as a frame is declined to the boundary.
 */
import {
  AgentRegisterRefusedError,
  PROTOCOL_VERSION,
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
