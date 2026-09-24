/**
 * Handled errors for the gateway domain (ADR-045). Framework-agnostic: the
 * tRPC boundary maps `httpStatus` to a code, client copy keyed off `code`.
 * Nothing here writes customer-facing prose — `message` is for the trace.
 */
import { HandledError, remediation } from "@langwatch/handled-error";
import { Temporal } from "@langwatch/time";
import { z } from "zod";

type ExternalIdResource = "virtual_key" | "budget";

/** The internal gateway's signed request could not be authenticated. */
export class GatewayInternalAuthenticationError extends HandledError {
  declare readonly code: "permission_denied";

  constructor(reason: string, message: string) {
    super("permission_denied", message, {
      httpStatus: 401,
      fault: "customer",
      meta: { reason },
    });
    this.name = "GatewayInternalAuthenticationError";
  }
}

/** This process has no secret with which to authenticate its gateway. */
export class GatewayInternalAuthenticationUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor() {
    super("service_unavailable", "Gateway internal authentication is not configured", {
      httpStatus: 500,
      fault: "platform",
    });
    this.name = "GatewayInternalAuthenticationUnavailableError";
  }
}

/**
 * The gateway's own provider bindings were folded into ModelProvider in
 * iteration 110. The address stays served so a caller still on it is told
 * where the capability went, rather than reading a bare 404.
 */
export class GatewayProviderBindingsGoneError extends HandledError {
  declare readonly code: "gateway_provider_bindings_gone";

  constructor(replacement: string) {
    super(
      "gateway_provider_bindings_gone",
      `Gateway provider bindings folded into ModelProvider in iteration 110. ${replacement}`,
      { httpStatus: 410, fault: "customer" },
    );
    this.name = "GatewayProviderBindingsGoneError";
  }
}

/** A project holds no live agent-cache entry under the requested name. */
export class GatewayAgentCacheEntryNotFoundError extends HandledError {
  declare readonly code: "cache_entry_not_found";

  constructor(options: { reasons?: readonly Error[] } = {}) {
    super(
      "cache_entry_not_found",
      "This project holds no cache entry under that name. Store it first, or check the name.",
      {
        httpStatus: 404,
        fault: "customer",
        ...remediation("cache_entry_not_found"),
        ...options,
      },
    );
    this.name = "GatewayAgentCacheEntryNotFoundError";
  }
}

/**
 * Caller lacks permission to attach guardrails to this virtual key's project.
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
 * Virtual key not found (or invisible to caller), kept indistinguishable
 * to prevent key-existence oracles.
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

/**
 * Expiration date already passed; rejected at write-time to point users at
 * the field on screen.
 */
export class VirtualKeyExpiryInPastError extends HandledError {
  declare readonly code: "virtual_key_expiry_in_past";

