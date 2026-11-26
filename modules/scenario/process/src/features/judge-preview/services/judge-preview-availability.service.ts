/**
 * Whether LangWatch Judge (preview) may judge for a project: on LangWatch Cloud, with the
 * release flag on for the project's organization, and a route table that can answer it. Asked
 * before a run starts and on every call.
 * @see modules/scenario/specs/judge-preview.feature
 */
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { InstantEvalJudgeApi } from "@langwatch/instant-eval-judge-contract";
import type { ProjectApi } from "@langwatch/project-contract";

export const JUDGE_PREVIEW_FLAG_KEY = "release_langwatch_judge_preview";

const PICK_ANOTHER = "Pick another judge model on the scenario, the suite or in Default models.";
/** The one refusal for an install that is not LangWatch Cloud, before a run or on a call. */
export const JUDGE_PREVIEW_NOT_ON_CLOUD = `LangWatch Judge (preview) runs on LangWatch Cloud only, so it cannot judge on this installation. ${PICK_ANOTHER}`;
const NOT_TURNED_ON = `LangWatch Judge (preview) is not turned on for this organization yet. ${PICK_ANOTHER}`;
const NOT_CONFIGURED = `LangWatch Judge (preview) is not set up on this installation yet, so it cannot judge. ${PICK_ANOTHER}`;

export type JudgePreviewAvailability =
  | Readonly<{ isAvailable: true }>
  | Readonly<{ isAvailable: false; message: string }>;

type JudgePreviewAvailabilityDeps = Readonly<{
  featureFlags: Pick<FeatureFlagApi, "isEnabled">;
  projects: Pick<ProjectApi, "findOrganizationId">;
  judges: Pick<InstantEvalJudgeApi, "isScenarioJudgeConfigured">;
  isSaas: boolean;
}>;

export class JudgePreviewAvailabilityService {
  static create(deps: JudgePreviewAvailabilityDeps): JudgePreviewAvailabilityService {
    return new JudgePreviewAvailabilityService(deps);
  }

  private constructor(private readonly deps: JudgePreviewAvailabilityDeps) {}

  /** A self-hosted install is refused before any flag is read, so no flag can open it there. */
  async availabilityFor({ projectId }: { projectId: string }): Promise<JudgePreviewAvailability> {
    if (!this.deps.isSaas) return { isAvailable: false, message: JUDGE_PREVIEW_NOT_ON_CLOUD };
    const organizationId = await this.deps.projects.findOrganizationId(projectId);
    // A project with no organization reads as off: no organization rule could name it.
    if (!organizationId) return { isAvailable: false, message: NOT_TURNED_ON };
    // Asked of the organization only, as the pickers and the Judge default's save gate ask it.
    const isEnabled = await this.deps.featureFlags.isEnabled(JUDGE_PREVIEW_FLAG_KEY, {
      kind: "organization",
      organizationId,
    });
    if (!isEnabled) return { isAvailable: false, message: NOT_TURNED_ON };
    // A flag turned on before the route table names a turn decision backend would fail every run
    // at its first turn, so the run is refused before it starts instead.
    const isConfigured = await this.deps.judges.isScenarioJudgeConfigured();
    return isConfigured ? { isAvailable: true } : { isAvailable: false, message: NOT_CONFIGURED };
  }
}
