// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { NurturingOrganizationCreatedRepository } from "../repositories/nurturing-organization-created.repository.ts";
import type { NurturingProjectPlacementRepository } from "../repositories/nurturing-project-placement.repository.ts";

type CopiedProjectsDependencies = Readonly<{
  placements: Pick<NurturingProjectPlacementRepository, "getPlacement">;
  organizationsCreated: Pick<NurturingOrganizationCreatedRepository, "findOrganizationCreatedAt">;
}>;

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
export class NurturingCopiedProjectsService {
  static create(dependencies: CopiedProjectsDependencies): NurturingCopiedProjectsService {
    return new NurturingCopiedProjectsService(
      dependencies.placements,
      dependencies.organizationsCreated,
    );
  }

  private constructor(
    private readonly placements: CopiedProjectsDependencies["placements"],
    private readonly organizationsCreated: CopiedProjectsDependencies["organizationsCreated"],
  ) {}

  async copiedProjectOf({ projectId }: Readonly<{ projectId: string }>): Promise<CopiedProject> {
    const placement = await this.placements.getPlacement({ projectId });
    if (placement.outcome !== "known") return { outcome: "unplaced" };
    const { organizationId } = placement;
    const { organizationCreatedAt } = await this.organizationsCreated.findOrganizationCreatedAt({
      organizationId,
    });
    return { outcome: "placed", organizationId, organizationCreatedAt };
  }
}
