// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { AuthzApi, AuthzGrantsService } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";

import { assertRemovalKeepsAnAdministrator } from "../rules/scim-last-administrator.rules.ts";
import type { ScimRemovalOperation, ScimSyncLifecycle } from "./scim-sync-lifecycle.service.ts";

const logger = createLogger("langwatch:scim:deprovision");
const SCIM_ACTOR = { type: "system", name: "scim" } as const;

type ScimRemovalManifest = {
  ownedApiKeys: { id: string; name: string }[];
  personalTeams: { id: string; name: string }[];
};

/** Who can still administer the organisation, asked of authz before any removal. */
export type ScimOrganizationAdministration = Pick<AuthzApi, "findActiveOrganizationAdministrators">;

/** Removes all authority through authz's transactional offboarding proof. */
export class ScimDeprovisionService {
  private constructor(
    private readonly grants: AuthzGrantsService,
    private readonly lifecycle: ScimSyncLifecycle,
    private readonly organization: ScimOrganizationAdministration,
  ) {}

  static create(options: {
    grants: AuthzGrantsService;
    lifecycle: ScimSyncLifecycle;
    organization: ScimOrganizationAdministration;
  }): ScimDeprovisionService {
    return new ScimDeprovisionService(options.grants, options.lifecycle, options.organization);
  }

  async removeAccess(input: {
    userId: string;
    organizationId: string;
    connectionId: string | null;
    op: ScimRemovalOperation;
  }): Promise<ScimRemovalManifest> {
    try {
      // The organization's own way in is not the directory's to close: a push
      // that would leave nobody able to administer it is refused before any
      // authority is taken away. enterprise/modules/scim/specs/scim-connection-sync.feature.
      const administrators = await this.organization.findActiveOrganizationAdministrators({
        organizationId: input.organizationId,
      });
      assertRemovalKeepsAnAdministrator({ administrators, userId: input.userId });
      const result = await this.grants.offboard({
        actor: SCIM_ACTOR,
        userId: input.userId,
        organizationId: input.organizationId,
      });
      this.reportManifest(input, result.needsHumanDecision);

      return result.needsHumanDecision;
    } catch (error) {
      await this.recordFailure(input, error);

      throw error;
    }
  }

  private async recordFailure(
    input: {
      userId: string;
      organizationId: string;
      connectionId: string | null;
      op: ScimRemovalOperation;
    },
    error: unknown,
  ): Promise<void> {
    if (!input.connectionId) {
      return;
    }

    const handled = error instanceof HandledError ? error : null;
    await this.lifecycle.applyFailed({
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      op: input.op,
      errorCode: handled?.code ?? "unknown",
      retryable: handled?.fault !== "customer",
      userId: input.userId,
    });
  }

  private reportManifest(
    input: { userId: string; organizationId: string },
    manifest: ScimRemovalManifest,
  ): void {
    if (manifest.ownedApiKeys.length === 0 && manifest.personalTeams.length === 0) {
      return;
    }

    logger.warn(
      {
        userId: input.userId,
        organizationId: input.organizationId,
        ownedApiKeyIds: manifest.ownedApiKeys.map((key) => key.id),
        personalTeamIds: manifest.personalTeams.map((team) => team.id),
      },
      "directory deprovision left owned resources needing an administrator's decision",
    );
  }
}
