// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  CioBatchCall,
  CioOrganizationUsageTraits,
} from "@langwatch/enterprise-nurturing-contract";
import { createLogger } from "@langwatch/observability";

import type { NurturingMilestonesRepository } from "../repositories/nurturing-milestones.repository.ts";
import type { NurturingOrganizationCreatedRepository } from "../repositories/nurturing-organization-created.repository.ts";
import type { NurturingOrganizationMemberRepository } from "../repositories/nurturing-organization-member.repository.ts";
import type { NurturingProjectPlacementRepository } from "../repositories/nurturing-project-placement.repository.ts";
import type { NurturingProjectUsageReadRepository } from "../repositories/nurturing-project-usage.repository.ts";
import type { NurturingTraceDayReadRepository } from "../repositories/nurturing-trace-day.repository.ts";
import { membersWhoseLatestOrganizationIs } from "../rules/nurturing-organization-member.rules.ts";
import {
  createdRangeOfEndedWindows,
  endedTraceWindowTraits,
  isTraceCounted,
  organizationUsageTraits,
  windowStartDayOf,
} from "../rules/nurturing-project-usage.rules.ts";
import { traceCountsOf } from "../rules/nurturing-trace-day.rules.ts";

const nurturingLogger = createLogger("langwatch:nurturing");

/** Members read and identified per request, so a large organization never opens a burst. */
const MEMBER_BATCH_SIZE = 100;

type OrganizationUsageDependencies = Readonly<{
  projectUsage: NurturingProjectUsageReadRepository;
  traceDays: NurturingTraceDayReadRepository;
  /** Nurturing's own copy of each project's organization, from project's creation facts. */
  placements: Pick<NurturingProjectPlacementRepository, "getPlacement" | "findProjectIds">;
  /** Nurturing's own copy of each organization's creation, from organization's facts. */
  organizationsCreated: Pick<
    NurturingOrganizationCreatedRepository,
    "findOrganizationCreatedAt" | "findOrganizationIdsCreatedBetween"
  >;
  milestones: Pick<NurturingMilestonesRepository, "findOrganization">;
  /** Nurturing's own copy of the organizations' members, from the owners' member facts. */
  members: Pick<NurturingOrganizationMemberRepository, "findMembershipsOfMembers">;
  /** Rejects when Customer.io did not take the call, so the subscriber's job retries. */
  sendBatch: (calls: CioBatchCall[]) => Promise<void>;
  clock: Readonly<{ nowMs: () => number }>;
}>;

/**
 * Turns a project's changed usage into its organization's traits: sums the organization's projects
 * from nurturing's own rows, sends one group call to the admin, then mirrors the traits onto each
 * member whose most recently joined organization it is. Trace counts start at nurturing's first
 * counted trace. Sends nothing for a project nurturing never saw created (one made before it kept
 * the copy), or one with no admin yet.
 */
export class NurturingOrganizationUsageService {
  static create(dependencies: OrganizationUsageDependencies): NurturingOrganizationUsageService {
    return new NurturingOrganizationUsageService(dependencies);
  }

  private constructor(private readonly dependencies: OrganizationUsageDependencies) {}

  /** The project's usage or traces changed: its organization's traits go to Customer.io. */
  async usageChanged({ projectId }: Readonly<{ projectId: string }>): Promise<void> {
    const {
      projectUsage,
      traceDays,
      placements,
      organizationsCreated,
      milestones,
      sendBatch,
      clock,
    } = this.dependencies;
    if (projectId === "") return;
    const now = clock.nowMs();
    const windowStartDay = windowStartDayOf(now);
    // A path that sends nothing still prunes the changed project's own old rows.
    const pruneProject = () =>
      traceDays.pruneBefore({ projectIds: [projectId], beforeDay: windowStartDay });
    const placement = await placements.getPlacement({ projectId });
    if (placement.outcome !== "known") return pruneProject();
    const { organizationId } = placement;
    // An organization created before nurturing kept its creation copy may hold projects nurturing
    // never saw created: its sums would be partial, so it is sent nothing.
    const { organizationCreatedAt } = await organizationsCreated.findOrganizationCreatedAt({
      organizationId,
    });
    if (organizationCreatedAt === null) return pruneProject();
    const [organization] = await milestones.findOrganization({ organizationId });
    const adminUserId = organization?.adminUserId;
    if (!adminUserId) return pruneProject();
    const projectIds = await placements.findProjectIds({ organizationId });
    await traceDays.pruneBefore({ projectIds, beforeDay: windowStartDay });
    const [usage, folded] = await Promise.all([
      projectUsage.findForProjects({ projectIds }),
      traceDays.findForProjects({ projectIds, afterDay: windowStartDay }),
    ]);
    // Past the counting window no trace is counted, so the last trace traits sent stand.
    const traces = isTraceCounted({ organizationCreatedAt, at: now })
      ? traceCountsOf({ days: folded, windowStartDay })
      : null;
    const traits = organizationUsageTraits({
      projects: usage,
      traces,
      now,
      organizationCreatedAt,
    });
    await sendBatch([{ type: "group", userId: adminUserId, groupId: organizationId, traits }]);
    await this.mirrorOntoMembers({ organizationId, traits });
  }

  /**
   * Ends the trace window of every organization whose window ended in (`after`, `upTo`]: its trace
   * traits go once as null, on the organization and its members, so a rolling trait cannot say
   * "active" for ever. Later syncs leave them out, and its trace rows are dropped. A refused call
   * throws, so the sweep retries.
   */
  async traceWindowsEnded({
    after,
    upTo,
  }: Readonly<{ after: number; upTo: number }>): Promise<void> {
    const { organizationsCreated, milestones, placements, traceDays, sendBatch } =
      this.dependencies;
    const ended = await organizationsCreated.findOrganizationIdsCreatedBetween(
      createdRangeOfEndedWindows({ after, upTo }),
    );
    const traits = endedTraceWindowTraits();
    for (const organizationId of ended) {
      // Nothing reads its trace rows past the window, and a quiet organization never syncs again.
      await traceDays.pruneProjects({
        projectIds: await placements.findProjectIds({ organizationId }),
      });
      const [organization] = await milestones.findOrganization({ organizationId });
      const adminUserId = organization?.adminUserId;
      if (!adminUserId) continue;
      await sendBatch([{ type: "group", userId: adminUserId, groupId: organizationId, traits }]);
      await this.mirrorOntoMembers({ organizationId, traits });
    }
  }

  /**
   * The onboarding emails are person-triggered and read person attributes, so each member gets the
   * traits too, unless they joined another organization since: that one's traits are theirs. A
   * failure is reported and swallowed, as the other sinks': the group call stands, the next sync
   * mirrors again.
   */
  private async mirrorOntoMembers({
    organizationId,
    traits,
  }: Readonly<{ organizationId: string; traits: CioOrganizationUsageTraits }>): Promise<void> {
    const { members, sendBatch } = this.dependencies;
    try {
      const userIds = membersWhoseLatestOrganizationIs({
        memberships: await members.findMembershipsOfMembers({ organizationId }),
        organizationId,
      });
      for (let start = 0; start < userIds.length; start += MEMBER_BATCH_SIZE) {
        await sendBatch(
          userIds
            .slice(start, start + MEMBER_BATCH_SIZE)
            .map((userId) => ({ type: "identify" as const, userId, traits })),
        );
      }
    } catch (error) {
      nurturingLogger.warn(
        { error, organizationId },
        "an organization's usage could not be mirrored onto its members",
      );
    }
  }
}
