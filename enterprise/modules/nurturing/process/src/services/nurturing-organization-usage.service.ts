// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  CioBatchCall,
  CioOrganizationUsageTraits,
} from "@langwatch/enterprise-nurturing-contract";
import type { CounterHandle } from "@langwatch/observability/metrics";

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
import type { NurturingCopiedProjectsService } from "./nurturing-copied-projects.service.ts";

/** Members read and identified per request, so a large organization never opens a burst. */
const MEMBER_BATCH_SIZE = 100;

type OrganizationUsageDependencies = Readonly<{
  projectUsage: NurturingProjectUsageReadRepository;
  traceDays: NurturingTraceDayReadRepository;
  copiedProjects: Pick<NurturingCopiedProjectsService, "copiedProjectOf">;
  /** Nurturing's own copy of each project's organization, from project's creation facts. */
  placements: Pick<NurturingProjectPlacementRepository, "findProjectIds">;
  /** Nurturing's own copy of each organization's creation, from organization's facts. */
  organizationsCreated: Pick<
    NurturingOrganizationCreatedRepository,
    "findOrganizationIdsCreatedBetween"
  >;
  milestones: Pick<NurturingMilestonesRepository, "findOrganization">;
  /** Nurturing's own copy of the organizations' members, from the owners' member facts. */
  members: Pick<NurturingOrganizationMemberRepository, "findMembershipsOfMembers">;
  /** Rejects when Customer.io did not take the call, so the subscriber's job retries. */
  sendBatch: (calls: CioBatchCall[]) => Promise<void>;
  clock: Readonly<{ nowMs: () => number }>;
  /**
   * One increment per sync attempt, its `outcome` the only attribute, never an id: `synced`,
   * `mirror_failed`, `send_failed` (the group call was refused), `error` (anything else threw),
   * `no_admin`, `not_placed` or `outside_counting_window`.
   */
  syncs: CounterHandle;
  /** Run lines carry counts and reasons only, never an organization, user or project id. */
  logger: Readonly<{
    warn(payload: Readonly<Record<string, unknown>>, message: string): void;
    info(payload: Readonly<Record<string, unknown>>, message: string): void;
    debug(payload: Readonly<Record<string, unknown>>, message: string): void;
  }>;
}>;

/** What mirroring onto members has sent so far, kept as it goes so a failed batch loses no count. */
type MirroredCounts = { members: number; identifyCalls: number };

/** Why a sync sent nothing, as counted and logged. */
type SkipReason = "no_admin" | "not_placed" | "outside_counting_window";

/** Set once a failure is counted with its own outcome, so the attempt does not count it again. */
type AttemptState = { counted: boolean };

