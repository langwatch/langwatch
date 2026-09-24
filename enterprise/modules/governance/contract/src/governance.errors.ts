import {
  HandledError,
  NotFoundError,
  remediation,
  ValidationError,
} from "@langwatch/handled-error";

export class PersonalVirtualKeyLabelTakenError extends HandledError {
  declare readonly code: "personal_virtual_key_label_taken";

  constructor(label: string) {
    super("personal_virtual_key_label_taken", "A personal key with this label already exists", {
      httpStatus: 409,
      meta: { label },
    });
    this.name = "PersonalVirtualKeyLabelTakenError";
  }
}

export class NoEligibleModelProvidersError extends HandledError {
  declare readonly code: "no_eligible_model_providers";

  constructor(organizationId: string) {
    super("no_eligible_model_providers", "The organization has no usable model provider", {
      httpStatus: 409,
      meta: { organizationId },
    });
    this.name = "NoEligibleModelProvidersError";
  }
}

export class RoutingPolicyEmptyError extends HandledError {
  declare readonly code: "routing_policy_has_no_providers";

  constructor(routingPolicyId: string, routingPolicyName: string) {
    super("routing_policy_has_no_providers", "That routing policy has no providers on it", {
      httpStatus: 422,
      meta: { routingPolicyId, routingPolicyName },
    });
    this.name = "RoutingPolicyEmptyError";
  }
}

export class PersonalVirtualKeyMissingError extends HandledError {
  declare readonly code: "virtual_key_not_found";

  constructor(virtualKeyId: string) {
    super("virtual_key_not_found", "Personal virtual key not found", {
      httpStatus: 404,
      meta: { virtualKeyId },
    });
    this.name = "PersonalVirtualKeyMissingError";
  }
}

export class RoutingPolicyProviderRequiredError extends HandledError {
  declare readonly code: "routing_policy_must_have_provider";

  constructor() {
    super("routing_policy_must_have_provider", "A routing policy needs at least one provider", {
      httpStatus: 422,
    });
    this.name = "RoutingPolicyProviderRequiredError";
  }
}

export class RoutingPolicyScopeRequiredError extends HandledError {
  declare readonly code: "routing_policy_must_have_scope";

  constructor() {
    super("routing_policy_must_have_scope", "A routing policy needs at least one scope", {
      httpStatus: 422,
    });
    this.name = "RoutingPolicyScopeRequiredError";
  }
}

export class RoutingPolicyModelNotConcreteError extends HandledError {
  declare readonly code: "routing_policy_model_must_be_concrete";

  constructor(field: string, value: string) {
    super(
      "routing_policy_model_must_be_concrete",
      "That model name does not point at one specific model",
      { httpStatus: 422, meta: { field, value } },
    );
    this.name = "RoutingPolicyModelNotConcreteError";
  }
}

export class SessionPolicyOutOfRangeError extends HandledError {
  constructor(
    readonly value: number,
    readonly maxDays: number,
  ) {
    super(
      "governance:session_policy_out_of_range",
      `maxSessionDurationDays must be an integer between 0 and ${maxDays} (got ${value})`,
      { httpStatus: 400, meta: { value, maxDays } },
    );
  }
}

export class GovernanceValidationError extends ValidationError {
  constructor(
    message: string,
    readonly meta: { formErrors: string[] },
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
    super("ingestion_source_not_found", "Ingestion source", sourceId);
    this.name = "IngestionSourceNotFoundError";
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

export class PersonalWorkspaceMissingError extends Error {
  constructor() {
    super(
      "No personal project for caller. Sign in to a personal workspace before issuing an ingestion key.",
    );
    this.name = "PersonalWorkspaceMissingError";
  }
}

/**
 * The personal mint was asked for a source type no wrapped tool stamps. Named
 * so the route can answer with the request as the cause and keep every other
 * failure a server fault.
 */
export class PersonalSourceTypeNotAllowedError extends Error {
  constructor(sourceType: string) {
    super(`No personal ingestion key is minted for source type ${sourceType}.`);
    this.name = "PersonalSourceTypeNotAllowedError";
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
    super("identity_match_suggestion_not_found", "Match suggestion", suggestionId);
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
