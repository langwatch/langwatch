import {
  HandledError,
  NotFoundError,
  remediation,
  ValidationError,
} from "@langwatch/handled-error";

export class GovernanceValidationError extends ValidationError {
  constructor(
    message: string,
    readonly meta: { formErrors: string[]; fieldErrors?: Record<string, string[]> },
  ) {
    super(message, { meta });
    this.name = "GovernanceValidationError";
  }
}

export function unsupportedGovernanceValue(input: {
  field: string;
  value: string;
  allowed: readonly string[];
}): GovernanceValidationError {
  const complaint = `Unsupported ${input.field} "${input.value}". Allowed: ${input.allowed.join(", ")}.`;
  return new GovernanceValidationError(complaint, {
    formErrors: [complaint],
  });
}

export const unsupportedValue = unsupportedGovernanceValue;

export class IngestionSourceNotFoundError extends NotFoundError {
  constructor(sourceId: string) {
    super("ingestion_source_not_found", { resource: "Ingestion source", id: sourceId });
    this.name = "IngestionSourceNotFoundError";
  }
}

export class AgentRegistryEntryNotFoundError extends NotFoundError {
  constructor(entryId: string) {
    super(
      "agent_registry_entry_not_found",
      { resource: "Agent registry entry", id: entryId },
      remediation("agent_registry_entry_not_found"),
    );
    this.name = "AgentRegistryEntryNotFoundError";
  }
}

export class IngestionSourceCapReachedError extends HandledError {
  declare readonly code: "ingestion_source_cap_reached";

  constructor(max: number) {
    super(
      "ingestion_source_cap_reached",
      `Non-enterprise plans are limited to ${max} ingestion sources.`,
      { httpStatus: 403, meta: { max } },
    );
    this.name = "IngestionSourceCapReachedError";
  }
}

/**
 * A legacy project API key reached a route that administers org governance
 * templates. Those keys bypass the `aiTools:manage` ceiling, so the route
 * demands the key name a member.
 */
export class UserBoundCallerRequiredError extends HandledError {
  declare readonly code: "user_token_required";

  constructor() {
    super(
      "user_token_required",
      "This endpoint requires a user-bound API key; legacy project API keys cannot administer organization governance templates.",
      { httpStatus: 403 },
    );
    this.name = "UserBoundCallerRequiredError";
  }
}

// ── Personal ingestion keys ─────────────────────────────────────────────────
//
// Moved from the composition package; a HandledError subclass belongs to the
// contract. All five codes are already registered in packages/handled-error.
// The behaviour they name is not built in this module yet.

/**
 * The caller has no personal workspace yet, so there is no project for a
 * personal key to reach. The remedy is finishing workspace setup, which is
 * a sign-in away.
 */
export class IngestionKeyWorkspaceMissingError extends HandledError {
  declare readonly code: "ingestion_key_workspace_missing";

  constructor() {
    super(
      "ingestion_key_workspace_missing",
      "Sign in to a personal workspace before issuing an ingestion key.",
      {
        httpStatus: 412,
        ...remediation("ingestion_key_workspace_missing"),
      },
    );
    this.name = "IngestionKeyWorkspaceMissingError";
  }
}

/**
 * The personal mint was asked for a source type it does not mint here: a
 * tool the CLI wraps asked for from the tile or the MCP tool, which have no
 * session to parent a key to, or a source type no published template names.
 */
export class IngestionKeySourceNotAllowedError extends HandledError {
  declare readonly code: "ingestion_key_source_not_allowed";

  constructor(sourceType: string) {
    super(
      "ingestion_key_source_not_allowed",
      `No personal ingestion key is minted for source type ${sourceType} here.`,
      {
        httpStatus: 400,
        meta: { sourceType },
        ...remediation("ingestion_key_source_not_allowed"),
      },
    );
    this.name = "IngestionKeySourceNotAllowedError";
  }
}

/**
 * No ingestion key of the caller's has that id in this organization. Another
 * person's key reads the same way, so the answer never confirms one exists.
 */
export class IngestionKeyNotFoundError extends HandledError {
  declare readonly code: "ingestion_key_not_found";

  constructor(apiKeyId: string) {
    super("ingestion_key_not_found", "Ingestion key not found.", {
      httpStatus: 404,
      meta: { apiKeyId },
      ...remediation("ingestion_key_not_found"),
    });
    this.name = "IngestionKeyNotFoundError";
  }
}