/** An organization as nurturing's own copies place and date it. */
type CopiedOrganization = Readonly<{ organizationId: string; organizationCreatedAt: number }>;

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

  /** The project's usage changed: its organization's traits go to Customer.io. */
  async usageChanged({ projectId }: Readonly<{ projectId: string }>): Promise<void> {
    await this.attempt(async (state) => {
      const organization = await this.copiedOrganizationOf({ projectId });
      if (organization) await this.syncOrganization(organization, state);
    });
  }

  /**
   * The project traced: its organization syncs while inside its counting window. Past it no trait
   * a trace moves is sent, and the rest are a fold's sync's, so nothing is read or sent.
   */
  async tracesChanged({ projectId }: Readonly<{ projectId: string }>): Promise<void> {
    await this.attempt(async (state) => {
      const organization = await this.copiedOrganizationOf({ projectId });
      if (!organization) return;
      const at = this.dependencies.clock.nowMs();
      if (!isTraceCounted({ organizationCreatedAt: organization.organizationCreatedAt, at })) {
        this.skipped("outside_counting_window");
        return;
      }
      await this.syncOrganization(organization, state);
    });
  }

  /** Counts every attempt once: a throw nothing counted yet is an `error`, and still rethrown. */
  private async attempt(run: (state: AttemptState) => Promise<void>): Promise<void> {
    const state: AttemptState = { counted: false };
    try {
      await run(state);
    } catch (error) {
      if (!state.counted) this.dependencies.syncs.inc({ outcome: "error" });
      throw error;
    }
  }

  private skipped(reason: SkipReason): void {
    this.dependencies.syncs.inc({ outcome: reason });
    this.dependencies.logger.debug({ reason }, "nurturing organization usage sync skipped");
  }

  /**
   * The project's organization, when nurturing saw both created. One created before nurturing kept
   * its creation copy may hold projects nurturing never saw created: its sums would be partial.
   */
  private async copiedOrganizationOf({
    projectId,
  }: Readonly<{ projectId: string }>): Promise<CopiedOrganization | undefined> {
    if (projectId === "") {
      this.skipped("not_placed");
      return undefined;
    }
    const project = await this.dependencies.copiedProjects.copiedProjectOf({ projectId });
    if (project.outcome !== "placed" || project.organizationCreatedAt === null) {
      this.skipped("not_placed");
      return undefined;
    }
    const { organizationId, organizationCreatedAt } = project;
    return { organizationId, organizationCreatedAt };
  }

  private async syncOrganization(
    { organizationId, organizationCreatedAt }: CopiedOrganization,
    state: AttemptState,
  ): Promise<void> {
    const { projectUsage, traceDays, placements, milestones, sendBatch, clock } = this.dependencies;
    const now = clock.nowMs();
    const windowStartDay = windowStartDayOf(now);
    const counting = isTraceCounted({ organizationCreatedAt, at: now });
    const projectIds = await placements.findProjectIds({ organizationId });
    // Inside the counting window no trace day is older than the usage window, and the window-end
    // sweep drops them all; past it, only a trace counted late around the sweep can be left.
    if (!counting) await traceDays.pruneBefore({ projectIds, beforeDay: windowStartDay });
    const [organization] = await milestones.findOrganization({ organizationId });
    const adminUserId = organization?.adminUserId;
    if (!adminUserId) {
      this.skipped("no_admin");
      return;
    }
    const [usage, folded] = await Promise.all([
      projectUsage.findForProjects({ projectIds }),
      counting ? traceDays.findForProjects({ projectIds, afterDay: windowStartDay }) : [],
    ]);
    // Past the counting window no trace is counted, so the last trace traits sent stand.
    const traces = counting ? traceCountsOf({ days: folded, windowStartDay }) : null;
    const traits = organizationUsageTraits({
      projects: usage,
      traces,
      now,
      organizationCreatedAt,
    });
    try {
      await sendBatch([{ type: "group", userId: adminUserId, groupId: organizationId, traits }]);
    } catch (error) {
      state.counted = true;
      this.dependencies.syncs.inc({ outcome: "send_failed" });
      throw error;
    }
    // An out-parameter, so a batch that fails midway still reports the identifies already sent.
    const mirrored: MirroredCounts = { members: 0, identifyCalls: 0 };
    let mirrorFailed = false;
    try {
      await this.mirrorOntoMembers({ organizationId, traits, counts: mirrored });
    } catch (error) {
      mirrorFailed = true;
      // The group call stands, and the next sync mirrors again, as the other sinks' failures.
      this.dependencies.logger.warn(
        { error, organizationId },
        "an organization's usage could not be mirrored onto its members",
      );
    }
    this.dependencies.syncs.inc({ outcome: mirrorFailed ? "mirror_failed" : "synced" });
    // Debug: it fires for every changed project, so the counter carries the volume.
    this.dependencies.logger.debug(
      {
        counting,
        projects: projectIds.length,
        groupCalls: 1,
        identifyCalls: mirrored.identifyCalls,
        members: mirrored.members,
        mirrorFailed,
      },
      "nurturing organization usage synced",
    );
  }

  /**
   * Ends the trace window of every organization whose window ended in (`after`, `upTo`]: its trace
   * traits go once as null, on the organization and its members, so a rolling trait cannot say
   * "active" for ever. Later syncs leave them out, and its trace rows are dropped. A refused call,
   * an identify's too, throws, so the sweep retries; a retry sends the same nulls again.
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
    let synced = 0;
    let skippedNoAdmin = 0;
    // Shared across organizations, so identifyCalls totals the sweep even if it fails midway.
    const mirrored: MirroredCounts = { members: 0, identifyCalls: 0 };
    try {
      for (const organizationId of ended) {
        // Nothing reads its trace rows past the window, and a quiet organization never syncs again.
        await traceDays.pruneProjects({
          projectIds: await placements.findProjectIds({ organizationId }),
        });
        const [organization] = await milestones.findOrganization({ organizationId });
        const adminUserId = organization?.adminUserId;
        if (!adminUserId) {
          skippedNoAdmin += 1;
          continue;
        }
        await sendBatch([{ type: "group", userId: adminUserId, groupId: organizationId, traits }]);
        await this.mirrorOntoMembers({ organizationId, traits, counts: mirrored });
        synced += 1;
      }
    } finally {
      this.dependencies.logger.info(
        {
          ended: ended.length,
          synced,
          skippedNoAdmin,
          groupCalls: synced,
          identifyCalls: mirrored.identifyCalls,
        },
        "nurturing trace windows ended",
      );
    }
  }

  /**
   * The onboarding emails are person-triggered and read person attributes, so each member gets the
   * traits too, unless they joined another organization since: that one's traits are theirs. A
   * refused call throws; each caller decides whether it is retried.
   */
  private async mirrorOntoMembers({
    organizationId,
    traits,
    counts,
  }: Readonly<{
    organizationId: string;
    traits: CioOrganizationUsageTraits;
    counts: MirroredCounts;
  }>): Promise<void> {
    const { members, sendBatch } = this.dependencies;
    const userIds = membersWhoseLatestOrganizationIs({
      memberships: await members.findMembershipsOfMembers({ organizationId }),
      organizationId,
    });
    counts.members = userIds.length;
    for (let start = 0; start < userIds.length; start += MEMBER_BATCH_SIZE) {
      const batch = userIds.slice(start, start + MEMBER_BATCH_SIZE);
      await sendBatch(batch.map((userId) => ({ type: "identify" as const, userId, traits })));
      counts.identifyCalls += batch.length;
    }
  }
}
