/**
 * Handled errors for the gateway domain (ADR-045).
 *
 * Framework-agnostic: the tRPC boundary maps `httpStatus` to a code, and the
 * client renders copy keyed off `code`. Nothing here writes customer-facing
 * prose — `message` is for whoever reads the trace.
 */
import { HandledError } from "@langwatch/handled-error";
import { Prisma } from "@prisma/client";

import type { ExternalIdResource } from "./resourceMetadata";

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
 * That is why `meta` carries the TYPE of scope and never the id: the id names
 * another tenant's record, and the sentence it used to sit in
 * (`scope_org_mismatch: team tm_… is not in organization org_…`) shipped both
 * that id and ours to whoever asked.
 *
 * The key is `scope_type`, the same name the budget wire and the webhook
 * payloads already give this field, so a consumer reads one spelling
 * everywhere on the control plane.
 */
export class GatewayScopeOrgMismatchError extends HandledError {
  declare readonly code: "gateway_scope_org_mismatch";

  constructor(scopeType: string) {
    super(
      "gateway_scope_org_mismatch",
      "That scope does not belong to this organization",
      { meta: { scope_type: scopeType }, httpStatus: 400, fault: "customer" },
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
 * Two rows in one organization cannot answer to the same `external_id`.
 *
 * A 409 rather than a 400: the request is well-formed and would have been
 * accepted a moment earlier, so the caller's fix is to pick another id or to
 * patch the row that already holds this one, not to correct a malformed field.
 *
 * `meta.external_id` echoes the id the caller sent, which is the caller's own
 * value and therefore safe to return: unlike the scope-mismatch guard above,
 * this leaks nothing about the colliding row beyond the fact that the caller
 * already used the id.
 */
export class GatewayExternalIdConflictError extends HandledError {
  declare readonly code: "external_id_conflict";

  constructor(resource: ExternalIdResource, externalId: string) {
    super("external_id_conflict", "That external_id is already in use", {
      meta: { resource, external_id: externalId },
      httpStatus: 409,
      fault: "customer",
    });
    this.name = "GatewayExternalIdConflictError";
  }
}

/** The unique index each resource's `externalId` is guarded by. */
const EXTERNAL_ID_INDEX_FIELD = "externalId";

/**
 * Does this P2002 name the external-id index?
 *
 * Prisma reports the offending constraint differently per connector and per
 * version: an array of field names on some, the index NAME on others. Both are
 * matched, and the match is on the field name specifically rather than on
 * "the write had an external id", because {@link VirtualKey} carries a SECOND
 * unique index, `hashedSecret`, whose collision means a minted secret
 * repeated and is emphatically not a customer-facing conflict. Translating
 * that one would report a platform failure as the caller's bad input and hide
 * a broken secret generator behind a 409.
 */
function namesExternalIdIndex(target: unknown): boolean {
  if (Array.isArray(target)) {
    return target.some(
      (field) => typeof field === "string" && field === EXTERNAL_ID_INDEX_FIELD,
    );
  }
  return typeof target === "string" && target.includes(EXTERNAL_ID_INDEX_FIELD);
}

/**
 * Re-throw `error` as {@link GatewayExternalIdConflictError} when it is the
 * external-id uniqueness violation, and untouched otherwise.
 *
 * Written as a translate-and-rethrow rather than a pre-flight SELECT because a
 * check-then-write races: two concurrent creates both find the id free and one
 * of them still hits the index. The index is the only thing that actually
 * decides, so it is what the error is read from.
 */
export function translateExternalIdConflict(
  error: unknown,
  resource: ExternalIdResource,
  externalId: string | null | undefined,
): never {
  if (
    externalId &&
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    namesExternalIdIndex(error.meta?.target)
  ) {
    throw new GatewayExternalIdConflictError(resource, externalId);
  }
  throw error;
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

/**
 * A key was written with nowhere for its traces to land.
 *
 * Per-key spend is read off the trace path, so a key whose traces land
 * nowhere is invisible in every usage view and its spend can be capped by
 * no budget. Reached only when the organization has no governance project
 * either, which is the older self-hosted shape.
 */
export class GatewayTraceProjectRequiredError extends HandledError {
  declare readonly code: "trace_project_required";

  constructor() {
    super(
      "trace_project_required",
      "An organization- or team-owned key needs a project for its traces and costs to land in",
      { httpStatus: 400, fault: "customer" },
    );
    this.name = "GatewayTraceProjectRequiredError";
  }
}

/**
 * A key was written whose traces would land somewhere it never named.
 *
 * A key resolves its trace destination from an explicit one it carries, or
 * from its single project scope. A key that has neither, an organization-
 * or team-owned key with no destination set, or one scoped to several
 * projects at once, falls back to the organization's governance project.
 * That is a fine read-path tolerance for keys that already exist, and a bad
 * shape to write: every project budget the creator had in mind matches
 * nothing, because the traffic is attributed to a project they never
 * mentioned.
 *
 * The app has always required the destination for these ownerships; this is
 * the API agreeing with it. An organization whose only project IS the
 * governance one is not refused, since there would be nothing else to pick.
 */
export class GatewayTraceProjectAmbiguousError extends HandledError {
  declare readonly code: "gateway_trace_project_ambiguous";

  constructor({ projectScopeCount }: { projectScopeCount: number }) {
    super(
      "gateway_trace_project_ambiguous",
      "This key does not say which project its traces and costs land in",
      {
        meta: { project_scope_count: projectScopeCount },
        httpStatus: 400,
        fault: "customer",
      },
    );
    this.name = "GatewayTraceProjectAmbiguousError";
  }
}

/**
 * How many of the organization's projects the refusal names before it stops
 * counting. An organization running a project per customer has hundreds, and
 * an error payload is not a listing endpoint; `reachable_project_count` says
 * how many there were in total so a client never mistakes the sample for all
 * of them.
 */
const REACHABLE_PROJECT_HINT_LIMIT = 10;

/**
 * A budget was written on a scope none of the organization's active keys can
 * produce traffic for.
 *
 * Whether a completed request matches a TEAM, PROJECT or GROUP budget is
 * decided by the key that served it, not by anything chosen while writing the
 * budget. So the two sides can each look correct and never meet: a
 * team-scoped key whose traces land in the governance project matched no
 * budget on its own team, and a group budget matches nothing at all through a
 * shared key with no person behind it. The result is a spending control that
 * silently never fires, which is the worst way for one to fail.
 *
 * Refused at write time rather than reported later, with `allow_unreachable`
 * for the legitimate case of provisioning ahead of the keys that will use it.
 * An organization with no active keys is never refused: budget first, key
 * second is the natural setup order.
 */
export class GatewayBudgetScopeUnreachableError extends HandledError {
  declare readonly code: "gateway_budget_scope_unreachable";

  constructor({
    scopeType,
    reachableProjectIds,
  }: {
    scopeType: string;
    reachableProjectIds: string[];
  }) {
    super(
      "gateway_budget_scope_unreachable",
      "No active key sends traffic to that scope, so the budget would never spend",
      {
        meta: {
          scope_type: scopeType,
          reachable_project_ids: reachableProjectIds.slice(
            0,
            REACHABLE_PROJECT_HINT_LIMIT,
          ),
          reachable_project_count: reachableProjectIds.length,
        },
        httpStatus: 400,
        fault: "customer",
      },
    );
    this.name = "GatewayBudgetScopeUnreachableError";
  }
}

/**
 * A cycle anchor was sent on a window that has no cycle to phase.
 *
 * TOTAL never rolls and MANUAL rolls only when someone asks it to, so an
 * anchor on either would be stored and then never read. Refused rather than
 * ignored: a caller who set one believes their budget rolls on the 17th, and
 * silently accepting it would let them find out otherwise from an invoice.
 *
 * `meta.window` echoes the window the caller sent, which is their own value.
 */
export class GatewayBudgetCycleAnchorInvalidError extends HandledError {
  declare readonly code: "gateway_budget_cycle_anchor_invalid";

  constructor(window: string) {
    super(
      "gateway_budget_cycle_anchor_invalid",
      "That window does not cycle, so it cannot take a cycle anchor",
      { meta: { window }, httpStatus: 400, fault: "customer" },
    );
    this.name = "GatewayBudgetCycleAnchorInvalidError";
  }
}