/**
 * The login key behind this CLI session is already revoked, so nothing minted
 * under it would outlive the next cascade. The device signs in again instead.
 */
export class IngestionKeySessionRevokedError extends HandledError {
  declare readonly code: "ingestion_key_session_revoked";

  constructor() {
    super(
      "ingestion_key_session_revoked",
      "This device session is signed out. Sign in again to mint an ingestion key.",
      {
        httpStatus: 401,
        ...remediation("ingestion_key_session_revoked"),
      },
    );
    this.name = "IngestionKeySessionRevokedError";
  }
}

/**
 * A rotation that could not revoke every key it replaces, so it minted none:
 * reporting success while one is still live would be a false statement about
 * the old ones. Retrying is safe, and `meta.survivors` names the holdouts.
 */
export class IngestionKeyRevokeIncompleteError extends HandledError {
  declare readonly code: "ingestion_key_revoke_incomplete";

  constructor(survivors: readonly string[]) {
    super(
      "ingestion_key_revoke_incomplete",
      `Could not revoke ${survivors.length} of the previous ingestion keys, so no new key was minted.`,
      {
        httpStatus: 409,
        fault: "platform",
        meta: { survivors: [...survivors] },
        ...remediation("ingestion_key_revoke_incomplete"),
      },
    );
    this.name = "IngestionKeyRevokeIncompleteError";
  }
}

/**
 * A puller could not obtain the bearer its provider calls need. Three reasons
 * because they are three next actions: fill the credential in, fix it, or try
 * again. `message` names the status at most, never the provider's reply.
 */
export class ProviderSignInError extends Error {
  readonly reason: "not_configured" | "refused" | "malformed_response";
  /** The sign-in endpoint's status, when the failure had one. */
  readonly status: number | null;

  constructor(
    message: string,
    params: { reason: "not_configured" | "refused" | "malformed_response"; status?: number },
  ) {
    super(message);
    this.name = "ProviderSignInError";
    this.reason = params.reason;
    this.status = params.status ?? null;
  }
}

/**
 * Erasure asked for with no digest secret: fatal, never defaulted, because a list hashed
 * with an empty secret looks real and protects nothing.
 */
export class ErasureSecretMissingError extends Error {
  constructor(reason: string) {
    super(
      `Governance erasure needs GOVERNANCE_ERASURE_PSEUDONYM_SECRET to be set to at least 32 characters (${reason}). Generate one with \`openssl rand -hex 32\`, set it once, and never change it: every digest already stored is a function of this value.`,
    );
    this.name = "ErasureSecretMissingError";
  }
}

/** The erasure named a person this organization does not hold. */
export class DiscoveredPersonNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscoveredPersonNotFoundError";
  }
}

/** The suggestion is gone — confirmed already, or replaced by a later pass (ADR-128 §12). */
export class IdentityMatchSuggestionNotFoundError extends NotFoundError {
  declare readonly code: "identity_match_suggestion_not_found";

  constructor(suggestionId: string) {
    super("identity_match_suggestion_not_found", {
      resource: "Match suggestion",
      id: suggestionId,
    });
    this.name = "IdentityMatchSuggestionNotFoundError";
  }
}

/** The person already holds an open link; also what a 23505 on the one-open-link index maps to. */
export class IdentityAlreadyLinkedError extends HandledError {
  declare readonly code: "identity_already_linked";

  constructor(discoveredPersonId: string) {
    super("identity_already_linked", "This person is already linked to an account", {
      httpStatus: 409,
      fault: "customer",
      meta: { discoveredPersonId },
    });
    this.name = "IdentityAlreadyLinkedError";
  }
}

/** An erased person may never carry an account again — the last guard on a stale queue click. */
export class IdentityErasedError extends HandledError {
  declare readonly code: "identity_erased";

  constructor(discoveredPersonId: string) {
    super("identity_erased", "This person has been erased and cannot be linked to an account", {
      httpStatus: 409,
      fault: "customer",
      meta: { discoveredPersonId },
    });
    this.name = "IdentityErasedError";
  }
}

/**
 * Listings cannot run here (no event sourcing, or no governance project); no provider
 * was reached, so no outcome is coming later. `reason` rides in meta for the log.
 */
export class AgentListingUnavailableError extends HandledError {
  declare readonly code: "agent_listing_unavailable";

