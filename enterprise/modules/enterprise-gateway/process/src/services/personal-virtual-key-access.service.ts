// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { type AuthzApi, PermissionDeniedError } from "@langwatch/authz-contract";
import {
  type IssuedPersonalVirtualKeyAnswer,
  NoEligibleModelProvidersError,
  NoEligibleProvidersError,
  type PersonalVirtualKey,
  PersonalVirtualKeyLabelTakenError,
  PersonalVirtualKeyMissingError,
  PersonalVirtualKeyNotFoundError,
  RoutingPolicyEmptyError,
  RoutingPolicyHasNoProvidersError,
} from "@langwatch/enterprise-gateway-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";

import type { PersonalVirtualKeyService } from "./personal-virtual-key.service.ts";

type Members = Pick<OrganizationApi, "isMember" | "findMemberById" | "ensurePersonalWorkspace">;
type Keys = Pick<PersonalVirtualKeyService, "list" | "issue" | "revoke" | "hasLiveKeyLabelled">;

/** The `personalVirtualKeys.*` doors: membership first, then the actor's own keys. */
export class PersonalVirtualKeyAccessService {
  private constructor(
    private readonly keys: Keys,
    private readonly members: Members,
    private readonly permissions: Pick<AuthzApi, "getDecision">,
  ) {}

  static create(options: {
    keys: Keys;
    members: Members;
    permissions: Pick<AuthzApi, "getDecision">;
  }): PersonalVirtualKeyAccessService {
    return new PersonalVirtualKeyAccessService(options.keys, options.members, options.permissions);
  }

  async list(input: {
    organizationId: string;
    targetUserId?: string;
    actorUserId: string;
  }): Promise<PersonalVirtualKey[]> {
    await this.assertMembership(input);
    const principalUserId = await this.resolvePrincipal(input);
    return this.keys.list({
      organizationId: input.organizationId,
      ...(principalUserId === undefined ? {} : { userId: principalUserId }),
    });
  }

  async issue(input: {
    organizationId: string;
    label: string;
    routingPolicyId?: string;
    actorUserId: string;
  }): Promise<IssuedPersonalVirtualKeyAnswer> {
    await this.assertMembership(input);
    const member = await this.members.findMemberById(
      { organizationId: input.organizationId, userId: input.actorUserId },
      { id: input.actorUserId },
    );
    const workspace = await this.members.ensurePersonalWorkspace({
      userId: input.actorUserId,
      organizationId: input.organizationId,
      displayName: member?.user.name ?? null,
      displayEmail: member?.user.email ?? null,
    });
    const duplicate = await this.keys.hasLiveKeyLabelled({
      organizationId: input.organizationId,
      userId: input.actorUserId,
      label: input.label,
    });
    if (duplicate) throw new PersonalVirtualKeyLabelTakenError(input.label);

    try {
      const issued = await this.keys.issue({
        userId: input.actorUserId,
        organizationId: input.organizationId,
        personalProjectId: workspace.project.id,
        personalTeamId: workspace.team.id,
        label: input.label,
        routingPolicyId: input.routingPolicyId,
      });
      return {
        id: issued.id,
        label: issued.label,
        secret: issued.secret,
        baseUrl: issued.baseUrl,
        displayPrefix: issued.virtualKey.displayPrefix,
        routingPolicyId: issued.routingPolicyId,
      };
    } catch (error) {
      if (error instanceof NoEligibleProvidersError) {
        throw new NoEligibleModelProvidersError(error.organizationId);
      }
      if (error instanceof RoutingPolicyHasNoProvidersError) {
        throw new RoutingPolicyEmptyError(error.routingPolicyId, error.routingPolicyName);
      }
      throw error;
    }
  }

  async revoke(input: { organizationId: string; id: string; actorUserId: string }): Promise<void> {
    await this.assertMembership(input);
    try {
      await this.keys.revoke({
        userId: input.actorUserId,
        organizationId: input.organizationId,
        virtualKeyId: input.id,
      });
    } catch (error) {
      if (error instanceof PersonalVirtualKeyNotFoundError) {
        throw new PersonalVirtualKeyMissingError(error.virtualKeyId);
      }
      throw error;
    }
  }

  private async assertMembership(input: {
    organizationId: string;
    actorUserId: string;
  }): Promise<void> {
    const member = await this.members.isMember({
      organizationId: input.organizationId,
      userId: input.actorUserId,
    });
    if (member) return;
    throw new PermissionDeniedError({
      permission: "organization:view",
      scope: { type: "organization", id: input.organizationId },
      denialReason: "no-membership",
    });
  }

  /** Own keys always; anyone else's, or everyone's, only with `virtualKeys:viewOtherPersonal`. */
  private async resolvePrincipal(input: {
    organizationId: string;
    targetUserId?: string;
    actorUserId: string;
  }): Promise<string | undefined> {
    if (input.targetUserId === input.actorUserId) return input.actorUserId;

    const { permitted } = await this.permissions.getDecision({
      userId: input.actorUserId,
      permission: "virtualKeys:viewOtherPersonal",
      scope: { tier: "organization", id: input.organizationId },
    });
    if (input.targetUserId === undefined) return permitted ? undefined : input.actorUserId;
    if (permitted) return input.targetUserId;
    throw new PermissionDeniedError({
      permission: "virtualKeys:viewOtherPersonal",
      scope: { type: "organization", id: input.organizationId },
      denialReason: "no-binding",
    });
  }
}
