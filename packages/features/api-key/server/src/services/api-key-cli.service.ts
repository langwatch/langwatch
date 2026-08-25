import {
  ApiKeyAlreadyRevokedError,
  ApiKeyNotFoundError,
  CliKeySelectionInvalidError,
} from "@langwatch/api-key-contract";
import {
  ALL_PERMISSIONS,
  isRegistryPermission,
  type AuthzPermission,
} from "@langwatch/authz-contract";
import {
  cliKeySelectionSchema,
  type CliKeyScopeSummary,
  type CliKeySelection,
} from "@langwatch/api-key-contract";
import type { ApiKeyRepository } from "../repositories/api-key.repository";
import { ApiKeyGrantPolicyService } from "./api-key-grant-policy.service";
import { ApiKeyLifecycleService } from "./api-key-lifecycle.service";
import type { ApiKeyDependencies } from "./api-key.service";

export class ApiKeyCliService {
  static create(
    options: ApiKeyDependencies & { repository: ApiKeyRepository },
    policy: ApiKeyGrantPolicyService,
    lifecycle: ApiKeyLifecycleService,
  ): ApiKeyCliService {
    return new ApiKeyCliService(options.repository, options, policy, lifecycle);
  }

  private constructor(
    private readonly repository: ApiKeyRepository,
    private readonly options: ApiKeyDependencies,
    private readonly policy: ApiKeyGrantPolicyService,
    private readonly lifecycle: ApiKeyLifecycleService,
  ) {}

  async validateCliSelection(input: {
    userId: string;
    organizationId: string;
    selection: CliKeySelection;
  }): Promise<CliKeySelection> {
    const selection = cliKeySelectionSchema.parse(input.selection);
    const bindings = [
      ...new Map(
        selection.bindings.map((binding) => [
          `${binding.scopeType}:${binding.scopeId}`,
          binding,
        ]),
      ).values(),
    ];
    if (bindings.length === 0) {
      throw new CliKeySelectionInvalidError({ bindings: ["Select at least one scope"] });
    }
    const unknown = selection.permissions.filter(
      (permission) => !isRegistryPermission(permission),
    );
    if (unknown.length > 0) {
      throw new CliKeySelectionInvalidError({
        permissions: unknown.map((permission) => `Unknown permission "${permission}"`),
      });
    }
    const permissions = [...new Set(selection.permissions)].filter(
      (permission) =>
        bindings.some((binding) => binding.scopeType === "ORGANIZATION") ||
        !["organization:manage", "organization:delete", "team:manage"].includes(
          permission,
        ),
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
    return { bindings, permissions: permissions.sort() };
  }

  async tryResolveDefaultCliSelection(input: {
    userId: string;
    organizationId: string;
  }): Promise<CliKeySelection | null> {
    const defaults = ALL_PERMISSIONS.filter(
      (permission) =>
        !["organization:manage", "organization:delete", "team:manage"].includes(
          permission,
        ),
    ) as AuthzPermission[];
    if (await this.policy.isOrgAdmin(input)) {
      return {
        bindings: [{ scopeType: "ORGANIZATION", scopeId: input.organizationId }],
        permissions: [...defaults].sort(),
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
      const personal = await this.repository.tryFindPersonalWorkspaceOwner({
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
        permissions === null
          ? held
          : permissions.filter((permission) => held.includes(permission));
    }
    if (!permissions || permissions.length === 0) {
      return null;
    }
    return {
      bindings: selectedTeams.map((scopeId) => ({ scopeType: "TEAM" as const, scopeId })),
      permissions: permissions.sort(),
    };
  }

  async mintCliLoginKey(input: {
    userId: string;
    organizationId: string;
    deviceLabel: string;
    selection: CliKeySelection;
  }): Promise<{ token: string; apiKeyId: string; scope: CliKeyScopeSummary }> {
    const scope = await this.resolveCliScopeSummary({
      organizationId: input.organizationId,
      bindings: input.selection.bindings,
    });
    const created = await this.lifecycle.create({
      name: `CLI login - ${input.deviceLabel}`,
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
    });
    try {
      await this.revokeCliLoginKeysForDevice({
        userId: input.userId,
        organizationId: input.organizationId,
        deviceLabel: input.deviceLabel,
        exceptApiKeyId: created.apiKey.id,
        createdBefore: created.apiKey.createdAt,
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
    createdBefore?: Date;
  }): Promise<void> {
    const keys = await this.repository.listForUser({
      userId: input.userId,
      organizationId: input.organizationId,
    });
    for (const key of keys) {
      if (
        !key.name.startsWith("CLI login - ") ||
        key.createdByDeviceLabel !== input.deviceLabel ||
        key.id === input.exceptApiKeyId ||
        (input.createdBefore && key.createdAt >= input.createdBefore)
      ) {
        continue;
      }
      await this.lifecycle.revoke({
        id: key.id,
        callerUserId: input.userId,
        callerIsAdmin: false,
        organizationId: input.organizationId,
      });
    }
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
      if (
        error instanceof ApiKeyNotFoundError ||
        error instanceof ApiKeyAlreadyRevokedError
      ) {
        return;
      }
      throw error;
    }
  }

  private async resolveCliScopeSummary(input: {
    organizationId: string;
    bindings: Array<{ scopeType: "ORGANIZATION" | "TEAM" | "PROJECT"; scopeId: string }>;
  }): Promise<CliKeyScopeSummary> {
    if (input.bindings.some((binding) => binding.scopeType === "ORGANIZATION")) {
      return { kind: "organization", projectIds: [] };
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
    ).data.filter(
      (project) => projectIds.includes(project.id) || teamIds.includes(project.teamId),
    );
    return { kind: "projects", projectIds: projects.map((project) => project.id).sort() };
  }
}
