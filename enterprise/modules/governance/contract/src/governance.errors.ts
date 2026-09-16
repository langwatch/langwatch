import { HandledError, NotFoundError, remediation, ValidationError } from "@langwatch/handled-error";

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
