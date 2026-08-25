/**
 * ADR-092 §11 — everything GrantsService refuses to write, and why. Split
 * out of the service so grants.service.ts reads as the four verbs plus
 * offboarding: the rules a write must satisfy (tenancy of the scope,
 * tenancy AND vocabulary of a custom role, existence of the row a write
 * targets) and the naming of the two knowable storage failures all live
 * here.
 *
 * These are module functions, not methods: they hold no state. The tenancy
 * and existence checks are questions asked of storage; the rest
 * (unknownPermissions, principalWhere, rethrowKnownWriteFailure) are pure
 * translations that never touch it.
 */
import { type AuthzScopeRef, isRegistryPermission } from "@langwatch/authz";
import { HandledError } from "@langwatch/handled-error";
import type {
  AuthzGrantsRepository,
  BindingPrincipalWhere,
} from "./authz-grants.repository";
import type { GrantPrincipal, GrantRole } from "./grants.service";

export class GrantValidationError extends HandledError {
  constructor(message: string, meta: Record<string, unknown> = {}) {
    super("grant_validation_failed", message, { httpStatus: 400, meta });
    this.name = "GrantValidationError";
  }
}

/**
 * An identical grant (same principal, role, and scope) already exists.
 *
 * Speaks the REST surface's frozen contract (delivery-plan decision 21,
 * `role-bindings-rest-api.feature`): the SAME code and status the
 * `/role-bindings` API has always answered — a deterministic 409 a
 * provisioning tool can treat as "already done". Reconciled here (PR 2)
 * BEFORE the write paths moved onto the ledger, so the wire never wobbled
 * between 400 `grant_validation_failed` and the contract.
 *
 * THE canonical thrower for `role_binding_already_exists`: every grant write
 * that goes through GrantsService — which is every write the ledger owns —
 * raises this class, lifted from the port's storage-level
 * `DuplicateBindingError` by `rethrowKnownWriteFailure`. The two carry the
 * same code on purpose: one is the storage signal, one is the customer's
 * answer, and matching by code (never `instanceof`) is what keeps them
 * interchangeable across a bundle or a serialisation boundary.
 *
 * One twin remains: `RoleBindingAlreadyExistsError`
 * (`platform/app/src/server/role-bindings/errors.ts`) declares the same code
 * for the legacy REST service that has not yet moved onto GrantsService. It
 * goes when that path does; until then
 * `platform/app/src/server/app-layer/authz/__tests__/duplicate-grant-code.unit.test.ts`
 * pins the two to one customer-visible contract, so they cannot drift into
 * answering the same code two different ways. A package cannot import the
 * app's remediation registry, so the agent-facing `tips` for this code live
 * there, keyed by code, and are attached by whichever class the path uses.
 */
export class DuplicateGrantError extends HandledError {
  declare readonly code: "role_binding_already_exists";

  constructor(meta: Record<string, unknown> = {}) {
    super(
      "role_binding_already_exists",
      "An identical role binding already exists",
      { httpStatus: 409, meta },
    );
    this.name = "DuplicateGrantError";
  }
}

/**
 * A grant was asked to expire at a moment that has already passed.
 *
 * Knowable and actionable, which is what earns it a code: the caller sent a
 * date, we can see it is behind us, and the fix is theirs (send a later one).
 * Writing it anyway would append a fact that grants nothing from the instant
 * it lands - an access change an admin would reasonably believe had worked.
 *
 * 422 rather than 400, matching the REST family's other input rejections
 * (`role_binding_principal_invalid`, `scope_not_in_organization`): the
 * request parsed, one of its values is unusable.
 */
export class GrantExpiryInPastError extends HandledError {
  declare readonly code: "grant_expiry_in_past";

  constructor(meta: Record<string, unknown> = {}) {
    super("grant_expiry_in_past", "A grant's expiry must be in the future", {
      httpStatus: 422,
      meta,
    });
    this.name = "GrantExpiryInPastError";
  }
}

/**
 * The organization's grants are still written the pre-ledger way, and the
 * legacy `RoleBinding` table has no column to hold an expiry.
 *
 * This is a refusal rather than a silent drop on purpose. The alternative -
 * accepting the expiry and storing a row that cannot carry it - produces a
 * grant an admin believes ends on Friday and which in fact never ends, which
 * is the exact failure the feature exists to prevent. The caller can act on
 * it: re-send without an expiry and revoke by hand, or wait for the
 * organization's migration.
 */
export class GrantExpiryUnsupportedError extends HandledError {
  declare readonly code: "grant_expiry_not_supported";

  constructor(meta: Record<string, unknown> = {}) {
    super(
      "grant_expiry_not_supported",
      "Expiring access is not available for this organization yet",
      { httpStatus: 409, meta },
    );
    this.name = "GrantExpiryUnsupportedError";
  }
}

/**
 * An expiry has to be strictly in the future AT WRITE TIME.
 *
 * Strictly: an expiry of exactly now is a grant that is already over, and
 * the collect-side comparison (`expiresAt <= now`) treats it as such. The two
 * halves agree on the boundary deliberately - a write this accepted and the
 * read immediately refused would be indistinguishable from a bug.
 *
 * `now` is passed, never read: the write surface takes its clock from its
 * caller for the same reason the collector does.
 */
export function assertExpiryInFuture({
  expiresAtMs,
  now,
  meta = {},
}: {
  expiresAtMs: number | undefined;
  now: number;
  meta?: Record<string, unknown>;
}): void {
  if (expiresAtMs === undefined) return;
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now) {
    throw new GrantExpiryInPastError({ ...meta, expiresAtMs });
  }
}

