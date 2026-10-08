/** Which organization a project belongs to, as its owners hold it, or that they hold none. */
export type InstantEvalJudgeProjectPlacement =
  | Readonly<{ outcome: "known"; organizationId: string }>
  | Readonly<{ outcome: "unknown" }>;

/**
 * A project's organization, read from project's `Project` and organization's `Team` rows through
 * their declared shares (round 46 E1, R40), never a copy. A project never leaves its organization.
 */
export abstract class InstantEvalJudgeProjectRepository {
  /** Unknown is an answer, not a failure: the judge refuses the call (ADR-174 decision 15). */
  abstract getPlacement(input: { projectId: string }): Promise<InstantEvalJudgeProjectPlacement>;
}
