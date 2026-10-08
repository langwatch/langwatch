/** Which organization a project belongs to, as the judge learned it, or that it has not yet. */
export type InstantEvalJudgeProjectPlacement =
  | Readonly<{ outcome: "known"; organizationId: string }>
  | Readonly<{ outcome: "unknown" }>;

/**
 * The judge's copy of each project's organization, folded from project's `lw.project.created`
 * (ADR-174 decision 13). A project never leaves its organization, so the first row stands.
 */
export abstract class InstantEvalJudgeProjectRepository {
  /** Unknown is an answer, not a failure: the judge refuses the call (ADR-174 decision 15). */
  abstract getPlacement(input: { projectId: string }): Promise<InstantEvalJudgeProjectPlacement>;

  /** Writes the row once; a repeated or concurrent fact leaves it as it is. */
  abstract upsert(input: {
    projectId: string;
    organizationId: string;
    createdAtMs: number;
  }): Promise<void>;
}
