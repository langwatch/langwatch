// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  CioBatchCall,
  CioOrganizationUsageTraits,
} from "@langwatch/enterprise-nurturing-contract";
import type { CounterHandle } from "@langwatch/observability/metrics";

import type { NurturingClaimRepository } from "../repositories/nurturing-claim.repository.ts";
import type { NurturingErasedUserRepository } from "../repositories/nurturing-erased-user.repository.ts";
import type { NurturingEvaluationDayReadRepository } from "../repositories/nurturing-evaluation-day.repository.ts";
import type { NurturingMilestonesRepository } from "../repositories/nurturing-milestones.repository.ts";
import type { NurturingOrganizationCreatedRepository } from "../repositories/nurturing-organization-created.repository.ts";
import type { NurturingOrganizationMemberRepository } from "../repositories/nurturing-organization-member.repository.ts";
import type { NurturingProjectPlacementRepository } from "../repositories/nurturing-project-placement.repository.ts";
import type { NurturingProjectUsageReadRepository } from "../repositories/nurturing-project-usage.repository.ts";
import type { NurturingTraceDayReadRepository } from "../repositories/nurturing-trace-day.repository.ts";
import { companyTraits } from "../rules/nurturing-company-traits.rules.ts";
import { membersWhoseLatestOrganizationIs } from "../rules/nurturing-organization-member.rules.ts";
import {
  createdRangeOfEndedWindows,
  endedTraceWindowTraits,
  evaluationActivityOf,
  isTraceCounted,
  organizationUsageTraits,
  windowStartDayOf,
} from "../rules/nurturing-project-usage.rules.ts";
import { traceActiveDaysToSend } from "../rules/nurturing-trace-active-day.rules.ts";
import { traceCountsOf } from "../rules/nurturing-trace-day.rules.ts";
import type { NurturingCopiedProjectsService } from "./nurturing-copied-projects.service.ts";
import { NurturingTraceActiveDayService } from "./nurturing-trace-active-day.service.ts";

/** Members read and identified per request, so a large organization never opens a burst. */
const MEMBER_BATCH_SIZE = 100;

type OrganizationUsageDependencies = Readonly<{
  projectUsage: NurturingProjectUsageReadRepository;
  traceDays: NurturingTraceDayReadRepository;
  /** Nurturing's own evaluation days, read beside the trace days for the habit. */
  evaluationDays: NurturingEvaluationDayReadRepository;
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
  /**
   * Nurturing's erasure marks: a member row can still name an erased person (a worker stopped
   * between a write and its re-check, or a row from before the marks), and no identify goes to one.
   */
  erasedUsers: Pick<NurturingErasedUserRepository, "findErased">;
  /** Lets each member's trace_active_day of a day out once, across retries and redeliveries. */
  claims: Pick<NurturingClaimRepository, "claim" | "release">;
  /** Rejects when Customer.io did not take the call, so the subscriber's job retries. */
  sendBatch: (calls: CioBatchCall[]) => Promise<void>;
  clock: Readonly<{ nowMs: () => number }>;
  /**
   * One increment per sync attempt, its `outcome` the only attribute, never an id: `synced`,
   * `mirror_failed`, `send_failed` (the group call was refused), `events_failed` (a
   * trace_active_day claim or batch failed), `error` (anything else threw), `no_admin`,
   * `not_placed` or `outside_counting_window`.
   */
  syncs: CounterHandle;
  /** Run lines carry counts and reasons only, never an organization, user or project id. */
  logger: Readonly<{
    warn(payload: Readonly<Record<string, unknown>>, message: string): void;
    info(payload: Readonly<Record<string, unknown>>, message: string): void;
    debug(payload: Readonly<Record<string, unknown>>, message: string): void;
  }>;
}>;

/** The identifies mirroring has sent so far, kept as it goes so a failed batch loses no count. */
type MirroredCounts = { identifyCalls: number };

/** Why a sync sent nothing, as counted and logged. */
type SkipReason = "no_admin" | "not_placed" | "outside_counting_window";

/** Set once a failure is counted with its own outcome, so the attempt does not count it again. */
type AttemptState = { counted: boolean };

/** An organization as nurturing's own copies place and date it. */
type CopiedOrganization = Readonly<{ organizationId: string; organizationCreatedAt: number }>;

