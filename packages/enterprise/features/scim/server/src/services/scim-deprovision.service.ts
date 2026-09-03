// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { AuthzGrantsService } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import type {
  ScimRemovalOperation,
  ScimSyncLifecyclePort,
} from "../ports/scim-sync-lifecycle.port";

const logger = createLogger("langwatch:scim:deprovision");
const SCIM_ACTOR = { type: "system", name: "scim" } as const;

export type ScimRemovalManifest = {
  ownedApiKeys: Array<{ id: string; name: string }>;
  personalTeams: Array<{ id: string; name: string }>;
};

/** Removes all authority through authz's transactional offboarding proof. */
export class ScimDeprovisionService {
  private constructor(
    private readonly grants: AuthzGrantsService,
    private readonly lifecycle: ScimSyncLifecyclePort,
  ) {}

  static create(options: {
    grants: AuthzGrantsService;
    lifecycle: ScimSyncLifecyclePort;
  }): ScimDeprovisionService {
    return new ScimDeprovisionService(options.grants, options.lifecycle);
  }

  async removeAccess(input: {
    userId: string;
    organizationId: string;
    connectionId: string | null;
    op: ScimRemovalOperation;
  }): Promise<ScimRemovalManifest> {
    try {
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
    if (!input.connectionId) return;

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
