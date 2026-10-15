// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  DigestCohortInput,
  DigestCohortRow,
  DigestMemberRow,
  DigestMetricRow,
  DigestSettings,
  DigestTemplateId,
  DigestUpdate,
} from "@langwatch/enterprise-digest-contract";
import type { UserApi } from "@langwatch/user-contract";

import type { DigestAudienceRepository } from "../repositories/digest-audience.repository.ts";
import type { DigestSendRepository } from "../repositories/digest-send.repository.ts";
import type {
  DigestProjectWeekRepository,
  DigestUserWeekRepository,
} from "../repositories/digest-week.repository.ts";
import { pickTemplate } from "../rules/digest-template.rules.ts";
import { userWeekTotals, weeksBefore } from "../rules/digest-week.rules.ts";
import type { DigestSendService } from "./digest-send.service.ts";
import type { DigestWeekService } from "./digest-week.service.ts";

const METRIC_WEEKS = 8;

/** The gallery's reads and switches: who is enrolled, what they would get, what came of it. */
export class DigestCohortService {
  static create(deps: {
    projectWeeks: DigestProjectWeekRepository;
    userWeeks: DigestUserWeekRepository;
    audience: DigestAudienceRepository;
    sends: DigestSendRepository;
    weeks: DigestWeekService;
    send: DigestSendService;
    users: Pick<UserApi, "findById">;
  }): DigestCohortService {
    return new DigestCohortService(deps);
  }

  private constructor(private readonly deps: Parameters<typeof DigestCohortService.create>[0]) {}

  /** Organizations with folds this week, sorted as asked; one plan read per organization. */
  async listCohort({
    sort,
    direction,
    isoWeek,
  }: DigestCohortInput & { isoWeek: string }): Promise<DigestCohortRow[]> {
    const [projects, users, enrolled] = await Promise.all([
      this.deps.projectWeeks.listWeeks({ isoWeeks: [isoWeek] }),
      this.deps.userWeeks.listWeeks({ isoWeeks: [isoWeek] }),
      this.deps.audience.listEnrolled(),
    ]);
    const organizationIds = [
      ...new Set([...projects, ...users].map((fold) => fold.organizationId)),
    ];
    const rows = await Promise.all(
      organizationIds.map(async (organizationId): Promise<DigestCohortRow> => {
        const week = await this.deps.weeks.organizationWeek({ organizationId, isoWeek });
        const people = users
          .filter((user) => user.organizationId === organizationId)
          .map(userWeekTotals);
        return {
          organizationId,
          isoWeek,
          enrolled: enrolled.includes(organizationId),
          members: week.members,
          traces: week.projects.reduce((sum, project) => sum + project.traces, 0),
          scenarioRuns: week.projects.reduce((sum, project) => sum + project.scenarios.runs, 0),
          codingAgentSessions: people.reduce((sum, person) => sum + person.sessions, 0),
          codingAgentCostUsd: people.reduce((sum, person) => sum + person.costUsd, 0),
          planUsagePercent: week.planUsagePercent,
          template: pickTemplate(this.deps.weeks.templateInput({ week, userId: "", admin: false })),
        };
      }),
    );
    const sign = direction === "asc" ? 1 : -1;
    return rows.toSorted((left, right) => sign * compare({ left, right, sort }));
  }

  async listMembers({
    organizationId,
    isoWeek,
  }: {
    organizationId: string;
    isoWeek: string;
  }): Promise<DigestMemberRow[]> {
    const [members, week] = await Promise.all([
      this.deps.send.members({ organizationId }),
      this.deps.weeks.organizationWeek({ organizationId, isoWeek }),
    ]);
    const unsubscribed = await this.deps.audience.listUnsubscribed({
      userIds: members.map((member) => member.userId),
    });
    return Promise.all(
      members.map(async (member) => {
        const user = await this.deps.users.findById({ id: member.userId });
        return {
          userId: member.userId,
          name: user?.name ?? null,
          email: user?.email ?? null,
          admin: member.admin,
          subscribed: !unsubscribed.includes(member.userId),
          template: pickTemplate(this.deps.weeks.templateInput({ week, ...member })),
        };
      }),
    );
  }

