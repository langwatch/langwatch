/**
 * An organization's own switch for Instant Evals (main #8348): a self-serve
 * organization on the hosted service throws it from the refusal popover; an
 * enterprise one is offered a word with us, and a self-hosted install is told why (main #8416).
 * @see modules/instant-eval/specs/instant-eval-opt-in.feature
 */

import type { ConnectServiceState } from "@langwatch/enterprise-licensing-contract";
import {
  type InstantEvalOptInAccess,
  type InstantEvalOptInOffer,
  InstantEvalOptInNotOfferedError,
  type SelfHostedInstantEvalOffer,
} from "@langwatch/instant-eval-contract";
import { ProjectNotFoundError } from "@langwatch/project-contract";

import type { InstantEvalJudgeRoute } from "../rules/instant-eval-judge-choice.rules.ts";

/** The peers the offer and the switch ask, each narrowed to one question. */
export interface InstantEvalOptInPeers {
  findOrganizationId(projectId: string): Promise<string | undefined>;
  /** Whether this is the hosted service; a self-hosted install is never offered the switch. */
  isSaas(): boolean;
  /** Where the deployment's judge runs; asked on a self-hosted install only. */
  judgeRoute(): Promise<InstantEvalJudgeRoute>;
  /** Whether the organization's license names Instant Evals, and whether an admin left them on. */
  licenseStateOf(organizationId: string): Promise<ConnectServiceState>;
  isEnterprisePlan(organizationId: string): Promise<boolean>;
  /** The authority the switch's route declares (`organization:manage`), asked of the reader. */
  mayManageOrganization(input: { userId: string; organizationId: string }): Promise<boolean>;
  isReleased(input: { projectId: string }): Promise<boolean>;
  recordOptIn(input: { organizationId: string; userId: string }): Promise<void>;
}

export class InstantEvalOptInService {
  private constructor(private readonly peers: InstantEvalOptInPeers) {}

  static create({ peers }: { peers: InstantEvalOptInPeers }): InstantEvalOptInService {
    return new InstantEvalOptInService(peers);
  }

  /** Released or not, and what the popover offers; the organization is the project's. */
  async getAccess({
    projectId,
    userId,
  }: {
    projectId: string;
    userId: string;
  }): Promise<InstantEvalOptInAccess> {
    const organizationId = await this.organizationOf(projectId);
    const [released, offer, viaConnect] = await Promise.all([
      this.peers.isReleased({ projectId }),
      this.offerFor({ organizationId, userId }),
      this.judgesThroughConnect(),
    ]);
    return { released, offer, viaConnect };
  }

  /**
   * Refused, and nothing recorded, where the popover offers a word with us. The
   * member's authority is the route's declared permission, so it is not asked again.
   */
  async optIn({
    projectId,
    userId,
  }: {
    projectId: string;
    userId: string;
  }): Promise<InstantEvalOptInAccess> {
    const organizationId = await this.organizationOf(projectId);
    if (!(await this.switchOffered(organizationId))) {
      const deployment = this.peers.isSaas() ? "enterprise" : "self_hosted";
      throw new InstantEvalOptInNotOfferedError({ deployment });
    }
    await this.peers.recordOptIn({ organizationId, userId });
    // The switch is thrown on the hosted service only, which never judges through Connect.
    return { released: true, offer: "enable", viaConnect: false };
  }

  /** A self-hosted install judging through LangWatch: "can't run" then names its two hosts. */
  private async judgesThroughConnect(): Promise<boolean> {
    if (this.peers.isSaas()) return false;
    return (await this.peers.judgeRoute()) === "connect";
  }

  private async offerFor({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string;
  }): Promise<InstantEvalOptInOffer> {
    if (!this.peers.isSaas()) return this.selfHostedOffer(organizationId);
    if (!(await this.switchOffered(organizationId))) return "contact_us";
    if (!(await this.peers.mayManageOrganization({ userId, organizationId }))) return "ask_admin";
    return "enable";
  }

  /**
   * Why a self-hosted install is not released, from its judge and its license; the plan is
   * never read. Entitled and switched on leaves a credential it cannot present (main #8416).
   */
  private async selfHostedOffer(organizationId: string): Promise<SelfHostedInstantEvalOffer> {
    const route = await this.peers.judgeRoute();
    if (route === "off" || route === "own_key") return "ask_operator";
    if (route === "disconnected") return "not_connected";
    const license = await this.peers.licenseStateOf(organizationId);
    if (!license.isEntitled) return "not_in_license";
    if (!license.isSwitchedOn) return "switched_off";
    return "not_connected";
  }

  /** The organization's half of the offer: the hosted service, and not an enterprise plan. */
  private async switchOffered(organizationId: string): Promise<boolean> {
    if (!this.peers.isSaas()) return false;
    return !(await this.peers.isEnterprisePlan(organizationId));
  }

  /** A project deleted between the permission check and this read is a handled not-found. */
  private async organizationOf(projectId: string): Promise<string> {
    const organizationId = await this.peers.findOrganizationId(projectId);
    if (!organizationId) throw new ProjectNotFoundError();
    return organizationId;
  }
}
