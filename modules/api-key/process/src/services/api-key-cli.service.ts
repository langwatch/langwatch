import {
  ApiKeyAlreadyRevokedError,
  ApiKeyNotFoundError,
  CliKeySelectionInvalidError,
  cliKeySelectionSchema,
  loginKeyExpiresAt,
  CLI_LOGIN_KEY_NAME_PREFIX,
  type CliKeyScopeSummary,
  type CliKeySelection,
  type CliSessionKeyRevocation,
} from "@langwatch/api-key-contract";
import {
  ALL_PERMISSIONS,
  isRegistryPermission,
  type AuthzPermission,
} from "@langwatch/authz-contract";
import { Temporal, fromDate, nowInstant, toDate, type Instant } from "@langwatch/time";

import type { ApiKeyRepository } from "../repositories/api-key.repository.ts";
import type { ApiKeyGrantPolicyService } from "./api-key-grant-policy.service.ts";
import type { ApiKeyLifecycleService } from "./api-key-lifecycle.service.ts";
import type { ApiKeyDependencies } from "./api-key.service.ts";

export class ApiKeyCliService {
  static create(
    options: ApiKeyDependencies & { repository: ApiKeyRepository },
    policy: ApiKeyGrantPolicyService,
    lifecycle: ApiKeyLifecycleService,
  ): ApiKeyCliService {
    return new ApiKeyCliService({ repository: options.repository, options, policy, lifecycle });
  }

  private readonly repository: ApiKeyRepository;
  private readonly options: ApiKeyDependencies;
  private readonly policy: ApiKeyGrantPolicyService;
  private readonly lifecycle: ApiKeyLifecycleService;

  private constructor({
    repository,
    options,
    policy,
    lifecycle,
  }: {
    repository: ApiKeyRepository;
    options: ApiKeyDependencies;
    policy: ApiKeyGrantPolicyService;
    lifecycle: ApiKeyLifecycleService;
  }) {
    this.repository = repository;
    this.options = options;
    this.policy = policy;
    this.lifecycle = lifecycle;
  }

  async validateCliSelection(input: {
    userId: string;
    organizationId: string;
    selection: CliKeySelection;
  }): Promise<CliKeySelection> {
    const selection = cliKeySelectionSchema.parse(input.selection);
    const bindings = [
      ...new Map(
        selection.bindings.map((binding) => [`${binding.scopeType}:${binding.scopeId}`, binding]),
      ).values(),
    ];
    if (bindings.length === 0) {
      throw new CliKeySelectionInvalidError({ bindings: ["Select at least one scope"] });
    }

    const unknown = selection.permissions.filter((permission) => !isRegistryPermission(permission));
    if (unknown.length > 0) {
      throw new CliKeySelectionInvalidError({
        permissions: unknown.map((permission) => `Unknown permission "${permission}"`),
      });
    }

    const permissions = [...new Set(selection.permissions)].filter(
      (permission) =>
        bindings.some((binding) => binding.scopeType === "ORGANIZATION") ||
        !["organization:manage", "organization:delete", "team:manage"].includes(permission),
    );
    if (permissions.length === 0) {
      throw new CliKeySelectionInvalidError({
        permissions: ["Select at least one permission"],
      });
    }

    await this.policy.assertSelectionWithinCeiling({
      userId: input.userId,
      organizationId: input.organizationId,
      bindings: bindings.map((binding) => ({ ...binding, role: "CUSTOM" as const })),
      permissions,
    });

    return { bindings, permissions: permissions.toSorted() };
  }

