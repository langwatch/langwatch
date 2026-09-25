// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { PrismaClient } from "~/generated/prisma/client";
import { PROJECT_KIND } from "./governanceProject.service";

/**
 * The organization's hidden `internal_governance` Project id.
 *
 * This id is the TenantId every governance ClickHouse table is keyed by, so
 * every governance read starts here. It is lazily minted by
 * `ensureHiddenGovernanceProject` when the org's first IngestionSource is
 * created; until then the org has none, and `null` means exactly that — no
 * ingestion has ever happened, not that a lookup failed.
 *
 * Shared rather than private to one service: the activity monitor and the cost
 * screen resolve the SAME tenant, and two copies of this query could disagree
 * about which project counts (the `archivedAt` filter in particular) while both
 * looked correct in isolation.
 */
export async function resolveGovProjectId({
  prisma,
  organizationId,
}: {
  prisma: PrismaClient;
  organizationId: string;
}): Promise<string | null> {
  const project = await prisma.project.findFirst({
    where: {
      kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
      team: { organizationId },
      archivedAt: null,
    },
    select: { id: true },
  });
  return project?.id ?? null;
}
