/**
 * Whether a project may run Instant Evals: the flag or the organization's own switch is the
 * product decision, a judge for the project's organization the operational one, and a rollout
 * rule distinguishes the PROJECT, never the member.
 * @see specs/instant-evals/instant-eval-opt-in.feature
 */

import { INSTANT_EVALS_FLAG } from "@langwatch/instant-eval-contract";

import type { InstantEvalJudgeChannel } from "../channels/instant-eval-judge.channel.ts";

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

/** The organization peer, narrowed to its Instant Evals consent. */
export interface InstantEvalOptInReader {
  isOptedIn(organizationId: string): Promise<boolean>;
}

export class InstantEvalAccessService {
  private readonly flags: InstantEvalFlagReader;
  private readonly projects: InstantEvalProjectReader;
  private readonly optIns: InstantEvalOptInReader;
  private readonly isJudgeConfigured: () => boolean;
  private readonly judge: Pick<InstantEvalJudgeChannel, "isAvailableForOrganization">;

  private constructor(options: {
    flags: InstantEvalFlagReader;
    projects: InstantEvalProjectReader;
    optIns: InstantEvalOptInReader;
    isJudgeConfigured: () => boolean;
    judge: Pick<InstantEvalJudgeChannel, "isAvailableForOrganization">;
  }) {
    this.flags = options.flags;
    this.projects = options.projects;
    this.optIns = options.optIns;
    this.isJudgeConfigured = options.isJudgeConfigured;
    this.judge = options.judge;
  }

  static create({
    flags,
    projects,
    optIns,
    isJudgeConfigured,
    judge = {},
  }: {
    flags: InstantEvalFlagReader;
    projects: InstantEvalProjectReader;
    /** The organization's own switch, read only when the flag says no. */
    optIns: InstantEvalOptInReader;
    /** Reads the deployment's own configuration, injected so a test states it. */
    isJudgeConfigured: () => boolean;
    /** The judge, where it judges for some organizations and not others. */
    judge?: Pick<InstantEvalJudgeChannel, "isAvailableForOrganization">;
  }): InstantEvalAccessService {
    return new InstantEvalAccessService({ flags, projects, optIns, isJudgeConfigured, judge });
  }

  /**
   * The product decision alone, whatever the deployment configured: a
   * released project with no judge still gets the "can't run right now"
   * popover, while an unreleased one is never offered a judgement at all.
   */
  async isReleased({ projectId }: { projectId: string }): Promise<boolean> {
    const organizationId = await this.projects.findOrganizationId(projectId);
    return this.releasedFor({ projectId, organizationId });
  }

  /** An organization the judge does not judge for sees the functions unavailable, not skipped. */
  async isEnabled({ projectId }: { projectId: string }): Promise<boolean> {
    if (!this.isJudgeConfigured()) return false;
    const organizationId = await this.projects.findOrganizationId(projectId);
    if (
      organizationId !== undefined &&
      this.judge.isAvailableForOrganization &&
      !(await this.judge.isAvailableForOrganization(organizationId))
    ) {
      return false;
    }
    return this.releasedFor({ projectId, organizationId });
  }

  /** The flag is cached and answers for the operator; the consent row is read only on a no. */
  private async releasedFor({
    projectId,
    organizationId,
  }: {
    projectId: string;
    organizationId: string | undefined;
  }): Promise<boolean> {
    const released = await this.flags.isEnabled(INSTANT_EVALS_FLAG, {
      kind: "project",
      projectId,
      ...(organizationId === undefined ? {} : { organizationId }),
    });
    if (released) return true;
    if (organizationId === undefined) return false;
    return this.optIns.isOptedIn(organizationId);
  }
}
