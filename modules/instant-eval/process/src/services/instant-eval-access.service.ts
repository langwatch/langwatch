/**
 * Whether a project may run Instant Evals: the flag or the organization's own
 * switch is the product decision, a judge for the project's organization the
 * operational one, and a rollout rule distinguishes the PROJECT, never the member.
 * @see specs/lwql/eval-functions.feature
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

/** The organization's own switch, narrowed to whether it was thrown. */
export interface InstantEvalOptInReader {
  isOptedIn(input: { organizationId: string }): Promise<boolean>;
}

export class InstantEvalAccessService {
  private readonly flags: InstantEvalFlagReader;
  private readonly projects: InstantEvalProjectReader;
  private readonly isJudgeConfigured: () => boolean;
  private readonly judge: Pick<InstantEvalJudgeChannel, "isAvailableForOrganization">;
  private readonly optIns: InstantEvalOptInReader;

  private constructor(options: {
    flags: InstantEvalFlagReader;
    projects: InstantEvalProjectReader;
    isJudgeConfigured: () => boolean;
    judge: Pick<InstantEvalJudgeChannel, "isAvailableForOrganization">;
    optIns: InstantEvalOptInReader;
  }) {
    this.flags = options.flags;
    this.projects = options.projects;
    this.isJudgeConfigured = options.isJudgeConfigured;
    this.judge = options.judge;
    this.optIns = options.optIns;
  }

  static create({
    flags,
    projects,
    isJudgeConfigured,
    judge = {},
    optIns,
  }: {
    flags: InstantEvalFlagReader;
    projects: InstantEvalProjectReader;
    /** Reads the deployment's own configuration, injected so a test states it. */
    isJudgeConfigured: () => boolean;
    /** The judge, where it judges for some organizations and not others. */
    judge?: Pick<InstantEvalJudgeChannel, "isAvailableForOrganization">;
    optIns: InstantEvalOptInReader;
  }): InstantEvalAccessService {
    return new InstantEvalAccessService({ flags, projects, isJudgeConfigured, judge, optIns });
  }

  /**
   * The product decision alone, whatever the deployment configured: a
   * released project with no judge still gets the "configure a model" primer,
   * while an unreleased one is never offered a judgement at all.
   */
  async isReleased({ projectId }: { projectId: string }): Promise<boolean> {
    const organizationId = await this.projects.findOrganizationId(projectId);
    return this.releasedFor({ projectId, organizationId });
  }

  /** The same decision, for a caller that already resolved the organization. */
  isReleasedFor(input: { projectId: string; organizationId: string }): Promise<boolean> {
    return this.releasedFor(input);
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

  /**
   * The flag is asked first: it is cached and answers for the operator, so an
   * organization the operator released never pays for the row read.
   */
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
    return this.optIns.isOptedIn({ organizationId });
  }
}
