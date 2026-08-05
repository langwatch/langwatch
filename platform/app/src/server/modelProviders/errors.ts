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

/**
 * The model a request resolved to names a provider this project has not set
 * up. Something is connected, it is just not the thing this model needs, which
 * is the distinction `missing_provider` already draws against the Go-side
 * `no_provider_configured` ("nothing connected at all").
 *
 * Thrown from `getVercelAIModel` rather than left as a plain `Error`: the cause
 * is known and the caller can act on it, so it is the ADR-045 test passing
 * rather than an infra failure being dressed up. The remediation sentence that
 * used to ride inside the message now lives in the presentation registry,
 * which is where the words a customer reads belong.
 */
export class ModelProviderNotConfiguredError extends HandledError {
  declare readonly code: "missing_provider";

  constructor(providerKey: string) {
    super(
      "missing_provider",
      `Model provider "${providerKey}" is not configured for this project.`,
      { meta: { providerKey }, httpStatus: 400, fault: "customer" },
    );
    this.name = "ModelProviderNotConfiguredError";
  }
}

/**
 * The provider behind the resolved model exists but is switched off.
 *
 * Deliberately lighter than {@link ModelProviderDisabledError}, which carries
 * the whole cascade context (feature, role, scope, alternate) so the frontend
 * can offer a one-click swap. This one is reached on the explicit-model path,
 * where none of that context exists. Same code, so the customer reads the same
 * copy either way.
 */
export class ModelProviderNotEnabledError extends HandledError {
  declare readonly code: "model_provider_disabled";

  constructor(providerKey: string) {
    super(
      "model_provider_disabled",
      `Model provider "${providerKey}" is configured but disabled.`,
      { meta: { providerKey }, httpStatus: 400, fault: "customer" },
    );
    this.name = "ModelProviderNotEnabledError";
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
