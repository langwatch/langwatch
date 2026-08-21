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
      // One fixed sentence, because a REST caller is shown it verbatim. Which
      // handle would satisfy the call is a fact, not copy: it rides in
      // `meta.requires`, where the client's presentation registry reads it and
      // picks between "a project" and "a project or an organization". Naming
      // the requirement inline printed the raw enum value at the customer
      // ("requires: project_or_organization") and duplicated the registry.
      "Say which project or organization this model provider applies to.",
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

/**
 * The call tried to create a row under a provider that no longer accepts
 * them.
 *
 * A deprecated provider has been absorbed into another one; its stored rows
 * stay fully usable so no deployment is stranded mid-fold, but the population
 * has to be able to reach zero, or the compatibility entry can never be
 * deleted. Hiding the tile handles the UI; this handles everyone else.
 *
 * Editing, disabling and deleting an existing row are all still allowed —
 * only creation is closed, which is why the check keys on there being no
 * existing row rather than on the provider alone.
 *
 * `replacement` rides in `meta` rather than in the sentence: which provider
 * to use instead is a fact the client's presentation registry turns into
 * words, and an API caller reads the slug directly.
 */
export class ModelProviderDeprecatedError extends HandledError {
  declare readonly code: "model_provider_deprecated";

  constructor({
    provider,
    replacement,
  }: {
    provider: string;
    replacement?: string;
  }) {
    super(
      "model_provider_deprecated",
      "This model provider is no longer available to add.",
      {
        meta: { provider, ...(replacement ? { replacement } : {}) },
        httpStatus: 400,
        fault: "customer",
      },
    );
    this.name = "ModelProviderDeprecatedError";
  }
}

/**
 * The caller cannot manage one of the scopes a write would touch.
 *
 * A create / update / delete can affect several scope entries at once, and the
 * check is fail-closed: the first entry the caller cannot manage rejects the
 * whole call, so a team admin can never quietly rewrite an org-level row.
 *
 * Handled rather than the `TRPCError({ code: "FORBIDDEN" })` this replaced: the
 * cause is known and the caller can act on it (ask someone who holds the
 * permission), which is the ADR-045 test. It also keeps the de-tRPC'd service
 * layer free of a transport's error type — every write path routes through
 * here, so a `TRPCError` in this module put one back on every create, update
 * and delete.
 *
 * `scopeType` and `requiredPermission` ride in `meta` rather than in the
 * sentence: the client's presentation registry decides the words, and the
 * permission slug is a fact an API/CLI caller reads, not prose.
 */
export class ModelProviderScopeForbiddenError extends HandledError {
  declare readonly code: "model_provider_scope_forbidden";

  constructor({
    scopeType,
    requiredPermission,
  }: {
    scopeType: string;
    requiredPermission: string;
  }) {
    super(
      "model_provider_scope_forbidden",
      "You don't have permission to manage model providers here.",
      {
        meta: { scopeType, requiredPermission },
        httpStatus: 403,
        fault: "customer",
      },
    );
    this.name = "ModelProviderScopeForbiddenError";
  }
}

/**
 * The caller cannot manage one of the scopes a default-models write would
 * touch.
 *
 * Same shape and rationale as {@link ModelProviderScopeForbiddenError}, with
 * its own code because the copy differs: this one is about the Default Models
 * policies, not the provider credentials. Every default-models write path
 * (tRPC drawer save, REST create/update/delete) routes through
 * `assertCanWriteScope`, which raises this. A plain `Error` here used to
 * surface as an unknown 500 and log a routine permission refusal as an
 * incident.
 */
export class ModelDefaultScopeForbiddenError extends HandledError {
  declare readonly code: "model_default_scope_forbidden";

  constructor({
    scopeType,
    requiredPermission,
  }: {
    scopeType: string;
    requiredPermission: string;
  }) {
    super(
      "model_default_scope_forbidden",
      "You don't have permission to manage default models here.",
      {
        meta: { scopeType, requiredPermission },
        httpStatus: 403,
        fault: "customer",
      },
    );
    this.name = "ModelDefaultScopeForbiddenError";
  }
}

/**
 * Too many credential checks in too short a window.
 *
 * Every check is an outbound request from our servers carrying a customer's
 * credential, and the control that triggers it sits one click away in
 * settings. Without a ceiling the page is an egress amplifier: rows multiply
 * across provider types, projects and scopes, so the budget is the
 * organization's rather than the row's.
 *
 * `retryAfterSeconds` rides in `meta` so the client can say how long rather
 * than inventing a number — the sentence here is the fallback for callers
 * that render the message directly.
 */
export class ModelProviderTestRateLimitedError extends HandledError {
  declare readonly code: "model_provider_test_rate_limited";

  constructor({ retryAfterSeconds }: { retryAfterSeconds: number }) {
    super(
      "model_provider_test_rate_limited",
      "Too many connection tests. Wait a moment and try again.",
      {
        meta: { retryAfterSeconds },
        httpStatus: 429,
        fault: "customer",
      },
    );
    this.name = "ModelProviderTestRateLimitedError";
  }
}

/**
 * A write carried credentials, but none of the ones this provider declares,
 * while the row on file holds some. Applying it would leave the provider with
 * no credential at all.
 *
 * The merge keeps a stored value when the payload sends the masked
 * placeholder for it. A key the payload never mentions has no such signal, so
 * it is dropped, and a payload naming no credential at all drops every one of
 * them. That is never what a caller means: clearing a credential is sending it
 * empty, not leaving it out.
 *
 * Refusing rather than repairing, because the payload does not say what was
 * intended and a guess would be silently wrong in the other direction. The
 * check exists because the same silent loss has now arrived twice by different
 * routes, and both times the provider's schema was loose enough to accept the
 * short payload without complaint.
 */
export class ModelProviderCredentialsWouldBeDroppedError extends HandledError {
  declare readonly code: "model_provider_credentials_would_be_dropped";

  constructor({ provider }: { provider: string }) {
    super(
      "model_provider_credentials_would_be_dropped",
      "This save would delete the credentials already stored for this provider. Send the credentials with it, or leave them out of the request entirely to keep them.",
      {
        meta: { provider },
        httpStatus: 400,
        fault: "customer",
      },
    );
    this.name = "ModelProviderCredentialsWouldBeDroppedError";
  }
}

/**
 * A save would replace credentials the server holds but cannot read.
 *
 * Separate from `ModelProviderCredentialsWouldBeDroppedError` because the
 * advice differs. There the stored value is fine and the save just has to stop
 * leaving it out; here the stored value will not decrypt, usually because
 * CREDENTIALS_SECRET changed after the row was written, so the only way
 * forward is a new credential. Letting the save through would overwrite
 * ciphertext that restoring the old secret would have recovered.
 */
export class ModelProviderCredentialsUnreadableError extends HandledError {
  declare readonly code: "model_provider_credentials_unreadable";

  constructor({ provider }: { provider: string }) {
    super(
      "model_provider_credentials_unreadable",
      "The credentials stored for this provider cannot be read, so this save would replace them with nothing. Send new credentials with it.",
      {
        meta: { provider },
        httpStatus: 400,
        fault: "customer",
      },
    );
    this.name = "ModelProviderCredentialsUnreadableError";
  }
}
