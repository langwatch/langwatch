import { z } from "zod";
import { TeamUserRole } from "~/generated/prisma/client";

export const customTeamRoleInputSchema = z
  .string()
  .regex(
    /^custom:[a-zA-Z0-9_-]+$/,
    "Custom role must be in format 'custom:{roleId}'",
  );
export const builtInTeamRoleInputSchema = z.enum([
  TeamUserRole.ADMIN,
  TeamUserRole.MEMBER,
  TeamUserRole.VIEWER,
]);
export const teamRoleInputSchema = z.union([
  builtInTeamRoleInputSchema,
  customTeamRoleInputSchema,
]);
