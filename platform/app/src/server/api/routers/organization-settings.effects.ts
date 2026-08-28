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
