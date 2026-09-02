/**
 * What the process does after an organization settings write says trace
 * sharing was switched off.
 *
 * It is here rather than on the organization service because the revocation
 * crosses two other features — every project in the organization, and every
 * share link on it — and the organization feature owns neither. The management
 * REST family is the caller; the failure is loud on purpose, because a share
 * link that survives the switch is a live leak.
 */

import type { UpdateOrganizationSettingsResult } from "@langwatch/organization-contract";
import type { ProjectService } from "@langwatch/project-contract";
import type { ShareService } from "@langwatch/share-contract";

export async function revokeTraceSharesAfterOrganizationSettingsUpdate(
  shares: ShareService,
  projects: ProjectService,
  organizationId: string,
  result: UpdateOrganizationSettingsResult,
): Promise<void> {
  if (!result.traceShareRevocationRequired) return;
  const projectIds = await projects.listIdsByOrganization({ organizationId });
  const outcomes = await Promise.allSettled(
    projectIds.map((projectId) => shares.revokeAllTraceShares(projectId)),
  );
  const unrevoked = projectIds.filter((_, index) => outcomes[index]?.status === "rejected");
  if (unrevoked.length > 0) {
    throw new Error(
      `Trace sharing was disabled, but share links survive on ${unrevoked.length} project(s): ${unrevoked.join(", ")}`,
    );
  }
}
