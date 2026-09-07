import type { DeclaredScopeId } from "@langwatch/authz";
import type { PrismaClient } from "~/generated/prisma/client";
import type { ResolvedScopeOwner, ScopeOwnershipPort } from "./mfa-gate";

/**
 * Where a scope sits: which organization owns it, and whether it is somebody's
 * own workspace (D06, follow-up 2).
 *
 * A project's organization comes through its team, which is the only path
 * that exists — a project has no organization column of its own. Both reads
 * are keyed lookups on the primary key, and the gate memoizes the answer per
 * request, so a batch of a dozen procedures over one project pays for one.
 *
 * `isPersonal` on either row means the same thing and exempts the same way:
 * nobody's personal workspace is held by an organization's requirement.
 */
export class PrismaScopeOwnership implements ScopeOwnershipPort {
  constructor(private readonly prisma: PrismaClient) {}

  async ownerOf({
    scope,
  }: {
    scope: DeclaredScopeId;
  }): Promise<ResolvedScopeOwner> {
    if (scope.tier === "organization") {
      return { organizationId: scope.id, isPersonal: false };
    }
    if (scope.tier === "team") {
      const team = await this.prisma.team.findUnique({
        where: { id: scope.id },
        select: { organizationId: true, isPersonal: true },
      });
      return {
        organizationId: team?.organizationId ?? null,
        isPersonal: team?.isPersonal ?? false,
      };
    }
    const project = await this.prisma.project.findUnique({
      where: { id: scope.id },
      select: {
        isPersonal: true,
        team: { select: { organizationId: true, isPersonal: true } },
      },
    });
    return {
      organizationId: project?.team?.organizationId ?? null,
      // Either row saying so is enough. A personal project always sits in a
      // personal team, and a row that disagrees with its parent is still not
      // a workspace an employer's requirement should reach into.
      isPersonal:
        (project?.isPersonal ?? false) || (project?.team?.isPersonal ?? false),
    };
  }
}
