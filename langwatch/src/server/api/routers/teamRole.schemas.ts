import { TeamUserRole } from "@prisma/client";
import { z } from "zod";

/**
 * Team-role input schemas shared by the organization and invite routers.
 *
 * Both accept a team role on input: the organization router when changing an
 * existing member's role, the invite router when inviting someone into a team.
 * They live here so the two routers validate a role the same way.
 */

const customTeamRoleInputSchema = z
  .string()
  .regex(
    /^custom:[a-zA-Z0-9_-]+$/,
    "Custom role must be in format 'custom:{roleId}'",
  );

const builtInTeamRoleInputSchema = z.enum([
  TeamUserRole.ADMIN,
  TeamUserRole.MEMBER,
  TeamUserRole.VIEWER,
]);

export const teamRoleInputSchema = z.union([
  builtInTeamRoleInputSchema,
  customTeamRoleInputSchema,
]);
