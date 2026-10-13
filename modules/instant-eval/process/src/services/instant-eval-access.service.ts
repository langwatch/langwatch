/**
 * Whether a project may run Instant Evals: the plan, flag, license (main #8416) or switch is the
 * product decision, a judge for the organization the operational one; rollout is per PROJECT.
 * @see modules/instant-eval/specs/instant-eval-opt-in.feature
 */

import { INSTANT_EVALS_FLAG } from "@langwatch/instant-eval-contract";

import type { InstantEvalJudgeChannel } from "../channels/instant-eval-judging.channel.ts";

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

/** The entitlement peer, narrowed to whether the organization is on an enterprise plan. */
export interface InstantEvalPlanReader {
  isEnterprisePlan(organizationId: string): Promise<boolean>;
}

export class InstantEvalAccessService {
  private readonly flags: InstantEvalFlagReader;
  private readonly projects: InstantEvalProjectReader;
  private readonly judgesThroughConnect: boolean;
  private readonly optIns: InstantEvalOptInReader;
  private readonly isJudgeConfigured: () => boolean;
  private readonly judge: Pick<InstantEvalJudgeChannel, "isAvailableForOrganization">;
  private readonly hostedPlans: InstantEvalPlanReader | undefined;

  private constructor(options: {
    flags: InstantEvalFlagReader;
    projects: InstantEvalProjectReader;
    judgesThroughConnect: boolean;
    optIns: InstantEvalOptInReader;
    isJudgeConfigured: () => boolean;
    judge: Pick<InstantEvalJudgeChannel, "isAvailableForOrganization">;
    hostedPlans: InstantEvalPlanReader | undefined;
  }) {
    this.flags = options.flags;
    this.projects = options.projects;
    this.judgesThroughConnect = options.judgesThroughConnect;
    this.optIns = options.optIns;
    this.isJudgeConfigured = options.isJudgeConfigured;
    this.judge = options.judge;
    this.hostedPlans = options.hostedPlans;
  }

  static create({
    flags,
    projects,
    judgesThroughConnect = false,
    optIns,
    isJudgeConfigured,
    judge = {},
    hostedPlans,
  }: {
    flags: InstantEvalFlagReader;
    projects: InstantEvalProjectReader;
    /**
     * A self-hosted install judging through LangWatch: there the license that names hosted
     * judging, left on by an admin, releases them; an install with judging turned off never does.
     */
    judgesThroughConnect?: boolean;
    /** The organization's own switch: on the hosted service, what releases a self-serve one. */
    optIns: InstantEvalOptInReader;
    /** Reads the deployment's own configuration, injected so a test states it. */
    isJudgeConfigured: () => boolean;
    /** The judge, where it judges for some organizations and not others. */
    judge?: Pick<InstantEvalJudgeChannel, "isAvailableForOrganization">;
    /**
     * Given on the hosted service only: an enterprise organization is released by the flag, a
     * self-serve one by its own switch, so neither answers for the other.
     */
    hostedPlans?: InstantEvalPlanReader;
  }): InstantEvalAccessService {
    return new InstantEvalAccessService({
      flags,
      projects,
      judgesThroughConnect,
      optIns,
      isJudgeConfigured,
      judge,
      hostedPlans,
    });
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

  /**
   * Hosted: the flag for an enterprise organization, its own switch otherwise, so a switch thrown
   * before an upgrade no longer counts. Elsewhere the flag, then the license, then the switch.
   */
  private async releasedFor({
    projectId,
    organizationId,
  }: {
    projectId: string;
    organizationId: string | undefined;
  }): Promise<boolean> {
    if (this.hostedPlans) {
      if (organizationId === undefined) return false;
      if (await this.hostedPlans.isEnterprisePlan(organizationId)) {
        return this.isFlagged({ projectId, organizationId });
      }
      return this.optIns.isOptedIn(organizationId);
    }
    if (await this.isFlagged({ projectId, organizationId })) return true;
    if (organizationId === undefined) return false;
    if (await this.isLicensed(organizationId)) return true;
    return this.optIns.isOptedIn(organizationId);
  }

  private isFlagged({
    projectId,
    organizationId,
  }: {
    projectId: string;
    organizationId: string | undefined;
  }): Promise<boolean> {
    return this.flags.isEnabled(INSTANT_EVALS_FLAG, {
      kind: "project",
      projectId,
      ...(organizationId === undefined ? {} : { organizationId }),
    });
  }

  /** The judge's own per-organization answer is the license's: named, and not switched off. */
  private async isLicensed(organizationId: string): Promise<boolean> {
    if (!this.judgesThroughConnect || !this.judge.isAvailableForOrganization) return false;
    return this.judge.isAvailableForOrganization(organizationId);
  }
}