/**
 * Turns a project's changed usage into its organization's traits: sums the organization's projects
 * from nurturing's own rows, sends one group call to the admin, then mirrors the traits onto each
 * member whose most recently joined organization it is, with one trace_active_day per member and
 * recent traced day while counting. Trace counts start at nurturing's first counted trace. Sends
 * nothing for a project nurturing never saw created (one made before it kept the copy), or one
 * with no admin yet.
 */
export class NurturingOrganizationUsageService {
  static create(dependencies: OrganizationUsageDependencies): NurturingOrganizationUsageService {
    return new NurturingOrganizationUsageService(dependencies);
  }

  private readonly traceActiveDays: NurturingTraceActiveDayService;

  private constructor(private readonly dependencies: OrganizationUsageDependencies) {
    this.traceActiveDays = NurturingTraceActiveDayService.create(dependencies);
  }

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
    const { projectUsage, traceDays, evaluationDays, placements, milestones, sendBatch, clock } =
      this.dependencies;
    const now = clock.nowMs();
    const windowStartDay = windowStartDayOf(now);
    const counting = isTraceCounted({ organizationCreatedAt, at: now });
    const projectIds = await placements.findProjectIds({ organizationId });
    // Inside the counting window no trace day is older than the usage window, and the window-end
    // sweep drops them all; past it, only a trace counted late around the sweep can be left.
    // Evaluation days keep landing past it, and only the counting window reads them.
    if (!counting) {
      await traceDays.pruneBefore({ projectIds, beforeDay: windowStartDay });
      await evaluationDays.pruneProjects({ projectIds });
    }
    const [organization] = await milestones.findOrganization({ organizationId });
    const adminUserId = organization?.adminUserId;
    if (!adminUserId) {
      this.skipped("no_admin");
      return;
    }
    const [usage, evaluated, folded] = await Promise.all([
      projectUsage.findForProjects({ projectIds }),
      counting ? evaluationDays.findForProjects({ projectIds, afterDay: windowStartDay }) : [],
      counting ? traceDays.findForProjects({ projectIds, afterDay: windowStartDay }) : [],
    ]);
    // Past the counting window no trace is counted, so the last trace traits sent stand.
    const traces = counting ? traceCountsOf({ days: folded, windowStartDay }) : null;
    const traits = organizationUsageTraits({
      projects: [...usage, ...evaluationActivityOf(evaluated)],
      traces,
      now,
      organizationCreatedAt,
    });
    const company = companyTraits({ projectCount: projectIds.length, organizationCreatedAt });
    try {
      await sendBatch([
        {
          type: "group",
          userId: adminUserId,
          groupId: organizationId,
          traits: { ...traits, ...company },
        },
      ]);
    } catch (error) {
      state.counted = true;
      this.dependencies.syncs.inc({ outcome: "send_failed" });
      throw error;
    }
    const mirrored: MirroredCounts = { identifyCalls: 0 };
    // Outside the swallowing mirror: a failed read rejects, so the retry sends the events it
    // would skip.
    const userIds = await this.membersToMirrorOnto({ organizationId });
    const mirrorFailed = await this.tryMirrorOntoMembers({
      organizationId,
      userIds,
      traits,
      counts: mirrored,
    });
    const trackCalls = await this.sendTraceActiveDays({
      traces,
      userIds,
      now,
      organizationCreatedAt,
      state,
    });
    this.dependencies.syncs.inc({ outcome: mirrorFailed ? "mirror_failed" : "synced" });
    // Debug: it fires for every changed project, so the counter carries the volume.
    this.dependencies.logger.debug(
      {
        counting,
        projects: projectIds.length,
        groupCalls: 1,
        identifyCalls: mirrored.identifyCalls,
        trackCalls,
        members: userIds.length,
        mirrorFailed,
      },
      "nurturing organization usage synced",
    );
  }

  /**
   * Ends the trace window of every organization whose window ended in (`after`, `upTo`]: its trace
   * traits go once as null, on the organization and its members, so a rolling trait cannot say
   * "active" for ever. Later syncs leave them out, and its trace and evaluation rows are dropped.
   * A refused call, an identify's too, throws, so the sweep retries; a retry sends the same nulls
   * again.
   */
  async traceWindowsEnded({
    after,
    upTo,
  }: Readonly<{ after: number; upTo: number }>): Promise<void> {
    const { organizationsCreated, milestones, placements, traceDays, evaluationDays, sendBatch } =
      this.dependencies;
    const ended = await organizationsCreated.findOrganizationIdsCreatedBetween(
      createdRangeOfEndedWindows({ after, upTo }),
    );
    const traits = endedTraceWindowTraits();
    let synced = 0;
    let skippedNoAdmin = 0;
    // Shared across organizations, so identifyCalls totals the sweep even if it fails midway.
    const mirrored: MirroredCounts = { identifyCalls: 0 };
    try {
      for (const organizationId of ended) {
        // Nothing reads its trace or evaluation rows past the window, and a quiet organization
        // never syncs again.
        const projectIds = await placements.findProjectIds({ organizationId });
        await traceDays.pruneProjects({ projectIds });
        await evaluationDays.pruneProjects({ projectIds });
        const [organization] = await milestones.findOrganization({ organizationId });
        const adminUserId = organization?.adminUserId;
        if (!adminUserId) {
          skippedNoAdmin += 1;
          continue;
        }
        await sendBatch([{ type: "group", userId: adminUserId, groupId: organizationId, traits }]);
        const userIds = await this.membersToMirrorOnto({ organizationId });
        await this.mirrorOntoMembers({ userIds, traits, counts: mirrored });
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
   * Drops every project's trace days before `beforeDay`, those of projects that never synced or
   * were never placed included: the folds count every trace, and no read reaches them.
   */
  async pruneTraceDaysBefore({ beforeDay }: Readonly<{ beforeDay: string }>): Promise<void> {
    await this.dependencies.traceDays.pruneEveryProjectBefore({ beforeDay });
  }

  /**
   * The members the organization's traits are mirrored onto. The onboarding emails are
   * person-triggered and read person attributes, so each member gets the traits too, unless they
   * joined another organization since: that one's traits are theirs, or were erased.
   */
  private async membersToMirrorOnto({
    organizationId,
  }: Readonly<{ organizationId: string }>): Promise<readonly string[]> {
    const { members, erasedUsers } = this.dependencies;
    const latestHere = membersWhoseLatestOrganizationIs({
      memberships: await members.findMembershipsOfMembers({ organizationId }),
      organizationId,
    });
    const erased = new Set(await erasedUsers.findErased({ userIds: latestHere }));
    return latestHere.filter((userId) => !erased.has(userId));
  }

  /**
   * Sends each member's trace_active_day events, apart from the mirror so a refused identify skips
   * no event; a failure here fails the job, whose retry sends the events its released claims let
   * out again.
   */
  private async sendTraceActiveDays({
    traces,
    userIds,
    now,
    organizationCreatedAt,
    state,
  }: Readonly<{
    traces: ReturnType<typeof traceCountsOf> | null;
    userIds: readonly string[];
    now: number;
    organizationCreatedAt: number;
    state: AttemptState;
  }>): Promise<number> {
    if (!traces) return 0;
    try {
      return await this.traceActiveDays.send({
        userIds,
        days: traceActiveDaysToSend({ activeDays: traces.activeDays, now, organizationCreatedAt }),
        organizationCreatedAt,
      });
    } catch (error) {
      state.counted = true;
      this.dependencies.syncs.inc({ outcome: "events_failed" });
      throw error;
    }
  }

  /**
   * Mirrors the traits onto the members, swallowing a failure: the group call stands, and the next
   * sync mirrors again, as the other sinks' failures. `counts` is an out-parameter, so a batch that
   * fails midway still reports the identifies already sent. Answers whether the mirror failed.
   */
  private async tryMirrorOntoMembers({
    organizationId,
    userIds,
    traits,
    counts,
  }: Readonly<{
    organizationId: string;
    userIds: readonly string[];
    traits: CioOrganizationUsageTraits;
    counts: MirroredCounts;
  }>): Promise<boolean> {
    try {
      await this.mirrorOntoMembers({ userIds, traits, counts });
      return false;
    } catch (error) {
      this.dependencies.logger.warn(
        { error, organizationId },
        "an organization's usage could not be mirrored onto its members",
      );
      return true;
    }
  }

  /** Identifies each member with the traits. A refused call throws; its caller decides on retries. */
  private async mirrorOntoMembers({
    userIds,
    traits,
    counts,
  }: Readonly<{
    userIds: readonly string[];
    traits: CioOrganizationUsageTraits;
    counts: MirroredCounts;
  }>): Promise<void> {
    for (let start = 0; start < userIds.length; start += MEMBER_BATCH_SIZE) {
      const batch = userIds.slice(start, start + MEMBER_BATCH_SIZE);
      await this.dependencies.sendBatch(
        batch.map((userId) => ({ type: "identify" as const, userId, traits })),
      );
      counts.identifyCalls += batch.length;
    }
  }
}