  setEnrolled(input: { organizationId: string; enrolled: boolean; by: string }): Promise<void> {
    return this.deps.audience.setEnrolled(input);
  }

  listUpdates(): Promise<DigestUpdate[]> {
    return this.deps.audience.listUpdates();
  }

  saveUpdate(input: DigestUpdate & { by: string }): Promise<void> {
    return this.deps.audience.saveUpdate(input);
  }

  /** The switch, and how many people it would mail: members of enrolled organizations. */
  async getSettings(): Promise<DigestSettings> {
    const settings = await this.deps.audience.getSettings();
    let recipients = 0;
    for (const organizationId of await this.deps.audience.listEnrolled()) {
      recipients += (await this.deps.send.members({ organizationId })).length;
    }
    return { armed: settings.armed, recipients };
  }

  async setArmed({ armed }: { armed: boolean }): Promise<DigestSettings> {
    await this.deps.audience.setArmed({ armed });
    return this.getSettings();
  }

  /** Sends, unique clickers and unsubscribes by template and week, over the last eight weeks. */
  async listMetrics({ isoWeek }: { isoWeek: string }): Promise<DigestMetricRow[]> {
    const since = weeksBefore({ isoWeek, count: METRIC_WEEKS - 1 }).at(-1) ?? isoWeek;
    const sends = (await this.deps.sends.listSince({ isoWeek: since })).filter(
      (send) => send.sentAt !== null,
    );
    const [clicks, unsubscribes] = await Promise.all([
      this.deps.sends.listClicks({ sendIds: sends.map((send) => send.id) }),
      this.deps.audience.listUnsubscribeSends(),
    ]);
    const clicked = new Set(clicks.map((click) => click.sendId));
    const unsubscribed = new Set(unsubscribes);
    const rows = new Map<string, DigestMetricRow>();
    for (const send of sends) {
      const key = `${send.isoWeek}|${send.templateId}`;
      const row = rows.get(key) ?? emptyMetric({ isoWeek: send.isoWeek, templateId: send.templateId });
      const sent = row.sent + 1;
      const clickers = row.clickers + (clicked.has(send.id) ? 1 : 0);
      rows.set(key, {
        ...row,
        sent,
        clickers,
        clickRatePercent: (clickers / sent) * 100,
        unsubscribes: row.unsubscribes + (unsubscribed.has(send.id) ? 1 : 0),
      });
    }
    return [...rows.values()].toSorted(
      (left, right) =>
        right.isoWeek.localeCompare(left.isoWeek) || left.templateId.localeCompare(right.templateId),
    );
  }
}

function emptyMetric({
  isoWeek,
  templateId,
}: {
  isoWeek: string;
  templateId: DigestTemplateId;
}): DigestMetricRow {
  return { isoWeek, templateId, sent: 0, clickers: 0, clickRatePercent: 0, unsubscribes: 0 };
}

function compare({
  left,
  right,
  sort,
}: {
  left: DigestCohortRow;
  right: DigestCohortRow;
  sort: DigestCohortInput["sort"];
}): number {
  switch (sort) {
    case "codingAgentCost":
      return left.codingAgentCostUsd - right.codingAgentCostUsd;
    case "codingAgentSessions":
      return left.codingAgentSessions - right.codingAgentSessions;
    case "traces":
      return left.traces - right.traces;
    case "planUsage":
      return left.planUsagePercent - right.planUsagePercent;
    case "scenarioRuns":
      return left.scenarioRuns - right.scenarioRuns;
    case "members":
      return left.members - right.members;
    case "template":
      return left.template.localeCompare(right.template);
  }
}
