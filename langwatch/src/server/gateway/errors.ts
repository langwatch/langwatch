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

/**
 * A virtual key the caller asked for isn't there.
 *
 * Also raised when the key exists but this caller cannot see it
 * (`isVisibleToMembership`). That is deliberate and must stay
 * indistinguishable from a genuine miss: a separate "forbidden" would be an
 * existence oracle for keys in teams the caller has no part in. One code keeps
 * both answers identical while still giving the client something to render —
 * the bare `new TRPCError({ code: "NOT_FOUND" })` it replaces carried no
 * message at all, so the drawer had nothing to say but "unknown error".
 */
export class VirtualKeyNotFoundError extends HandledError {
  declare readonly code: "virtual_key_not_found";

  constructor() {
    super("virtual_key_not_found", "Virtual key not found", {
      httpStatus: 404,
      fault: "customer",
    });
    this.name = "VirtualKeyNotFoundError";
  }
}

/** A gateway budget the caller asked for isn't there. */
export class GatewayBudgetNotFoundError extends HandledError {
  declare readonly code: "gateway_budget_not_found";

  constructor() {
    super("gateway_budget_not_found", "Budget not found", {
      httpStatus: 404,
      fault: "customer",
    });
    this.name = "GatewayBudgetNotFoundError";
  }
}

/**
 * A scope named in the request — a team, a project, a group, a user, or the
 * organization itself — does not belong to the organization the request is
 * scoped to.
 *
 * A cross-tenant guard, not a typo check: the scope id is request-supplied, so
 * without it a caller could put a budget or a key on another tenant's team.
 * That is why `meta` carries the KIND of scope and never the id — the id names
 * another tenant's record, and the sentence it used to sit in
 * (`scope_org_mismatch: team tm_… is not in organization org_…`) shipped both
 * that id and ours to whoever asked.
 */
export class GatewayScopeOrgMismatchError extends HandledError {
  declare readonly code: "gateway_scope_org_mismatch";

  constructor(scopeKind: string) {
    super(
      "gateway_scope_org_mismatch",
      "That scope does not belong to this organization",
      { meta: { scopeKind }, httpStatus: 400, fault: "customer" },
    );
    this.name = "GatewayScopeOrgMismatchError";
  }
}

/** A guardrail being attached belongs to a different project than the key. */
export class GatewayGuardrailProjectMismatchError extends HandledError {
  declare readonly code: "gateway_guardrail_project_mismatch";

  constructor() {
    super(
      "gateway_guardrail_project_mismatch",
      "That guardrail belongs to a different project",
      { httpStatus: 400, fault: "customer" },
    );
    this.name = "GatewayGuardrailProjectMismatchError";
  }
}

/**
 * Per-key spend cannot be reported because this deployment has no per-key
 * spend ledger.
 *
 * `fault: platform` — a deployment shape, not anything the person reading the
 * column did, and nothing they can correct. Raised loudly rather than answered
 * with `$0.00`, which cannot be told apart from a key that genuinely spent
 * nothing.
 *
 * The copy says what is missing, never which engine is missing it: naming the
 * storage backend tells a customer nothing they can use
 * (`best_practices/copywriting.md`).
 */
export class GatewaySpendUnavailableError extends HandledError {
  declare readonly code: "gateway_spend_unavailable";

  constructor() {
    super("gateway_spend_unavailable", "Per-key spend is not available", {
      httpStatus: 412,
      fault: "platform",
    });
    this.name = "GatewaySpendUnavailableError";
  }
}

/**
 * A per-member budget was asked for on a deployment that tracks spend in one
 * bucket per budget rather than one per member.
 *
 * Refused rather than created, because the cap would quietly mean something
 * other than what the admin asked for — every member enforced against the
 * group's combined spend. `fault: platform` for the same reason as
 * {@link GatewaySpendUnavailableError}: the request was reasonable and the
 * deployment cannot honour it.
 */
export class GatewayGroupBudgetUnsupportedError extends HandledError {
  declare readonly code: "gateway_group_budget_unsupported";

  constructor() {
    super(
      "gateway_group_budget_unsupported",
      "Per-member budgets are not available on this deployment",
      { httpStatus: 400, fault: "platform" },
    );
    this.name = "GatewayGroupBudgetUnsupportedError";
  }
}
