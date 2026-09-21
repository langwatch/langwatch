/**
 * Whether a project may run Instant Evals: the flag is the product decision,
 * a configured judge the operational one, and the identity a rollout rule
 * distinguishes is the PROJECT, never the member.
 * @see specs/lwql/eval-functions.feature
 */

import { INSTANT_EVALS_FLAG } from "@langwatch/instant-eval-contract";

/** The feature-flag peer, narrowed to the one question this service asks. */
export interface InstantEvalFlagReader {
  isEnabled(
    flagKey: string,
    target: { kind: "project"; projectId: string; organizationId?: string },
  ): Promise<boolean>;
}

/** The project peer, narrowed to the one lookup a rollout rule needs. */
export interface InstantEvalProjectReader {
  findOrganizationId(projectId: string): Promise<string | undefined>;
}

export class InstantEvalAccessService {
  private constructor(
    private readonly flags: InstantEvalFlagReader,
    private readonly projects: InstantEvalProjectReader,
    private readonly isJudgeConfigured: () => boolean,
  ) {}

  static create({
    flags,
    projects,
    isJudgeConfigured,
  }: {
    flags: InstantEvalFlagReader;
    projects: InstantEvalProjectReader;
    /** Reads the deployment's own configuration, injected so a test states it. */
    isJudgeConfigured: () => boolean;
  }): InstantEvalAccessService {
    return new InstantEvalAccessService(flags, projects, isJudgeConfigured);
  }

  /**
   * The product decision alone, whatever the deployment configured: a
   * released project with no judge still gets the "configure a model" primer,
   * while an unreleased one is never offered a judgement at all.
   */
  async isReleased({ projectId }: { projectId: string }): Promise<boolean> {
    const organizationId = await this.projects.findOrganizationId(projectId);
    return this.flags.isEnabled(INSTANT_EVALS_FLAG, {
      kind: "project",
      projectId,
      ...(organizationId === undefined ? {} : { organizationId }),
    });
  }

  async isEnabled({ projectId }: { projectId: string }): Promise<boolean> {
    if (!this.isJudgeConfigured()) return false;
    return this.isReleased({ projectId });
  }
}
