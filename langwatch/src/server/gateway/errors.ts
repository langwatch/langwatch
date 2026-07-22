/**
 * Handled errors for the gateway domain (ADR-045).
 *
 * Framework-agnostic: the tRPC boundary maps `httpStatus` to a code, and the
 * client renders copy keyed off `code`. Nothing here writes customer-facing
 * prose — `message` is for whoever reads the trace.
 */
import { HandledError } from "@langwatch/handled-error";

/**
 * The caller may see the virtual key but not attach guardrails to its project.
 *
 * A named denial rather than a string the client has to parse: the guardrails
 * surface used to branch on `err.message.includes("missing_perm")` to write its
 * own copy, which is exactly the message-prose coupling the handled-error
 * boundary exists to remove — and which would have broken silently the moment
 * this throw was tidied up.
 *
 * `customer` fault on purpose: a 403 here is a permission the caller can be
 * granted, not an incident.
 */
export class GuardrailAttachForbiddenError extends HandledError {
  declare readonly code: "guardrail_attach_forbidden";

  constructor() {
    super(
      "guardrail_attach_forbidden",
      "Caller lacks gatewayGuardrails:attach on the virtual key's project",
      { httpStatus: 403, fault: "customer" },
    );
    this.name = "GuardrailAttachForbiddenError";
  }
}
