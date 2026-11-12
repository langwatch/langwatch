// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { NurturingOrganizationCreatedRepository } from "../repositories/nurturing-organization-created.repository.ts";
import type { NurturingProjectPlacementRepository } from "../repositories/nurturing-project-placement.repository.ts";

/**
 * A project as nurturing's own copies place it: unplaced until lw.project.created's copy lands;
 * placed with no creation time when its organization predates nurturing's creation copy.
 */
export type CopiedProject =
  | Readonly<{ outcome: "unplaced" }>
  | Readonly<{
      outcome: "placed";
      organizationId: string;
      organizationCreatedAt: number | null;
    }>;

/** Reads a project's placement and its organization's creation from nurturing's own copies. */
export async function copiedProjectOf({
  projectId,
  placements,
  organizationsCreated,
}: Readonly<{
  projectId: string;
  placements: Pick<NurturingProjectPlacementRepository, "getPlacement">;
  organizationsCreated: Pick<NurturingOrganizationCreatedRepository, "findOrganizationCreatedAt">;
}>): Promise<CopiedProject> {
  const placement = await placements.getPlacement({ projectId });
  if (placement.outcome !== "known") return { outcome: "unplaced" };
  const { organizationId } = placement;
  const { organizationCreatedAt } = await organizationsCreated.findOrganizationCreatedAt({
    organizationId,
  });
  return { outcome: "placed", organizationId, organizationCreatedAt };
}
