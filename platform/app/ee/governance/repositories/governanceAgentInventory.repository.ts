// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The one read the Agents screen needs that the identity tables cannot give
 * it: the organization's own connected agents.
 *
 * `Agent` is a project-scoped model and the governance section is
 * organization-scoped, which is the whole reason this page had no read at all.
 * Walking `project.team.organizationId` is what closes that gap, and the
 * multitenancy guard already permits it for `Agent` (the model is listed under
 * `LICENSE_COUNTED_PROJECT_MODELS` in `dbMultiTenancyProtection.ts`, for the
 * org rollups that walk the same path).
 *
 * Spec: specs/ai-governance/dashboard/agents-page.feature
 */

import type { Prisma, PrismaClient } from "~/generated/prisma/client";
import { connectedAgentVisibleWhere } from "~/server/agents/connected-agent-visibility";

type Client = Prisma.TransactionClient | PrismaClient;

/** One connected agent, in the fields the screen actually renders. */
export interface OrganizationConnectedAgent {
  id: string;
  name: string;
  environment: string | null;
  ownerUserId: string | null;
  createdAt: Date;
  lastSeenAt: Date | null;
}

export class OrganizationConnectedAgentRepository {
  /**
   * Every connected agent registered anywhere in the organization, newest
   * registration first.
   *
   * ONLY `connected`. The other five `Agent.type` values are optimization
   * studio components — a signature node, a code node, a workflow — and none
   * of them is a thing that runs against the organization on its own. Listing
   * them on a governance inventory would fill it with the internals of one
   * feature. It is also the only type this page's own register flow can
   * produce (`agent_register_only`).
   *
   * Two filters carry rules from elsewhere rather than restating them.
   * `connectedAgentVisibleWhere` is ADR-128's presence rule, so an agent
   * unseen for thirty days drops off this page exactly as it drops off the
   * project's own agents list. The `internal_governance` exclusion keeps the
   * hidden per-org routing project out of every user-visible surface.
   */
  async listByOrganization(
    client: Client,
    params: { organizationId: string; now?: Date },
  ): Promise<OrganizationConnectedAgent[]> {
    return await client.agent.findMany({
      where: {
        type: "connected",
        archivedAt: null,
        project: {
          archivedAt: null,
          kind: { not: "internal_governance" },
          team: { organizationId: params.organizationId },
        },
        ...connectedAgentVisibleWhere(
          params.now ? { now: params.now } : undefined,
        ),
      },
      select: {
        id: true,
        name: true,
        environment: true,
        ownerUserId: true,
        createdAt: true,
        lastSeenAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }
}
