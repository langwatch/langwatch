/**
 * The `/` landing decision, composed as its own feature. `governance.*` has two owners on
 * one wire name: the five packaged procedures the Enterprise console calls, and this —
 * where a person lands when they open the product with no path.
 */
import type { ApiTrpcFeatureMount } from "../../api.application";
import type { ApiTrpcInfrastructure } from "../../app-trpc/app-trpc.infrastructure";
import {
  createGovernanceHomeTrpcRouter,
  type GovernanceHomeTrpcPorts,
} from "./governance-home.mount";

/**
 * The rollout gate the governance console and the /me page are both behind. Stated here
 * under the key the flag registry publishes it by, because the landing decision reads it
 * and the flag store this process composed is what answers.
 */
const GOVERNANCE_UI_FLAG = "release_ui_ai_governance_enabled";

/** Builds the `/` landing decision on this process's root and its own graph. */
export function composeGovernanceHomeTrpcRouter(options: {
  mount: ApiTrpcFeatureMount;
  infrastructure: ApiTrpcInfrastructure;
}) {
  return createGovernanceHomeTrpcRouter({
    ...options.mount,
    ports: governanceHomePorts(options.infrastructure),
  });
}

function governanceHomePorts(infrastructure: ApiTrpcInfrastructure): GovernanceHomeTrpcPorts {
  const { prisma } = infrastructure;
  return {
    tryFindFirstProjectSlugForMember: async ({ organizationId, userId }) => {
      const project = await prisma.project.findFirst({
        where: {
          team: {
            organizationId,
            members: { some: { userId } },
            // Personal workspaces are the governance data home, never a
            // navigable organization project (ADR-038 v6).
            isPersonal: false,
          },
          archivedAt: null,
        },
        orderBy: { createdAt: "asc" },
        select: { slug: true },
      });
      return project?.slug ?? null;
    },

    tryFindFirstProjectSlug: async ({ organizationId }) => {
      const project = await prisma.project.findFirst({
        where: { team: { organizationId, isPersonal: false }, archivedAt: null },
        orderBy: { createdAt: "asc" },
        select: { slug: true },
      });
      return project?.slug ?? null;
    },

    isEnterprisePlan: async ({ organizationId }) =>
      (await infrastructure.plans.getActivePlan({ organizationId })).type === "ENTERPRISE",

    canManageOrganization: ({ organizationId, userId }) =>
      infrastructure.authz.hasPermission({
        userId,
        permission: "organization:manage",
        organizationId,
      }),

    tryGetPinnedHomePath: async ({ userId }) => {
      const row = await prisma.user.findUnique({
        where: { id: userId },
        select: { lastHomePath: true },
      });
      return row?.lastHomePath ?? null;
    },

    governanceUiEnabled: ({ organizationId, userId }) =>
      infrastructure.featureFlags.isEnabled(
        GOVERNANCE_UI_FLAG as never,
        {
          kind: "organization",
          userId,
          organizationId,
        } as never,
      ),

    tryGetPrimaryIntent: async ({ organizationId }) => {
      const organization = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { primaryIntent: true },
      });
      return organization?.primaryIntent ?? null;
    },
  };
}
