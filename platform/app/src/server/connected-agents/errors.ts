/**
 * The handled errors of connected agents (ADR-128, "Contract").
 *
 * Every message is written so a customer could read it: the REST boundary
 * ships it in the response body. The words the app shows live in the client
 * presentation registry, keyed by `code`.
 */

import { HandledError } from "@langwatch/handled-error";
import { remediation } from "~/server/app-layer/error-remediation";
import type { RefusedCode } from "./protocol";

/** No live instance answered inside the first-turn grace. */
export class AgentOfflineError extends HandledError {
  declare readonly code: "agent_offline";

  constructor({
    agentName,
    environment,
  }: {
    agentName: string;
    environment: string | null;
  }) {
    super(
      "agent_offline",
      "No instance of this connected agent is running. Start the process that runs it and try again.",
      {
        httpStatus: 503,
        // The process that runs the agent is the customer's own.
        fault: "customer",
        meta: { agentName, environment },
        ...remediation("agent_offline"),
      },
    );
    this.name = "AgentOfflineError";
  }
}

/** A personal development agent was targeted by someone other than its owner. */
export class AgentOwnerOnlyError extends HandledError {
  declare readonly code: "agent_owner_only";

  constructor({
    agentId,
    agentName,
    ownerUserId,
    ownerName,
  }: {
    agentId: string;
    agentName: string;
    ownerUserId: string;
    ownerName: string | null;
  }) {
    super(
      "agent_owner_only",
      "This development agent belongs to another person and can only be run by them.",
      {
        httpStatus: 403,
        fault: "customer",
        meta: { agentId, agentName, ownerUserId, ownerName },
        ...remediation("agent_owner_only"),
      },
    );
    this.name = "AgentOwnerOnlyError";
  }
}

/** The instance did not answer before the call deadline. */
export class AgentCallTimeoutError extends HandledError {
  declare readonly code: "agent_call_timeout";

  constructor({ timeoutMs }: { timeoutMs: number }) {
    super(
      "agent_call_timeout",
      "The connected agent did not answer before the call deadline.",
      {
        httpStatus: 504,
        fault: "customer",
        meta: { timeoutMs },
        ...remediation("agent_call_timeout"),
      },
    );
    this.name = "AgentCallTimeoutError";
  }
}

/** The longest error text an SDK can hand back to a customer. */
const MAX_REMOTE_ERROR_LENGTH = 1000;

/** The function raised, and the SDK reported the error. */
export class AgentCallFailedError extends HandledError {
  declare readonly code: "agent_call_failed";

  constructor({
    remoteCode,
    remoteMessage,
  }: {
    remoteCode: string;
    remoteMessage: string;
  }) {
    const message = remoteMessage.slice(0, MAX_REMOTE_ERROR_LENGTH);
    super("agent_call_failed", "The connected agent raised an error.", {
      httpStatus: 502,
      fault: "customer",
      // The SDK's own words, so the run drawer can show what the function
      // raised. Clamped, and rendered through safeProse on the client.
      meta: { remoteCode, message },
      ...remediation("agent_call_failed"),
    });
    this.name = "AgentCallFailedError";
  }
}

/**
 * The call reached an instance and that instance went away before it
 * answered. The turn is not placed on another instance, because the function
 * may have run.
 */
export class AgentDisconnectedError extends HandledError {
  declare readonly code: "agent_disconnected";

  constructor({ instanceId }: { instanceId: string }) {
    super(
      "agent_disconnected",
      "The connected agent instance that was working on this call disconnected before it answered. The turn was not sent again, because the function may have run.",
      {
        httpStatus: 502,
        fault: "customer",
        meta: { instanceId },
        ...remediation("agent_disconnected"),
      },
    );
    this.name = "AgentDisconnectedError";
  }
}

/** A sticky thread's pinned instance is gone. */
export class AgentInstanceLostError extends HandledError {
  declare readonly code: "agent_instance_lost";

  constructor({ instanceId }: { instanceId: string }) {
    super(
      "agent_instance_lost",
      "The instance this conversation was pinned to is no longer connected.",
      {
        httpStatus: 502,
        fault: "customer",
        meta: { instanceId },
        ...remediation("agent_instance_lost"),
      },
    );
    this.name = "AgentInstanceLostError";
  }
}

/** Every live instance is at its concurrency. */
export class AgentBusyError extends HandledError {
  declare readonly code: "agent_busy";

  constructor({ retryAfterMs }: { retryAfterMs: number }) {
    super(
      "agent_busy",
      "Every instance of this connected agent is busy. Try again in a moment.",
      {
        httpStatus: 429,
        fault: "customer",
        meta: { retryAfterMs },
        ...remediation("agent_busy"),
      },
    );
    this.name = "AgentBusyError";
  }
}

/** A declared parameter, or a value for one, is not one the platform accepts. */
export class AgentParameterInvalidError extends HandledError {
  declare readonly code: "agent_parameter_invalid";

  constructor({ name, reason }: { name: string | null; reason: string }) {
    super(
      "agent_parameter_invalid",
      name
        ? `The parameter "${name}" cannot be declared: ${reason}`
        : `The parameters cannot be declared: ${reason}`,
      {
        httpStatus: 422,
        fault: "customer",
        meta: { name, reason },
        ...remediation("agent_parameter_invalid"),
      },
    );
    this.name = "AgentParameterInvalidError";
  }
}

/** A register frame was refused; `meta.reason` is the code the SDK prints. */
export class AgentRegisterRefusedError extends HandledError {
  declare readonly code: "agent_register_refused";

  constructor({
    reason,
    message,
    meta,
  }: {
    reason: RefusedCode;
    message: string;
    meta?: Record<string, unknown>;
  }) {
    super("agent_register_refused", message, {
      httpStatus: reason === "permission_denied" ? 403 : 422,
      fault: "customer",
      meta: { reason, ...meta },
      ...remediation("agent_register_refused"),
    });
    this.name = "AgentRegisterRefusedError";
  }
}

/** An HTTP poll or frame named an instance token the platform does not know. */
export class AgentSessionUnknownError extends HandledError {
  declare readonly code: "agent_session_unknown";

  constructor() {
    super(
      "agent_session_unknown",
      "The instance token is not known. Register the instance again.",
      {
        httpStatus: 410,
        fault: "customer",
        ...remediation("agent_session_unknown"),
      },
    );
    this.name = "AgentSessionUnknownError";
  }
}

/** A body, a result or a session is above its cap. */
export class AgentPayloadTooLargeError extends HandledError {
  declare readonly code: "agent_payload_too_large";

  constructor({
    what,
    sizeBytes,
    limitBytes,
  }: {
    what: "envelope" | "result" | "session";
    /**
     * What the payload weighed, when it was measured; absent when the cap
     * stopped the read before the whole body arrived.
     */
    sizeBytes?: number;
    limitBytes: number;
  }) {
    super(
      "agent_payload_too_large",
      sizeBytes === undefined
        ? `The ${what} is above the limit of ${limitBytes} bytes.`
        : `The ${what} is ${sizeBytes} bytes, above the limit of ${limitBytes} bytes.`,
      {
        httpStatus: 413,
        fault: "customer",
        meta: {
          what,
          limitBytes,
          ...(sizeBytes === undefined ? {} : { sizeBytes }),
        },
        ...remediation("agent_payload_too_large"),
      },
    );
    this.name = "AgentPayloadTooLargeError";
  }
}
