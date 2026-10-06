/**
 * An organization's own switch for Instant Evals (main #8348): a self-serve
 * organization on the hosted service throws it from the refusal popover; an
 * enterprise one, or a self-hosted install, is offered a word with us instead.
 * @see modules/instant-eval/specs/instant-eval-opt-in.feature
 */

import {
  type InstantEvalOptInAccess,
  type InstantEvalOptInOffer,
  InstantEvalOptInNotOfferedError,
} from "@langwatch/instant-eval-contract";
import { ProjectNotFoundError } from "@langwatch/project-contract";

/** The peers the offer and the switch ask, each narrowed to one question. */
export interface InstantEvalOptInPeers {
  findOrganizationId(projectId: string): Promise<string | undefined>;
  /** Whether this is the hosted service; a self-hosted install is never offered the switch. */
  isSaas(): boolean;
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
    const [released, offer] = await Promise.all([
      this.peers.isReleased({ projectId }),
      this.offerFor({ organizationId, userId }),
    ]);
    return { released, offer };
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
    if (!(await this.switchOffered(organizationId))) throw new InstantEvalOptInNotOfferedError();
    await this.peers.recordOptIn({ organizationId, userId });
    return { released: true, offer: "enable" };
  }

  private async offerFor({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string;
  }): Promise<InstantEvalOptInOffer> {
    if (!(await this.switchOffered(organizationId))) return "contact_us";
    if (!(await this.peers.mayManageOrganization({ userId, organizationId }))) return "ask_admin";
    return "enable";
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