  constructor(reason: "event_sourcing_disabled" | "no_governance_project") {
    super("agent_listing_unavailable", "Agent sync isn't available here", {
      httpStatus: 503,
      fault: "platform",
      meta: { reason },
    });
    this.name = "AgentListingUnavailableError";
  }
}

/**
 * A push receiver's bearer names no ingestion source, or names one other than the path's. One
 * refusal for both, so the answer never confirms that some other source id exists.
 */
export class IngestionSourceUnauthorizedError extends HandledError {
  declare readonly code: "ingestion_source_unauthorized";

  constructor() {
    super("ingestion_source_unauthorized", "The ingestion source secret was not recognized.", {
      httpStatus: 401,
      fault: "customer",
    });
    this.name = "IngestionSourceUnauthorizedError";
  }
}

/**
 * The secret and the path name the same source, but an admin disabled it. The caller has proved
 * it holds the secret, so naming the state leaks nothing, and OTLP exporters drop a 403 for good.
 */
export class IngestionSourceDisabledError extends HandledError {
  declare readonly code: "ingestion_source_disabled";

  constructor() {
    super("ingestion_source_disabled", "This ingestion source is disabled.", {
      httpStatus: 403,
      fault: "customer",
      ...remediation("ingestion_source_disabled"),
    });
    this.name = "IngestionSourceDisabledError";
  }
}

/** One caller sent more to the push receivers than the window allows; it retries after the wait. */
export class IngestionRateLimitedError extends HandledError {
  declare readonly code: "ingestion_rate_limited";

  constructor({ retryAfterSec }: { retryAfterSec: number }) {
    super(
      "ingestion_rate_limited",
      "Too many requests from this client. Slow down and retry after the Retry-After window.",
      {
        httpStatus: 429,
        retryable: true,
        fault: "customer",
        meta: { retryAfterMs: retryAfterSec * 1000 },
      },
    );
    this.name = "IngestionRateLimitedError";
  }
}

/** The source's type is not served at the path it was sent to. */
export class IngestionWrongEndpointError extends HandledError {
  declare readonly code: "ingestion_wrong_endpoint";

  constructor(description: string) {
    super("ingestion_wrong_endpoint", description, { httpStatus: 400, fault: "customer" });
    this.name = "IngestionWrongEndpointError";
  }
}

/** Not all of the request was taken; the exporter resends it whole and what was taken dedupes. */
export class IngestionReceiverUnavailableError extends HandledError {
  declare readonly code: "ingestion_receiver_unavailable";

  constructor() {
    super("ingestion_receiver_unavailable", "The ingestion receiver is temporarily unavailable.", {
      httpStatus: 503,
      retryable: true,
      fault: "platform",
    });
    this.name = "IngestionReceiverUnavailableError";
  }
}

// ── Agent kill switch (specs/agent-kill-switch.feature) ─────────────────────

/** A plan target names a source, AWS connection or virtual key the organisation does not hold. */
export class AgentStopTargetInvalidError extends HandledError {
  declare readonly code: "agent_stop_target_invalid";

  constructor(meta: { position: number; kind: string; reason: string }) {
    super("agent_stop_target_invalid", "A stop plan target is not valid for this organisation.", {
      httpStatus: 422,
      fault: "customer",
      meta,
      ...remediation("agent_stop_target_invalid"),
    });
    this.name = "AgentStopTargetInvalidError";
  }
}

/** A plan target names a Bedrock alias or a serving endpoint its platform does not have. */
export class AgentStopTargetNotFoundError extends HandledError {
  declare readonly code: "agent_stop_target_not_found";

  constructor(meta: { position: number; kind: string }) {
    super("agent_stop_target_not_found", "A stop plan target does not exist on its platform.", {
      httpStatus: 422,
      fault: "customer",
      meta,
      ...remediation("agent_stop_target_not_found"),
    });
    this.name = "AgentStopTargetNotFoundError";
  }
}

export class AgentStopPlanEmptyError extends HandledError {
  declare readonly code: "agent_stop_plan_empty";

  constructor(agentId: string) {
    super("agent_stop_plan_empty", "The agent has no stop plan to apply.", {
      httpStatus: 409,
      fault: "customer",
      meta: { agentId },
      ...remediation("agent_stop_plan_empty"),
    });
    this.name = "AgentStopPlanEmptyError";
  }
}

/** The plan changed after the caller read it, so the stop would act on unconfirmed targets. */
export class AgentStopPlanChangedError extends HandledError {
  declare readonly code: "agent_stop_plan_changed";

