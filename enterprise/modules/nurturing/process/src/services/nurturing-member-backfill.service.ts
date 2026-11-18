// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Copies each organization's current members into nurturing's member copy, which only member
 * facts wrote until now. Spec: enterprise/modules/nurturing/specs/organization-member-facts.feature
 */
import type { NurturingMemberSourceRepository } from "../repositories/nurturing-member-source.repository.ts";
import type { NurturingOrganizationMemberRepository } from "../repositories/nurturing-organization-member.repository.ts";

const ORGANIZATIONS_PER_PAGE = 100;

export type NurturingMemberBackfillPeers = Readonly<{
  source: NurturingMemberSourceRepository;
  members: Pick<
    NurturingOrganizationMemberRepository,
    "findMembershipsOfUsers" | "recordMembershipChange"
  >;
}>;

export type NurturingMemberBackfillTotals = {
  organizations: number;
  /** Active memberships the owners hold. */
  memberships: number;
  /** Rows created, or on a dry run the rows a real run would create. */
  created: number;
  /** Memberships whose row exists, left or not: never touched. */
  alreadyPresent: number;
};

export class NurturingMemberBackfillService {
  static create({ peers }: { peers: NurturingMemberBackfillPeers }): NurturingMemberBackfillService {
    return new NurturingMemberBackfillService(peers);
  }

  private constructor(private readonly peers: NurturingMemberBackfillPeers) {}

  /**
   * A row is created only where none exists for the person and organization, as a join at the
   * owners' membership creation time. An existing row is skipped whatever it holds, so a leave
   * or a disable is never undone, and a second run creates nothing. Stops between organizations
   * on abort.
   */
  async backfill({
    dryRun,
    signal,
  }: {
    dryRun: boolean;
    signal: AbortSignal;
  }): Promise<NurturingMemberBackfillTotals> {
    const totals: NurturingMemberBackfillTotals = {
      organizations: 0,
      memberships: 0,
      created: 0,
      alreadyPresent: 0,
    };
    let after: string | undefined;
    for (;;) {
      const ids = await this.peers.source.listOrganizationIds({
        after,
        limit: ORGANIZATIONS_PER_PAGE,
      });
      for (const organizationId of ids) {
        if (signal.aborted) return totals;
        await this.#backfillOrganization({ organizationId, dryRun, totals });
      }
      if (ids.length < ORGANIZATIONS_PER_PAGE) return totals;
      after = ids.at(-1);
    }
  }

  async #backfillOrganization({
    organizationId,
    dryRun,
    totals,
  }: {
    organizationId: string;
    dryRun: boolean;
    totals: NurturingMemberBackfillTotals;
  }): Promise<void> {
    const active = await this.peers.source.findActiveMembers({ organizationId });
    const present = new Set(
      (await this.peers.members.findMembershipsOfUsers({ userIds: active.map((m) => m.userId) }))
        .filter((row) => row.organizationId === organizationId)
        .map(({ userId }) => userId),
    );
    totals.organizations += 1;
    totals.memberships += active.length;
    for (const { userId, joinedAt } of active) {
      if (present.has(userId)) {
        totals.alreadyPresent += 1;
        continue;
      }
      totals.created += 1;
      if (dryRun) continue;
      // The write keeps the latest time per change, so a leave landing between the read and here
      // still wins: its time is after the membership's creation.
      await this.peers.members.recordMembershipChange({
        organizationId,
        userId,
        change: "joined",
        at: joinedAt,
      });
    }
  }
}