  async findDefaultCliSelection(input: {
    userId: string;
    organizationId: string;
  }): Promise<CliKeySelection | null> {
    const defaults = ALL_PERMISSIONS.filter(
      (permission) =>
        !["organization:manage", "organization:delete", "team:manage"].includes(permission),
    ) as AuthzPermission[];
    if (await this.policy.isOrgAdmin(input)) {
      return {
        bindings: [{ scopeType: "ORGANIZATION", scopeId: input.organizationId }],
        permissions: [...defaults].toSorted(),
      };
    }

    const bindings = await this.options.authz.listUserBindings(input);
    const teamIds = [
      ...new Set(
        bindings
          .filter((binding) => binding.scopeType === "TEAM")
          .map((binding) => binding.scopeId),
      ),
    ];
    const heldByTeam = new Map<string, string[]>();
    for (const teamId of teamIds) {
      const personal = await this.options.projects.findPersonalWorkspaceOwner({
        organizationId: input.organizationId,
        scopeId: teamId,
      });
      if (personal && personal.ownerUserId !== input.userId) {
        continue;
      }

      const held = await this.options.authz.effectivePermissions({
        principal: { type: "user", id: input.userId },
        scope: { type: "team", id: teamId, organizationId: input.organizationId },
      });
      const selected = defaults.filter((permission) => held.includes(permission));
      if (selected.length > 0) {
        heldByTeam.set(teamId, selected);
      }
    }

    let permissions: string[] | null = null;
    const selectedTeams: string[] = [];
    for (const [teamId, held] of heldByTeam) {
      selectedTeams.push(teamId);
      permissions =
        permissions === null ? held : permissions.filter((permission) => held.includes(permission));
    }

    if (!permissions || permissions.length === 0) {
      return null;
    }

    return {
      bindings: selectedTeams.map((scopeId) => ({ scopeType: "TEAM" as const, scopeId })),
      permissions: permissions.toSorted(),
    };
  }

  async mintCliLoginKey(input: {
    userId: string;
    organizationId: string;
    deviceLabel: string;
    selection: CliKeySelection;
    /**
     * When the device session began, carried across every refresh. With
     * `maxSessionDurationDays`/`refreshWindowMs`, drives `expiresAt` (see
     * {@link loginKeyExpiresAt}); omitted, the key mints with no expiry.
     */
    sessionStartedAtMs?: number;
    maxSessionDurationDays?: number;
    refreshWindowMs?: number;
  }): Promise<{ token: string; apiKeyId: string; scope: CliKeyScopeSummary }> {
    const scope = await this.resolveCliScopeSummary({
      organizationId: input.organizationId,
      bindings: input.selection.bindings,
      permissions: input.selection.permissions,
    });
    const expiresAt =
      input.sessionStartedAtMs === void 0
        ? void 0
        : loginKeyExpiresAt({
            nowMs: input.sessionStartedAtMs,
            sessionStartedAtMs: input.sessionStartedAtMs,
            maxSessionDurationDays: input.maxSessionDurationDays ?? 0,
            refreshWindowMs: input.refreshWindowMs ?? 0,
          });
    const created = await this.lifecycle.create({
      name: `${CLI_LOGIN_KEY_NAME_PREFIX}${input.deviceLabel}`,
      userId: input.userId,
      createdByUserId: input.userId,
      organizationId: input.organizationId,
      permissionMode: "restricted",
      permissions: input.selection.permissions,
      bindings: input.selection.bindings.map((binding) => ({
        ...binding,
        role: "CUSTOM" as const,
      })),
      createdByDeviceLabel: input.deviceLabel,
      ...(expiresAt === void 0 ? {} : { expiresAt: toDate(expiresAt) }),
    });
    try {
      await this.revokeCliLoginKeysForDevice({
        userId: input.userId,
        organizationId: input.organizationId,
        deviceLabel: input.deviceLabel,
        exceptApiKeyId: created.apiKey.id,
        createdBefore: fromDate(created.apiKey.createdAt),
      });
    } catch (error) {
      await this.lifecycle
        .revoke({
          id: created.apiKey.id,
          callerUserId: input.userId,
          callerIsAdmin: false,
          organizationId: input.organizationId,
        })
        .catch(() => void 0);

      throw error;
    }

    return { token: created.token, apiKeyId: created.apiKey.id, scope };
  }

  async revokeCliLoginKeysForDevice(input: {
    userId: string;
    organizationId: string;
    deviceLabel: string;
    exceptApiKeyId?: string;
    createdBefore?: Instant;
  }): Promise<void> {
    const keys = await this.repository.findForUser({
      userId: input.userId,
      organizationId: input.organizationId,
    });
    for (const key of keys) {
      if (!key.name.startsWith(CLI_LOGIN_KEY_NAME_PREFIX)) continue;
      if (key.createdByDeviceLabel !== input.deviceLabel || key.id === input.exceptApiKeyId) {
        continue;
      }
      if (
        input.createdBefore &&
        Temporal.Instant.compare(fromDate(key.createdAt), input.createdBefore) >= 0
      ) {
        continue;
      }

      // A re-login replaces the device's previous key rather than a person
      // deciding to kill it, so the ingest keys under it may re-mint under
      // the session that replaced theirs (see the cause-remap in
      // ApiKeyLifecycleService.revoke).
      await this.lifecycle.revoke({
        id: key.id,
        callerUserId: input.userId,
        callerIsAdmin: false,
        organizationId: input.organizationId,
        cause: "rotation",
      });
    }
  }

