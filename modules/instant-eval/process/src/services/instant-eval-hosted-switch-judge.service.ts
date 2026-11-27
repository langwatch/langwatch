/**
 * LangWatch's hosted judge, which skips for an organization LangWatch switched hosted off: the
 * floor under every caller that would reach it (runs, judged queries, classify, the search bar's
 * route), whatever the release said first. An own decision model never comes through here.
 * @see modules/instant-eval/specs/instant-eval-opt-in.feature
 */

import {
  instantEvalSkipped,
  type InstantEvalJudgement,
} from "@langwatch/instant-eval-judge-contract";

import type {
  InstantEvalClassifyRequest,
  InstantEvalJudgeChannel,
} from "../channels/instant-eval-judging.channel.ts";
import type { InstantEvalHostedSwitchReader } from "./instant-eval-access.service.ts";

/** The project's organization, and whether LangWatch switched hosted off for it. */
export interface InstantEvalHostedSwitchPeers extends InstantEvalHostedSwitchReader {
  findOrganizationId(projectId: string): Promise<string | undefined>;
}

export class InstantEvalHostedSwitchJudgeService implements InstantEvalJudgeChannel {
  private constructor(
    private readonly hosted: InstantEvalJudgeChannel,
    private readonly peers: InstantEvalHostedSwitchPeers,
  ) {}

  static create({
    hosted,
    peers,
  }: {
    hosted: InstantEvalJudgeChannel;
    peers: InstantEvalHostedSwitchPeers;
  }): InstantEvalHostedSwitchJudgeService {
    return new InstantEvalHostedSwitchJudgeService(hosted, peers);
  }

  get limits(): InstantEvalJudgeChannel["limits"] {
    return this.hosted.limits;
  }

  get pricing(): InstantEvalJudgeChannel["pricing"] {
    return this.hosted.pricing;
  }

  async classify(
    request: InstantEvalClassifyRequest,
    signal?: AbortSignal,
  ): Promise<InstantEvalJudgement> {
    if (await this.isHostedOff(request.projectId)) {
      return instantEvalSkipped("classifier_not_configured");
    }
    return this.hosted.classify(request, signal);
  }

  async isAvailableForOrganization(organizationId: string): Promise<boolean> {
    const { hosted } = this;
    return hosted.isAvailableForOrganization
      ? hosted.isAvailableForOrganization(organizationId)
      : true;
  }

  async close(): Promise<void> {
    await this.hosted.close?.();
  }

  /** A project in no organization is named by no organization rule, so it is not off. */
  private async isHostedOff(projectId: string): Promise<boolean> {
    const organizationId = await this.peers.findOrganizationId(projectId);
    if (organizationId === undefined) return false;
    return this.peers.isHostedOff({ projectId, organizationId });
  }
}
