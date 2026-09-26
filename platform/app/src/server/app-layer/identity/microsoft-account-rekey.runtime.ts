import { microsoftProfileRekey } from "@ee/sso/microsoft-account-rekey";
import { prisma } from "~/server/db";

/**
 * The Microsoft sign-in step that moves a pre-3.17 Azure AD account onto the
 * key better-auth 1.7 looks it up by (see `@ee/sso/microsoft-account-rekey`).
 * Supplied from here so better-auth never holds the database client itself.
 */
export function microsoftAccountRekey(): (
  profile: Record<string, unknown>,
) => Promise<void> {
  return microsoftProfileRekey({ prisma });
}
