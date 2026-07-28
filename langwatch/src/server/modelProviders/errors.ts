import { HandledError } from "@langwatch/handled-error";

/**
 * The model provider a read or write named does not exist, or is not visible
 * to the caller's scopes.
 *
 * Deliberately one error for both: telling a caller that a row exists but is
 * out of their scope is a membership oracle, and there is nothing they could
 * do with the answer either way. The remedy is the same — reload and pick from
 * what is actually there.
 *
 * A handled error rather than the `TRPCError({ code: "NOT_FOUND" })` this
 * replaced at five call sites: the cause is known and the caller can act on
 * it, which is the whole test (ADR-045). It also stops the service layer from
 * reaching for a transport's error type to say a domain thing.
 */
export class ModelProviderNotFoundError extends HandledError {
  declare readonly code: "model_provider_not_found";

  constructor() {
    super("model_provider_not_found", "Model provider not found", {
      httpStatus: 404,
      fault: "customer",
    });
    this.name = "ModelProviderNotFoundError";
  }
}

/** What the call was missing. Drives the copy; never rendered raw. */
export type ModelProviderAnchorRequirement =
  /** Either handle identifies the tenant, so either one will do. */
  | "project_or_organization"
  /** Deleting by provider NAME resolves within a project, so only a project will do. */
  | "project";

/**
 * The request did not say which tenant to act in.
 *
 * A provider belongs to an organization and reaches the scopes attached to it,
 * so a project handle (which resolves to its organization) or an organization
 * handle both work — except when deleting by provider name, which is the legacy
 * project-shaped contract and resolves only within a project.
 *
 * Coded rather than left as a `TRPCError({ code: "BAD_REQUEST" })`: an API or
 * SDK caller can fix this by sending the missing handle, which is exactly the
 * "known cause, actionable by the caller" test.
 */
export class ModelProviderAnchorRequiredError extends HandledError {
  declare readonly code: "model_provider_anchor_required";

  constructor(requires: ModelProviderAnchorRequirement) {
    super(
      "model_provider_anchor_required",
      `Model provider call is missing its tenant anchor (requires: ${requires})`,
      { meta: { requires }, httpStatus: 400, fault: "customer" },
    );
    this.name = "ModelProviderAnchorRequiredError";
  }
}

/**
 * A new provider anchored to an organization rather than a project carries no
 * scopes by default — there is no project to derive one from — so the call has
 * to say which scopes it is being set up for.
 */
export class ModelProviderScopesRequiredError extends HandledError {
  declare readonly code: "model_provider_scopes_required";

  constructor() {
    super(
      "model_provider_scopes_required",
      "A model provider created without a project must declare its scopes",
      { httpStatus: 400, fault: "customer" },
    );
    this.name = "ModelProviderScopesRequiredError";
  }
}