  /**
   * Retires a session's login key, then counts the keys minted under it.
   * A key already gone counts as not revoked; the children are still swept.
   */
  async revokeCliSessionKey(input: {
    apiKeyId: string;
    userId: string;
    organizationId: string;
  }): Promise<CliSessionKeyRevocation> {
    let loginKeyRevoked = true;
    try {
      await this.lifecycle.revoke({
        id: input.apiKeyId,
        callerUserId: input.userId,
        callerIsAdmin: false,
        organizationId: input.organizationId,
        cause: "user",
        cascadeToChildren: false,
      });
    } catch (error) {
      if (error instanceof ApiKeyNotFoundError)
        return { loginKeyRevoked: false, ingestKeysRevoked: 0 };
      if (!(error instanceof ApiKeyAlreadyRevokedError)) throw error;
      loginKeyRevoked = false;
    }

    const ingestKeysRevoked = await this.lifecycle.revokeChildren({
      parentApiKeyId: input.apiKeyId,
      organizationId: input.organizationId,
      callerUserId: input.userId,
      cause: "user",
    });
    return { loginKeyRevoked, ingestKeysRevoked };
  }

  async revokeCliLoginKeyForLogout(input: {
    apiKeyId: string;
    userId: string;
    organizationId: string;
  }): Promise<void> {
    try {
      await this.lifecycle.revoke({
        id: input.apiKeyId,
        callerUserId: input.userId,
        callerIsAdmin: false,
        organizationId: input.organizationId,
      });
    } catch (error) {
      if (error instanceof ApiKeyNotFoundError || error instanceof ApiKeyAlreadyRevokedError) {
        return;
      }

      throw error;
    }
  }

  /**
   * Moves a live login key's expiry with its session, on a successful
   * refresh. Silently a no-op unless it is a live CLI login key owned by
   * this user/org (see `extendLoginKeyExpiry`) — a refresh can't resurrect a revoked key.
   */
  async extendCliLoginKeyExpiry(input: {
    apiKeyId: string;
    userId: string;
    organizationId: string;
    sessionStartedAtMs: number;
    maxSessionDurationDays: number;
    refreshWindowMs: number;
  }): Promise<void> {
    const expiresAt = loginKeyExpiresAt({
      nowMs: nowInstant().epochMilliseconds,
      sessionStartedAtMs: input.sessionStartedAtMs,
      maxSessionDurationDays: input.maxSessionDurationDays,
      refreshWindowMs: input.refreshWindowMs,
    });
    await this.repository.extendLoginKeyExpiry({
      id: input.apiKeyId,
      organizationId: input.organizationId,
      userId: input.userId,
      expiresAt,
    });
  }

  private async resolveCliScopeSummary(input: {
    organizationId: string;
    bindings: { scopeType: "ORGANIZATION" | "TEAM" | "PROJECT"; scopeId: string }[];
    permissions: readonly string[];
  }): Promise<CliKeyScopeSummary> {
    const permissions = [...new Set(input.permissions)].toSorted();
    if (input.bindings.some((binding) => binding.scopeType === "ORGANIZATION")) {
      return { kind: "organization", projectIds: [], permissions };
    }

    const teamIds = input.bindings
      .filter((binding) => binding.scopeType === "TEAM")
      .map((binding) => binding.scopeId);
    const projectIds = input.bindings
      .filter((binding) => binding.scopeType === "PROJECT")
      .map((binding) => binding.scopeId);
    const projects = (
      await this.options.projects.listByOrganization({
        organizationId: input.organizationId,
        page: 1,
        limit: 1000,
      })
    ).data.filter((project) => projectIds.includes(project.id) || teamIds.includes(project.teamId));

    return {
      kind: "projects",
      projectIds: projects.map((project) => project.id).toSorted(),
      permissions,
    };
  }
}
