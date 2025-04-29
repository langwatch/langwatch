import { ProjectSensitiveDataVisibilityLevel, TeamUserRole, type PrismaClient } from "@prisma/client";
import { backendHasTeamProjectPermission, TeamRoleGroup } from "./permission";
import type { Protections } from "../elasticsearch/protections";
import type { Session } from "next-auth";

export const extractCheckKeys = (
  inputObject: Record<string, any>
): string[] => {
  const keys: string[] = [];

  const recurse = (obj: Record<string, any>) => {
    for (const key in obj) {
      if (key.startsWith("check_") || key.startsWith("eval_")) {
        keys.push(key);
      }
      if (typeof obj[key] === "object" && !Array.isArray(obj[key])) {
        recurse(obj[key]);
      }
    }
  };

  recurse(inputObject);
  return keys;
};

export const flattenObjectKeys = (
  obj: Record<string, any>,
  prefix = ""
): string[] => {
  return Object.entries(obj).reduce((acc: string[], [key, value]) => {
    const newKey = prefix ? `${prefix}.${key}` : key;

    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      // If it's an object (but not null or an array), recurse
      return [...acc, ...flattenObjectKeys(value, newKey)];
    } else {
      // For non-object values (including arrays), add the key
      return [...acc, newKey];
    }
  }, []);
};


export async function getProtectionsForProject(
  prisma: PrismaClient,
  { projectId }: { projectId: string } & Record<string, unknown>
): Promise<Protections> {
  return await getUserProtectionsForProject({ prisma, session: null, publiclyShared: false }, { projectId });
}

export async function getUserProtectionsForProject(
  ctx: { prisma: PrismaClient; session: Session | null; publiclyShared?: boolean },
  { projectId }: { projectId: string } & Record<string, unknown>
): Promise<Protections> {
  // TODO(afr): Should we show cost if public? I would assume the opposite.
  const canSeeCosts = ctx.publiclyShared || await backendHasTeamProjectPermission(
    ctx,
    { projectId },
    TeamRoleGroup.COST_VIEW
  );

  const project = await ctx.prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { 
      capturedInputVisibility: true,
      capturedOutputVisibility: true,
    },
  });

  // For public shares or non-signed in users, we only check project settings
  if (ctx.publiclyShared || !ctx.session?.user?.id) {
    return {
      canSeeCosts,
      canSeeCapturedInput: project.capturedInputVisibility === ProjectSensitiveDataVisibilityLevel.VISIBLE_TO_ALL,
      canSeeCapturedOutput: project.capturedOutputVisibility === ProjectSensitiveDataVisibilityLevel.VISIBLE_TO_ALL,
    };
  }

  // For signed in users, check their team permissions
  const teamsWithAccess = await ctx.prisma.teamUser.findMany({
    where: {
      userId: ctx.session.user.id,
      team: {
        projects: {
          some: {
            id: projectId
          }
        }
      }
    },
    select: {
      role: true
    },
  });

  const isAdminInAnyTeam = teamsWithAccess.some(team => team.role === TeamUserRole.ADMIN);
  const isMemberInAnyTeam = teamsWithAccess.length > 0;

  const canAccessSensitiveData = (
    visibility: ProjectSensitiveDataVisibilityLevel,
    userAccess: { isAdmin: boolean; isMember: boolean }
  ): boolean => {
    switch (true) {
      case !userAccess.isMember:
        return false;
      case visibility === ProjectSensitiveDataVisibilityLevel.REDACTED_TO_ALL:
        return false;
      case visibility === ProjectSensitiveDataVisibilityLevel.VISIBLE_TO_ALL:
        return true;
      case visibility === ProjectSensitiveDataVisibilityLevel.VISIBLE_TO_ADMIN:
        return userAccess.isAdmin;
      default:
        console.error('Unexpected state for visibility:', visibility);
        return false;
    }
  };

  const userAccess = {
    isAdmin: isAdminInAnyTeam,
    isMember: isMemberInAnyTeam,
  };

  return {
    canSeeCosts,
    canSeeCapturedInput: canAccessSensitiveData(project.capturedInputVisibility, userAccess),
    canSeeCapturedOutput: canAccessSensitiveData(project.capturedOutputVisibility, userAccess),
  };
}
