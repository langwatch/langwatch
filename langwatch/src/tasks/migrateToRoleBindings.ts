/**
 * Data migration: populate RoleBinding from existing TeamUser records.
 *
 * What it does:
 * - TeamUser → RoleBinding (scopeType=TEAM, one binding per user per team)
 *
 * Idempotent: safe to run multiple times. Existing rows are skipped.
 *
 * Usage:
 *   pnpm task migrateToRoleBindings
 */

import { RoleBindingScopeType, TeamUserRole, type PrismaClient } from "@prisma/client";
import { prisma } from "../server/db";

// ============================================================================
// TeamUser → RoleBinding
// ============================================================================

export async function migrateTeamUsersToRoleBindings({
  prisma,
  organizationId,
}: {
  prisma: PrismaClient;
  /** Limit to a single org. Omit to run across all orgs (production). */
  organizationId?: string;
}): Promise<{ created: number; skipped: number }> {
  const teamUsers = await prisma.teamUser.findMany({
    where: organizationId ? { team: { organizationId } } : undefined,
    select: {
      userId: true,
      teamId: true,
      role: true,
      assignedRoleId: true,
    },
  });

  // Fetch org IDs for all referenced teams (skips orphaned TeamUser rows)
  const teamIds = [...new Set(teamUsers.map((tu) => tu.teamId))];
  const teams = await prisma.team.findMany({
    where: { id: { in: teamIds } },
    select: { id: true, organizationId: true },
  });
  const teamOrgMap = new Map(teams.map((t) => [t.id, t.organizationId]));

  let created = 0;
  let skipped = 0;

  for (const tu of teamUsers) {
    const orgId = teamOrgMap.get(tu.teamId);
    if (!orgId) continue; // orphaned TeamUser — team was deleted

    const existing = await prisma.roleBinding.findFirst({
      where: {
        organizationId: orgId,
        userId: tu.userId,
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: tu.teamId,
      },
    });

    if (existing) {
      skipped++;
      continue;
    }

    await prisma.roleBinding.create({
      data: {
        organizationId: orgId,
        userId: tu.userId,
        role: tu.role,
        customRoleId: tu.role === TeamUserRole.CUSTOM ? (tu.assignedRoleId ?? null) : null,
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: tu.teamId,
      },
    });
    created++;
  }

  return { created, skipped };
}

// ============================================================================
// Task entry point
// ============================================================================

export default async function main() {
  console.log("=== migrateToRoleBindings ===\n");

  console.log("TeamUser → RoleBinding...");
  const result = await migrateTeamUsersToRoleBindings({ prisma });
  console.log(`  Created: ${result.created}  Skipped (already exists): ${result.skipped}`);

  console.log("\nDone.");
}
