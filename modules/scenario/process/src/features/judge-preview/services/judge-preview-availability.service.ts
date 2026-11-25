/**
 * Whether LangWatch Judge (preview) may judge for a project: on LangWatch Cloud, with the
 * release flag on for the project's organization. Asked before a run starts and on every call.
 * @see modules/scenario/specs/judge-preview.feature
 */
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { ProjectApi } from "@langwatch/project-contract";

export const JUDGE_PREVIEW_FLAG_KEY = "release_langwatch_judge_preview";

const PICK_ANOTHER = "Pick another judge model on the scenario, the suite or in Default models.";
const NOT_ON_CLOUD = `LangWatch Judge (preview) runs on LangWatch Cloud only, so it cannot judge on this installation. ${PICK_ANOTHER}`;
const NOT_TURNED_ON = `LangWatch Judge (preview) is not turned on for this organization yet. ${PICK_ANOTHER}`;

export type JudgePreviewAvailability =
  | Readonly<{ isAvailable: true }>
  | Readonly<{ isAvailable: false; message: string }>;

export class JudgePreviewAvailabilityService {
  static create(deps: {
    featureFlags: Pick<FeatureFlagApi, "isEnabled">;
    projects: Pick<ProjectApi, "findOrganizationId">;
    isSaas: boolean;
  }): JudgePreviewAvailabilityService {
    return new JudgePreviewAvailabilityService(deps.featureFlags, deps.projects, deps.isSaas);
  }

  private constructor(
    private readonly featureFlags: Pick<FeatureFlagApi, "isEnabled">,
    private readonly projects: Pick<ProjectApi, "findOrganizationId">,
    private readonly isSaas: boolean,
  ) {}

  /** A self-hosted install is refused before any flag is read, so no flag can open it there. */
  async availabilityFor({ projectId }: { projectId: string }): Promise<JudgePreviewAvailability> {
    if (!this.isSaas) return { isAvailable: false, message: NOT_ON_CLOUD };
    const organizationId = await this.projects.findOrganizationId(projectId);
    // A project with no organization reads as off: no organization rule could name it.
    if (!organizationId) return { isAvailable: false, message: NOT_TURNED_ON };
    const isEnabled = await this.featureFlags.isEnabled(JUDGE_PREVIEW_FLAG_KEY, {
      kind: "project",
      projectId,
      organizationId,
    });
    return isEnabled ? { isAvailable: true } : { isAvailable: false, message: NOT_TURNED_ON };
  }
}