  constructor() {
    super("virtual_key_expiry_in_past", "The expiration date has already passed", {
      meta: {
        fieldErrors: {
          expiresAt: ["Pick a date in the future"],
          expires_at: ["Pick a date in the future"],
        },
      },
      httpStatus: 400,
      fault: "customer",
    });
    this.name = "VirtualKeyExpiryInPastError";
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

/** A voice provider has no usable API key stored; the same code the scenario voice session refuses with. */
export class GatewayVoiceKeyMissingError extends HandledError {
  declare readonly code: "voice_key_missing";

  constructor() {
    super("voice_key_missing", "No API key configured for this voice provider", {
      httpStatus: 400,
      fault: "customer",
    });
    this.name = "GatewayVoiceKeyMissingError";
  }
}

/**
 * Scope does not belong to the request's organization; cross-tenant guard,
 * never a typo.
 */
export class GatewayScopeOrgMismatchError extends HandledError {
  declare readonly code: "gateway_scope_org_mismatch";

  constructor(scopeType: string) {
    super("gateway_scope_org_mismatch", "That scope does not belong to this organization", {
      meta: { scope_type: scopeType },
      httpStatus: 400,
      fault: "customer",
    });
    this.name = "GatewayScopeOrgMismatchError";
  }
}

/** A guardrail being attached belongs to a different project than the key. */
export class GatewayGuardrailProjectMismatchError extends HandledError {
  declare readonly code: "gateway_guardrail_project_mismatch";

  constructor() {
    super("gateway_guardrail_project_mismatch", "That guardrail belongs to a different project", {
      httpStatus: 400,
      fault: "customer",
    });
    this.name = "GatewayGuardrailProjectMismatchError";
  }
}

/**
 * Per-key spend ledger not available on this deployment; platform fault,
 * not recoverable by the caller.
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
 * Duplicate external_id in organization; 409 (not 400) since the request
 * was well-formed a moment earlier.
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
 * Does this P2002 name the external-id index (not hashedSecret collision)?
 */
function namesExternalIdIndex(target: unknown): boolean {
  if (Array.isArray(target)) {
    return target.some((field) => typeof field === "string" && field === EXTERNAL_ID_INDEX_FIELD);
  }
  return typeof target === "string" && target.includes(EXTERNAL_ID_INDEX_FIELD);
}

/**
 * Translate P2002 to GatewayExternalIdConflictError when it names the
 * external-id index; read from index not check-then-write.
 */
export function translateExternalIdConflict(
  error: unknown,
  resource: ExternalIdResource,
  externalId: string | null | undefined,
): never {
  const parsed = prismaUniqueConstraintErrorSchema.safeParse(error);
  if (externalId && parsed.success && namesExternalIdIndex(parsed.data.meta?.target)) {
    throw new GatewayExternalIdConflictError(resource, externalId);
  }
  throw error;
}

const prismaUniqueConstraintErrorSchema = z
  .object({
    code: z.literal("P2002"),
    meta: z.object({ target: z.unknown().optional() }).optional(),
  })
  .passthrough();

/**
 * Per-member budgets not available on this deployment; platform shape, not
 * recoverable.
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
 * A key was written with nowhere for its traces to land. Per-key spend is
 * read off the trace path, so such a key is invisible in every usage view
 * and uncapped by any budget. Reached only in the older self-hosted shape.
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
 * Trace destination not in this organization; refused at write-time to
 * prevent traffic mismapping.
 */
export class GatewayTraceProjectUnknownError extends HandledError {
  declare readonly code: "gateway_trace_project_unknown";

  constructor() {
    super(
      "gateway_trace_project_unknown",
      "That project is not in this organization, so traces could not land there",
      { httpStatus: 400, fault: "customer" },
    );
    this.name = "GatewayTraceProjectUnknownError";
  }
}

/**
 * Key does not specify a trace destination; falls back to governance project
 * on read, but rejected at write.
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
 * counting — an error payload is not a listing endpoint.
 * `reachable_project_count` gives the true total instead of the sample.
 */
const REACHABLE_PROJECT_HINT_LIMIT = 10;

/**
 * Budget written on a scope no active keys reach; silently-failing spending
 * control rejected at write-time.
 */
export class GatewayBudgetScopeUnreachableError extends HandledError {
  declare readonly code: "gateway_budget_scope_unreachable";

  constructor({
    scopeType,
    reachableProjectIds,
  }: {
    /**
     * The three scopes whose reach depends on a key. The other four are
     * reachable by construction or matched directly. A wider type here would
     * let one onto the published `meta.scope_type`, which excludes them.
     */
    scopeType: "team" | "project" | "group";
    reachableProjectIds: string[];
  }) {
    super(
      "gateway_budget_scope_unreachable",
      "No active key sends traffic to that scope, so the budget would never spend",
      {
        meta: {
          scope_type: scopeType,
          reachable_project_ids: reachableProjectIds.slice(0, REACHABLE_PROJECT_HINT_LIMIT),
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
 * Rollup on unstable groups; page walk not exact until window settles.
 */
export class GatewaySpendGroupByUnstableError extends HandledError {
  declare readonly code: "gateway_spend_group_by_unstable";

  constructor({ groupBy, settlesAtMs }: { groupBy: string[]; settlesAtMs: number }) {
    super(
      "gateway_spend_group_by_unstable",
      "That grouping can still change over this window, so the page walk would not be exact",
      {
        meta: {
          group_by: groupBy,
          settles_at: Temporal.Instant.fromEpochMilliseconds(settlesAtMs).toString({
            fractionalSecondDigits: 3,
          }),
        },
        httpStatus: 400,
        fault: "customer",
      },
    );
    this.name = "GatewaySpendGroupByUnstableError";
  }
}

/**
 * Cycle anchor sent on non-cycling window (TOTAL, MANUAL); silently-failing
 * budget rejected.
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