/** Every scope a role binding can name - the resource tier cannot. */
export type GrantableScope = Exclude<AuthzScopeRef, { type: "resource" }>;

export const SCOPE_TYPE_FOR_REF = {
  project: "PROJECT",
  team: "TEAM",
  organization: "ORGANIZATION",
} as const;

// Stage C5 replaces this rejection with real ResourceGrant storage; until
// then a resource scope has no row to write, so the write surface says so.
export const RESOURCE_SCOPE_REJECTION =
  "Resource-tier access is granted by sharing the resource, not by a role binding";

/** The one not-found shape, used for a missing binding AND for one owned by
 *  another organization: confirming that a foreign binding exists is itself
 *  a leak, so both answers are identical. `meta` carries whatever the caller
 *  actually named - a binding id when it had one, the scope it was writing at
 *  otherwise - because a fabricated id is worse than a missing field. */
export function bindingNotFound(
  meta: Record<string, unknown>,
): GrantValidationError {
  return new GrantValidationError("Role binding not found", meta);
}

/**
 * Name the two write failures the caller can act on and let everything else
 * through as-is (it degrades to "unknown" at the boundary, with the trace
 * id, which is the right answer for an infra fault).
 *
 * Duplicate: the partial unique indexes key on the role too, so it only
 * fires when the principal already holds this SAME role at the scope.
 * Missing: the row went away between the pre-read and the write, which the
 * caller should see as the same not-found the pre-read produces.
 *
 * Matched by CODE, not `instanceof`: the port's `DuplicateBindingError` /
 * `BindingMissingError` are the storage signal, and code is what survives a
 * bundle boundary or a serialisation hop that `instanceof` does not. `error`
 * is `unknown` here, so the shape is checked before the code is read.
 */
function portErrorCode(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }
  return undefined;
}

export function rethrowKnownWriteFailure(
  error: unknown,
  { bindingId, ...meta }: { bindingId?: string } & Record<string, unknown>,
): never {
  const code = portErrorCode(error);
  if (code === "role_binding_already_exists") {
    throw new DuplicateGrantError({
      ...meta,
      ...(bindingId ? { bindingId } : {}),
    });
  }
  if (code === "role_binding_not_found") {
    throw bindingNotFound({ ...meta, ...(bindingId ? { bindingId } : {}) });
  }
  throw error;
}

/** A binding exists AND belongs to the organization the caller named. */
export async function assertBindingInOrganization({
  repository,
  bindingId,
  organizationId,
}: {
  repository: AuthzGrantsRepository;
  bindingId: string;
  organizationId: string;
}): Promise<void> {
  const binding = await repository.findBinding({ bindingId });
  if (!binding || binding.organizationId !== organizationId) {
    throw bindingNotFound({ bindingId });
  }
}

export async function assertScopeBelongsToOrganization({
  repository,
  where,
  organizationId,
}: {
  repository: AuthzGrantsRepository;
  where: GrantableScope;
  organizationId: string;
}): Promise<void> {
  if (where.type === "organization") return;
  if (where.type === "team") {
    const team = await repository.findTeamOrganization({ teamId: where.id });
    if (team?.organizationId !== organizationId) {
      throw new GrantValidationError("Team is not in this organization", {
        teamId: where.id,
      });
    }
    return;
  }
  const lineage = await repository.findProjectLineage({ projectId: where.id });
  if (
    lineage?.organizationId !== organizationId ||
    lineage.teamId !== where.teamId
  ) {
    throw new GrantValidationError("Project is not in this scope", {
      projectId: where.id,
    });
  }
}

/**
 * Built-in role keys are already a closed union in the type system, so only
 * CUSTOM roles need checking - and they need two things: the role belongs to
 * this organization, and every permission it lists is in the registry. A
 * role carrying a string the registry never heard of grants nothing at
 * decide time, so binding to it silently produces a grant that does not
 * work; rejecting on the write is where the admin can still act on it.
 */
export async function assertRoleUsable({
  repository,
  role,
  organizationId,
}: {
  repository: AuthzGrantsRepository;
  role: GrantRole;
  organizationId: string;
}): Promise<void> {
  if (!("customRoleId" in role)) return;
  const { customRoleId } = role;
  const customRole = await repository.findCustomRole({ customRoleId });
  if (!customRole || customRole.organizationId !== organizationId) {
    throw new GrantValidationError(
      "Custom role does not belong to this organization",
      { customRoleId },
    );
  }
  const unknown = unknownPermissions(customRole.permissions);
  if (unknown.length > 0) {
    throw new GrantValidationError(
      "Custom role lists permissions that do not exist",
      { customRoleId, unknownPermissions: unknown },
    );
  }
}

/**
 * The entries of a stored custom-role payload the registry does not
 * recognise. A payload that is not an array carries no permissions at all
 * (the collector's lenient parse reads it as an empty list), so there is
 * nothing to reject.
 */
function unknownPermissions(permissions: unknown): string[] {
  if (!Array.isArray(permissions)) return [];
  return permissions
    .filter(
      (value) => typeof value !== "string" || !isRegistryPermission(value),
    )
    .map((value) => String(value));
}

export function principalWhere(who: GrantPrincipal): BindingPrincipalWhere {
  switch (who.type) {
    case "user":
      return { userId: who.id };
    case "group":
      return { groupId: who.id };
    case "apiKey":
      return { apiKeyId: who.id };
    default: {
      const unreachable: never = who;
      throw new Error(
        `unhandled grant principal: ${JSON.stringify(unreachable)}`,
      );
    }
  }
}
