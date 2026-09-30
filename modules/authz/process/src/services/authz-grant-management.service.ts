/**
 * `/api/grants` over the binding writer: the same guards as `/api/role-bindings`
 * (escalation, limit, last admin), answering in the grants family's own codes.
 * specs/rbac/grants-rest-api.feature.
 */
import {
  ApiKeyNotInOrganizationError,
  AuthzPersonalWorkspaceNotManagedHereError,
  CustomRoleNotAssignableError,
  GrantNotFoundError,
  GrantPrincipalNotFoundError,
  GrantRoleNotFoundError,
  GrantScopeNotAllowedError,
  GrantScopeNotFoundError,
  GrantScopePersonalWorkspaceError,
  GroupNotInOrganizationError,
  OrgExclusivePermissionScopeError,
  RoleBindingNotFoundError,
  ScopeNotInOrganizationError,
  type AuthzChangeGrantRoleInput,
  type AuthzCreateGrantInput,
  type AuthzGetGrantInput,
  type AuthzListGrantsInput,
  type AuthzRevokeGrantByIdInput,
  type Grant,
  type GrantCreate,
  type GrantPage,
  type GrantRevoked,
} from "@langwatch/authz-contract";
import { UserNotInOrganizationError } from "@langwatch/organization-contract";
import { nowInstant, toDate } from "@langwatch/time";

import {
  findCursorPosition,
  grantWire,
  pageGrants,
  storedRole,
  storedScopeType,
} from "../rules/grant-wire.rules.ts";
import type {
  AuthzBindingWriterPermissions,
  AuthzBindingWriterService,
} from "./authz-binding-writer.service.ts";

type RefusalContext = Readonly<{
  grantId?: string;
  grant?: GrantCreate;
  roleId?: string;
}>;

/** The old door's refusal, spoken in the grants family's codes; anything else passes through. */
function grantRefusalOf({ error, context }: { error: unknown; context: RefusalContext }): unknown {
  const principal = context.grant?.principal;
  const scope = context.grant?.scope;
  const principalMissing =
    error instanceof UserNotInOrganizationError ||
    error instanceof GroupNotInOrganizationError ||
    error instanceof ApiKeyNotInOrganizationError;
  if (principalMissing && principal) {
    return new GrantPrincipalNotFoundError({
      principalType: principal.type,
      principalId: principal.id,
    });
  }
  if (error instanceof CustomRoleNotAssignableError) {
    return new GrantRoleNotFoundError(context.roleId ?? context.grant?.roleId ?? "");
  }
  if (error instanceof ScopeNotInOrganizationError && scope) {
    return new GrantScopeNotFoundError({ scopeType: scope.type, scopeId: scope.id });
  }
  if (error instanceof OrgExclusivePermissionScopeError) {
    return new GrantScopeNotAllowedError({
      permission: String(error.meta.permission),
      scopeType: String(error.meta.scopeType),
    });
  }
  if (error instanceof AuthzPersonalWorkspaceNotManagedHereError) {
    return new GrantScopePersonalWorkspaceError({ scopeId: scope?.id ?? "" });
  }
  if (error instanceof RoleBindingNotFoundError && context.grantId) {
    return new GrantNotFoundError(context.grantId);
  }

  return error;
}

async function speakingGrants<T>({
  run,
  context,
}: {
  run: () => Promise<T>;
  context: RefusalContext;
}): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw grantRefusalOf({ error, context });
  }
}

function principalFieldsOf(principal: GrantCreate["principal"]): {
  userId?: string;
  groupId?: string;
  apiKeyId?: string;
} {
  if (principal.type === "user") return { userId: principal.id };
  if (principal.type === "group") return { groupId: principal.id };

  return { apiKeyId: principal.id };
}

export class AuthzGrantManagementService {
  static create(options: {
    writer: AuthzBindingWriterService;
    permissions: AuthzBindingWriterPermissions;
  }): AuthzGrantManagementService {
    return new AuthzGrantManagementService(options);
  }

  private constructor(
    private readonly options: {
      writer: AuthzBindingWriterService;
      permissions: AuthzBindingWriterPermissions;
    },
  ) {}

  async list({ organizationId, query }: AuthzListGrantsInput): Promise<GrantPage> {
    const [after] = query.cursor ? findCursorPosition(query.cursor) : [];

    return pageGrants({ grants: await this.grantsOf(organizationId), query, after });
  }

  async get({ organizationId, grantId }: AuthzGetGrantInput): Promise<Grant> {
    const [grant] = await this.findGrant({ organizationId, grantId });
    if (!grant) throw new GrantNotFoundError(grantId);

    return grant;
  }

  async create({ organizationId, grant, caller, actor }: AuthzCreateGrantInput): Promise<Grant> {
    const { role, customRoleId } = storedRole(grant.roleId);
    const created = await speakingGrants({
      context: { grant },
      run: () =>
        this.options.writer.create({
          organizationId,
          ...principalFieldsOf(grant.principal),
          role,
          ...(customRoleId === null ? {} : { customRoleId }),
          scopeType: storedScopeType(grant.scope.type),
          scopeId: grant.scope.id,
          ...(grant.expiresAt === undefined ? {} : { expiresAt: grant.expiresAt }),
          actor,
          caller,
        }),
    });
    const [readBack] = await this.findGrant({ organizationId, grantId: created.id });

    return readBack ?? this.optimistic({ id: created.id, grant });
  }

  async changeRole({
    organizationId,
    grantId,
    roleId,
    caller,
    actor,
  }: AuthzChangeGrantRoleInput): Promise<Grant> {
    const { role, customRoleId } = storedRole(roleId);
    await speakingGrants({
      context: { grantId, roleId },
      run: () =>
        this.options.writer.update({
          organizationId,
          bindingId: grantId,
          role,
          ...(customRoleId === null ? {} : { customRoleId }),
          actor,
          caller,
        }),
    });
    const [grant] = await this.findGrant({ organizationId, grantId });
    // The row was read before the change, so its absence is not lag: nothing to act on (ADR-045).
    if (!grant) throw new Error(`Grant ${grantId} was changed but does not read back`);

    return grant;
  }

  async revoke({
    organizationId,
    grantId,
    actor,
  }: AuthzRevokeGrantByIdInput): Promise<GrantRevoked> {
    await speakingGrants({
      context: { grantId },
      run: () => this.options.writer.delete({ organizationId, bindingId: grantId, actor }),
    });

    return { id: grantId, revoked: true };
  }

  private async grantsOf(organizationId: string): Promise<Grant[]> {
    const rows = await this.options.permissions.listManagedBindingsForOrganization({
      organizationId,
    });
    const nowMs = nowInstant().epochMilliseconds;

    return rows.map((row) => grantWire({ row, nowMs }));
  }

  private async findGrant({
    organizationId,
    grantId,
  }: {
    organizationId: string;
    grantId: string;
  }): Promise<Grant[]> {
    const grants = await this.grantsOf(organizationId);

    return grants.filter((grant) => grant.id === grantId);
  }

  /** The projection is still behind the append: answer with what was written, names unread. */
  private optimistic({ id, grant }: { id: string; grant: GrantCreate }): Grant {
    const { role } = storedRole(grant.roleId);
    const builtIn = role !== "CUSTOM";

    return {
      id,
      principal: { type: grant.principal.type, id: grant.principal.id, name: null },
      role: { id: grant.roleId, name: null, builtIn },
      scope: { type: grant.scope.type, id: grant.scope.id, name: null },
      status: "active",
      expiresAt: grant.expiresAt ?? null,
      createdAt: toDate(nowInstant()),
    };
  }
}
