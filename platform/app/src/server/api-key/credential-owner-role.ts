import { getApp } from "~/server/app-layer/app";
import type { OrgResolvedToken } from "./token-resolver";

/**
 * The organization role of the person an organization credential acts for,
 * for the listings that show a project kind only to organization admins
 * (ADR-144 decision 5). A key with no owner acts for nobody, so it has no
 * role and is never an organization admin.
 */
export async function credentialOwnerRole({
  resolved,
  organizationId,
}: {
  resolved: Pick<OrgResolvedToken, "userId">;
  organizationId: string;
}): Promise<string | null> {
  if (!resolved.userId) return null;
  return getApp().organizations.getUserOrgRole({
    userId: resolved.userId,
    organizationId,
  });
}