  constructor(agentId: string) {
    super("agent_stop_plan_changed", "The agent's stop plan changed since it was read.", {
      httpStatus: 409,
      fault: "customer",
      meta: { agentId },
      ...remediation("agent_stop_plan_changed"),
    });
    this.name = "AgentStopPlanChangedError";
  }
}

/** The plan was saved by someone else after the caller read it; the newer plan is kept. */
export class AgentStopPlanConflictError extends HandledError {
  declare readonly code: "agent_stop_plan_conflict";

  constructor({
    agentId,
    expectedVersion,
    version,
  }: {
    agentId: string;
    expectedVersion: number;
    version: number;
  }) {
    super("agent_stop_plan_conflict", "The agent's stop plan was saved since it was read.", {
      httpStatus: 409,
      fault: "customer",
      meta: { agentId, expectedVersion, version },
      ...remediation("agent_stop_plan_conflict"),
    });
    this.name = "AgentStopPlanConflictError";
  }
}

/** A plan target or an unrestored stop still signs with the connection. */
export class GovernanceAwsConnectionInUseError extends HandledError {
  declare readonly code: "governance_aws_connection_in_use";

  constructor(meta: { connectionId: string; agentIds: string[] }) {
    super(
      "governance_aws_connection_in_use",
      "A stop plan or an open stop still uses this AWS connection.",
      {
        httpStatus: 409,
        fault: "customer",
        meta,
        ...remediation("governance_aws_connection_in_use"),
      },
    );
    this.name = "GovernanceAwsConnectionInUseError";
  }
}

export class AgentStopAlreadyOpenError extends HandledError {
  declare readonly code: "agent_stop_already_open";

  constructor(meta: { agentId: string; stopId: string }) {
    super("agent_stop_already_open", "The agent already has an open stop.", {
      httpStatus: 409,
      fault: "customer",
      meta,
      ...remediation("agent_stop_already_open"),
    });
    this.name = "AgentStopAlreadyOpenError";
  }
}

export class AgentStopNotPendingError extends HandledError {
  declare readonly code: "agent_stop_not_pending";

  constructor(meta: { stopId: string; status: string }) {
    super("agent_stop_not_pending", "The stop is no longer waiting for an approval.", {
      httpStatus: 409,
      fault: "customer",
      meta,
      ...remediation("agent_stop_not_pending"),
    });
    this.name = "AgentStopNotPendingError";
  }
}

export class AgentStopSelfApprovalError extends HandledError {
  declare readonly code: "agent_stop_self_approval";

  constructor(stopId: string) {
    super("agent_stop_self_approval", "The credential that requested a stop cannot approve it.", {
      httpStatus: 409,
      fault: "customer",
      meta: { stopId },
      ...remediation("agent_stop_self_approval"),
    });
    this.name = "AgentStopSelfApprovalError";
  }
}

export class AgentStopNotRestorableError extends HandledError {
  declare readonly code: "agent_stop_not_restorable";

  constructor(meta: { stopId: string; status: string }) {
    super("agent_stop_not_restorable", "The stop cannot be restored in its current status.", {
      httpStatus: 409,
      fault: "customer",
      meta,
      ...remediation("agent_stop_not_restorable"),
    });
    this.name = "AgentStopNotRestorableError";
  }
}

export class AgentStopNotRetryableError extends HandledError {
  declare readonly code: "agent_stop_not_retryable";

  constructor(meta: { stopId: string; status: string }) {
    super("agent_stop_not_retryable", "The stop cannot be retried in its current status.", {
      httpStatus: 409,
      fault: "customer",
      meta,
      ...remediation("agent_stop_not_retryable"),
    });
    this.name = "AgentStopNotRetryableError";
  }
}

export class AgentStopNotFoundError extends NotFoundError {
  constructor(id: string) {
    super(
      "agent_stop_not_found",
      { resource: "Agent stop", id },
      remediation("agent_stop_not_found"),
    );
    this.name = "AgentStopNotFoundError";
  }
}

export class GovernanceAwsConnectionNotFoundError extends NotFoundError {
  constructor(id: string) {
    super(
      "governance_aws_connection_not_found",
      { resource: "AWS connection", id },
      remediation("governance_aws_connection_not_found"),
    );
    this.name = "GovernanceAwsConnectionNotFoundError";
  }
}
