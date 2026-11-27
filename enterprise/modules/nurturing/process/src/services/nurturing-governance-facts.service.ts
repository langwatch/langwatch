// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { IngestionSourceFactData } from "@langwatch/enterprise-governance-contract/ingestion-source-lifecycle";
import type { NurturingSignal } from "@langwatch/enterprise-nurturing-contract";

import type { NurturingErasedUserRepository } from "../repositories/nurturing-erased-user.repository.ts";
import type { NurturingOrganizationMemberRepository } from "../repositories/nurturing-organization-member.repository.ts";
import {
  type GovernanceSourceSignal,
  governanceSourceSignal,
} from "../rules/nurturing-governance-facts.rules.ts";
import { NurturingFactRecipientService } from "./nurturing-fact-recipient.service.ts";
import type { NurturingMemberFactsService } from "./nurturing-member-facts.service.ts";

type GovernanceFactsDependencies = Readonly<{
  /** Nurturing's erasure marks: an erased creator is passed over for the admin. */
  erasedUsers: Pick<NurturingErasedUserRepository, "findErased">;
  /** Nurturing's member copy, disabled rows included: whether the creator is still a member. */
  members: Pick<NurturingOrganizationMemberRepository, "findMembershipsOfUsers">;
  /** The copied admin: the recipient when the creator is not a current member. */
  admins: Pick<NurturingMemberFactsService, "adminOf">;
  /** Lines carry the source's id and a reason, never a person's id. */
  logger: Readonly<{
    debug(payload: Readonly<Record<string, unknown>>, message: string): void;
    warn(payload: Readonly<Record<string, unknown>>, message: string): void;
  }>;
}>;

type SourceFactInput = Readonly<{
  data: IngestionSourceFactData;
  deliver: (signal: NurturingSignal) => Promise<void>;
}>;

/**
 * Turns governance's ingestion-source facts into one current member's signal: the source's
 * creator, else the organization's admin. The fact names its creator, but they may have left or
 * been erased since, and a Company group call would re-attach them to the organization.
 * Spec: enterprise/modules/nurturing/specs/governance-facts.feature
 */
export class NurturingGovernanceFactsService {
  static create(dependencies: GovernanceFactsDependencies): NurturingGovernanceFactsService {
    return new NurturingGovernanceFactsService(dependencies);
  }

  private readonly recipients: NurturingFactRecipientService;

  private constructor(private readonly dependencies: GovernanceFactsDependencies) {
    this.recipients = NurturingFactRecipientService.create(dependencies);
  }

  /** A source was created: its organization has a governance source. */
  async sourceConnected(input: SourceFactInput): Promise<void> {
    await this.tell({ ...input, kind: "governance_source_connected" });
  }

  /** A source took its first data: its organization has governance data. */
  async sourceWentLive(input: SourceFactInput): Promise<void> {
    await this.tell({ ...input, kind: "governance_source_live" });
  }

  private async tell({
    data,
    deliver,
    kind,
  }: SourceFactInput & Readonly<{ kind: GovernanceSourceSignal["kind"] }>): Promise<void> {
    const { sourceId } = data;
    const { recipient, passedOverWithoutRow } = await this.recipients.recipientOf({
      organizationId: data.organizationId,
      named: [data.actorUserId],
    });
    if (passedOverWithoutRow.length > 0) {
      this.dependencies.logger.warn(
        { sourceId, fact: kind, reason: "creator_not_in_member_copy" },
        "a source's creator with no row in nurturing's member copy was passed over",
      );
    }
    if (recipient === null) {
      this.dependencies.logger.debug(
        { sourceId, fact: kind, reason: "no_recipient" },
        "a governance source fact finds no current member to tell; nothing is sent",
      );
      return;
    }
    await deliver(governanceSourceSignal({ kind, data, userId: recipient }));
  }
}
