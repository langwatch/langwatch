import { HandledError, NotFoundError, ValidationError } from "@langwatch/handled-error";

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
