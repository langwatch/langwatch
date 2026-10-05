/**
 * An organization's own switch for Instant Evals: what the refusal popover
 * offers, and the switch itself. The release flag stays the operator's, and
 * nothing ever opts an organization in on its behalf.
 * @see specs/instant-evals/instant-eval-opt-in.feature
 */
import {
  type InstantEvalAccessWire,
  InstantEvalOptInNotOfferedError,
  type InstantEvalOptInOffer,
} from "@langwatch/instant-eval-contract";
import { ProjectNotFoundError } from "@langwatch/project-contract";

import { isOptInSwitchOffered, optInOfferFor } from "../rules/instant-eval-opt-in.rules.ts";

/** The peers the switch reads and writes, each narrowed to the one question asked. */
export interface InstantEvalOptInPeers {
  findOrganizationId(projectId: string): Promise<string | undefined>;
  /** The active plan's tier name, as the entitlement module reports it. */
  planTypeOf(input: { organizationId: string; userId: string }): Promise<string>;
  /** The same authority the switch's mutation declares: `organization:manage`. */
  maySwitch(input: { organizationId: string; userId: string }): Promise<boolean>;
  isOptedIn(input: { organizationId: string }): Promise<boolean>;
  recordOptIn(input: { organizationId: string; userId: string }): Promise<void>;
  /** The row naming the organization; the request's own row names only the project. */
  auditSwitch(input: { organizationId: string; userId: string; projectId: string }): Promise<void>;
  isReleased(input: { projectId: string; organizationId: string }): Promise<boolean>;
}

export class InstantEvalOptInService {
  private readonly peers: InstantEvalOptInPeers;
  private readonly isSaas: () => boolean;

  private constructor(options: { peers: InstantEvalOptInPeers; isSaas: () => boolean }) {
    this.peers = options.peers;
    this.isSaas = options.isSaas;
  }

  static create(options: {
    peers: InstantEvalOptInPeers;
    /** The deployment: only the hosted service offers the switch. */
    isSaas: () => boolean;
  }): InstantEvalOptInService {
    return new InstantEvalOptInService(options);
  }

  async readAccess({
    projectId,
    userId,
  }: {
    projectId: string;
    userId: string;
  }): Promise<InstantEvalAccessWire> {
    const organizationId = await this.organizationOf(projectId);
    const [released, offer] = await Promise.all([
      this.peers.isReleased({ projectId, organizationId }),
      this.offerFor({ organizationId, userId }),
    ]);
    return { released, offer };
  }

  /**
   * The member's authority is the mutation's declared permission, so only the
   * organization's half of the offer is checked here.
   */
  async switchOn({
    projectId,
    userId,
  }: {
    projectId: string;
    userId: string;
  }): Promise<InstantEvalAccessWire> {
    const organizationId = await this.organizationOf(projectId);
    if (!(await this.switchOffered({ organizationId, userId }))) {
      throw new InstantEvalOptInNotOfferedError();
    }
    await this.peers.recordOptIn({ organizationId, userId });
    await this.peers.auditSwitch({ organizationId, userId, projectId });
    return { released: true, offer: "enable" };
  }

  /** The member is asked only once the organization is one the switch is offered to. */
  private async offerFor(input: {
    organizationId: string;
    userId: string;
  }): Promise<InstantEvalOptInOffer> {
    const switchOffered = await this.switchOffered(input);
    const maySwitch = switchOffered && (await this.peers.maySwitch(input));
    return optInOfferFor({ switchOffered, maySwitch });
  }

  private async switchOffered(input: { organizationId: string; userId: string }): Promise<boolean> {
    // A self-hosted install never reads its plan for this: the answer is already no.
    const isSaas = this.isSaas();
    if (!isSaas) return false;
    return isOptInSwitchOffered({ isSaas, planType: await this.peers.planTypeOf(input) });
  }

  /** A project deleted after the permission check is a handled not-found, not a crash. */
  private async organizationOf(projectId: string): Promise<string> {
    const organizationId = await this.peers.findOrganizationId(projectId);
    if (organizationId === undefined) {
      throw new ProjectNotFoundError("Project not found", { meta: { projectId } });
    }
    return organizationId;
  }
}
