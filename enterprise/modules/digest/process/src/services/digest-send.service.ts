// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  DigestMemberNotFoundError,
  type DigestPreview,
  type DigestTemplateId,
} from "@langwatch/enterprise-digest-contract";
import { generate } from "@langwatch/ksuid";
import type { NotificationService } from "@langwatch/notification-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { UserApi } from "@langwatch/user-contract";

import type { DigestAudienceRepository } from "../repositories/digest-audience.repository.ts";
import type { DigestSendRepository } from "../repositories/digest-send.repository.ts";
import { eligibleTemplates, pickTemplate } from "../rules/digest-template.rules.ts";
import {
  latencyPercentile,
  oldestKeptWeek,
  userWeekTotals,
  weekLabel,
} from "../rules/digest-week.rules.ts";
import type { DigestLinkService } from "./digest-link.service.ts";
import type { DigestWeekService, OrganizationWeek } from "./digest-week.service.ts";

/** Renders one template's props; `@langwatch/mail` parses them with the template's own schema. */
export type DigestRender = (input: {
  templateId: DigestTemplateId;
  props: Record<string, unknown>;
}) => Promise<{ subject: string; html: string }>;

export type DigestMember = Readonly<{ userId: string; admin: boolean }>;
export type PlannedSend = Readonly<{ week: OrganizationWeek; member: DigestMember }>;

/** Turns a link key and its target into the address the email carries. */
type Linker = (key: string, target: string) => string;

const MEMBER_PAGE = 500;
const TOP_ROWS = 3;

/** The weekly send, the gallery's preview and the operator's test, over one composition. */
export class DigestSendService {
  static create(deps: {
    weeks: DigestWeekService;
    sends: DigestSendRepository;
    audience: DigestAudienceRepository;
    links: DigestLinkService;
    projectWeeks: { deleteBefore(input: { isoWeek: string }): Promise<number> };
    userWeeks: { deleteBefore(input: { isoWeek: string }): Promise<number> };
    organizations: Pick<OrganizationApi, "listMembers" | "findProvisioningSummary">;
    projects: Pick<ProjectApi, "findSummaryById">;
    users: Pick<UserApi, "findById">;
    notifications: Pick<NotificationService, "sendEmail">;
    render: DigestRender;
    publicBaseUrl: string | undefined;
    now: () => number;
  }): DigestSendService {
    return new DigestSendService(deps);
  }

  private constructor(private readonly deps: Parameters<typeof DigestSendService.create>[0]) {}

  /** The scheduled send for one finished week: inert unless armed, once per week. */
  async sendWeek({ isoWeek }: { isoWeek: string }): Promise<void> {
    const oldest = oldestKeptWeek(this.deps.now());
    await this.deps.projectWeeks.deleteBefore({ isoWeek: oldest });
    await this.deps.userWeeks.deleteBefore({ isoWeek: oldest });
    const settings = await this.deps.audience.getSettings();
    if (!settings.armed || settings.lastPlannedWeek === isoWeek) return;
    // ponytail: one intent sends the whole week; split into per-member intents past a few thousand.
    for (const planned of await this.planWeek({ isoWeek })) await this.sendPlanned(planned);
    await this.deps.audience.markPlanned({ isoWeek });
  }

  /** Every enrolled organization's members, with the organization's week read once. */
  async planWeek({ isoWeek }: { isoWeek: string }): Promise<PlannedSend[]> {
    const planned: PlannedSend[] = [];
    for (const organizationId of await this.deps.audience.listEnrolled()) {
      const week = await this.deps.weeks.organizationWeek({ organizationId, isoWeek });
      for (const member of await this.members({ organizationId })) planned.push({ week, member });
    }
    return planned;
  }

  /** One person's email; skipped if unsubscribed, unenrolled since planning, or already sent. */
  async sendPlanned({ week, member }: PlannedSend): Promise<void> {
    const [enrolled, unsubscribed] = await Promise.all([
      this.deps.audience.listEnrolled(),
      this.deps.audience.listUnsubscribed({ userIds: [member.userId] }),
    ]);
    if (!enrolled.includes(week.organizationId) || unsubscribed.length > 0) return;
    const user = await this.deps.users.findById({ id: member.userId });
    if (!user?.email) return;
    const templateId = pickTemplate(this.deps.weeks.templateInput({ week, ...member }));

    const id = generate("dgs").toString();
    const targets: Record<string, string> = {};
    const collect: Linker = (key, target) => {
      targets[key] = target;
      return target;
    };
    if (!(await this.#props({ templateId, week, member, link: collect, sendId: id }))) return;

    const send = await this.deps.sends.claim({
      id,
      userId: member.userId,
      organizationId: week.organizationId,
      isoWeek: week.isoWeek,
      templateId,
      links: targets,
    });
    if (send.sentAt !== null) return;
    const tracked: Linker = (key) =>
      `${this.#base()}/api/digest/c/${this.deps.links.clickToken({ sendId: send.id, linkKey: key })}`;
    const props = await this.#props({
      templateId: send.templateId,
      week,
      member,
      link: tracked,
      sendId: send.id,
    });
    if (!props) return;
    const { subject, html } = await this.deps.render({ templateId: send.templateId, props });
    const unsubscribeToken = this.deps.links.unsubscribeToken({
      userId: member.userId,
      sendId: send.id,
    });
    await this.deps.notifications.sendEmail({
      to: user.email,
      subject,
      html,
      unsubscribe: { url: `${this.#base()}/api/digest/unsubscribe?token=${unsubscribeToken}` },
      idempotencyKey: `digest:${member.userId}:${week.isoWeek}`,
    });
    await this.deps.sends.markSent({ id: send.id, sentAt: this.deps.now() });
  }

  /** Every template this member is eligible for, rendered with direct links, the pick marked. */
  async preview({
    organizationId,
    userId,
    isoWeek,
  }: {
    organizationId: string;
    userId: string;
    isoWeek: string;
  }): Promise<DigestPreview> {
    const member = await this.#member({ organizationId, userId });
    const week = await this.deps.weeks.organizationWeek({ organizationId, isoWeek });
    const input = this.deps.weeks.templateInput({ week, ...member });
    const picked = pickTemplate(input);
    const templates: DigestPreview["templates"] = [];
    for (const templateId of eligibleTemplates(input)) {
      const props = await this.#props({ templateId, week, member, link: direct, sendId: "" });
      if (!props) continue;
      const rendered = await this.deps.render({ templateId, props });
      templates.push({ templateId, picked: templateId === picked, ...rendered });
    }
    return { userId, isoWeek, templates };
  }

  /** A member's email sent to the operator alone; no send row is written. */
  async sendTest({
    organizationId,
    userId,
    templateId,
    isoWeek,
    to,
  }: {
    organizationId: string;
    userId: string;
    templateId: DigestTemplateId | undefined;
    isoWeek: string;
    to: string;
  }): Promise<void> {
    const member = await this.#member({ organizationId, userId });
    const week = await this.deps.weeks.organizationWeek({ organizationId, isoWeek });
    const chosen = templateId ?? pickTemplate(this.deps.weeks.templateInput({ week, ...member }));
    const props = await this.#props({ templateId: chosen, week, member, link: direct, sendId: "" });
    if (!props) return;
    const { subject, html } = await this.deps.render({ templateId: chosen, props });
    await this.deps.notifications.sendEmail({ to, subject: `[Test] ${subject}`, html });
  }

  /** An organization's active members, admins marked; names stay with the user module. */
  async members({ organizationId }: { organizationId: string }): Promise<DigestMember[]> {
    const members: DigestMember[] = [];
    for (let offset = 0; ; offset += MEMBER_PAGE) {
      const page = await this.deps.organizations.listMembers({
        organizationId,
        offset,
        limit: MEMBER_PAGE,
      });
      for (const row of page.members) {
        if (row.disabledAt === null) members.push({ userId: row.userId, admin: row.role === "ADMIN" });
      }
      if (page.members.length < MEMBER_PAGE || offset + MEMBER_PAGE >= page.totalCount) break;
    }
    return members;
  }

  async #member({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string;
  }): Promise<DigestMember> {
    const member = (await this.members({ organizationId })).find((row) => row.userId === userId);
    if (!member) throw new DigestMemberNotFoundError(userId);
    return member;
  }

  #base(): string {
    const base = this.deps.publicBaseUrl;
    if (!base) throw new Error("digest needs the deployment's public base URL to write its links");
    return base.replace(/\/$/, "");
  }

  /** One template's props, or none when its data is missing (no card, no project). */
  async #props({
    templateId,
    week,
    member,
    link,
    sendId,
  }: {
    templateId: DigestTemplateId;
    week: OrganizationWeek;
    member: DigestMember;
    link: Linker;
    sendId: string;
  }): Promise<Record<string, unknown> | undefined> {
    const base = this.#base();
    const unsubscribeTarget = sendId
      ? `${base}/digest/unsubscribe?token=${this.deps.links.unsubscribeToken({ userId: member.userId, sendId })}`
      : `${base}/digest/unsubscribe`;
    const common = {
      weekLabel: weekLabel(week.isoWeek),
      unsubscribeUrl: link("unsubscribe", unsubscribeTarget),
      ...(week.update
        ? {
            whatsNew: {
              title: week.update.title,
              body: week.update.body,
              gradient: week.update.gradient,
              linkLabel: week.update.linkLabel,
              linkUrl: link("update", week.update.linkUrl),
            },
          }
        : {}),
    };
    switch (templateId) {
      case "digest-plan-pressure": {
        const organization = await this.deps.organizations.findProvisioningSummary(
          week.organizationId,
        );
        return {
          ...common,
          organizationName: organization?.name ?? "Your organization",
          usagePercentage: week.planUsagePercent,
          used: week.used,
          limit: week.limit,
          unit: "traces",
          resetsOn: nextMonthLabel(this.deps.now()),
          samplingUrl: link("sampling", `${base}/settings/usage`),
          redactionUrl: link("redaction", `${base}/settings`),
          upgradeUrl: link("upgrade", `${base}/settings/subscription`),
        };
      }
      case "digest-scenarios-trend": {
        const trend = week.trend;
        const project = trend && (await this.deps.projects.findSummaryById(trend.project.projectId));
        if (!trend || !project) return undefined;
        return {
          ...common,
          projectName: project.name,
          direction: trend.trend.direction,
          failureRatePercent: trend.trend.failureRatePercent,
          baselinePercent: trend.trend.baselinePercent,
          runs: trend.project.scenarios.runs,
          failed: trend.project.scenarios.failed,
          scenariosUrl: link("scenarios", `${base}/${project.slug}/simulations`),
        };
      }
      case "digest-coding-agent-week": {
        const user = week.users.get(member.userId);
        if (!user) return undefined;
        const totals = userWeekTotals(user);
        return {
          ...common,
          sessions: totals.sessions,
          tokens: totals.tokens,
          costUsd: totals.costUsd,
          activeMinutes: Math.round(totals.activeSeconds / 60),
          ...(totals.linesChanged > 0 ? { linesChanged: totals.linesChanged } : {}),
          ...(totals.commits > 0 ? { commits: totals.commits } : {}),
          ...(totals.pullRequests > 0 ? { pullRequests: totals.pullRequests } : {}),
          ...(totals.topRepository ? { topRepo: totals.topRepository } : {}),
          weekUrl: link("week", base),
        };
      }
      case "digest-traces-week": {
        const busiest = week.busiest;
        const project = busiest && (await this.deps.projects.findSummaryById(busiest.projectId));
        if (!busiest || !project) return undefined;
        const previous = week.lastWeek.find((fold) => fold.projectId === busiest.projectId);
        return {
          ...common,
          projectName: project.name,
          traces: busiest.traces,
          ...(previous && previous.traces > 0
            ? { changePercent: ((busiest.traces - previous.traces) / previous.traces) * 100 }
            : {}),
          errors: busiest.errors,
          costUsd: busiest.costUsd,
          tokens: Math.round(busiest.tokens),
          p50Milliseconds: latencyPercentile({ latency: busiest.latency, percentile: 50 }),
          p95Milliseconds: latencyPercentile({ latency: busiest.latency, percentile: 95 }),
          topModels: Object.entries(busiest.models)
            .toSorted(([, left], [, right]) => right - left)
            .slice(0, TOP_ROWS)
            .map(([name, traces]) => ({ name, traces })),
          evaluations: Object.entries(busiest.evaluators)
            .filter(([, counts]) => counts.passed + counts.failed > 0)
            .toSorted(([, left], [, right]) => right.runs - left.runs)
            .slice(0, TOP_ROWS)
            .map(([name, counts]) => ({
              name,
              passRatePercent: (counts.passed / (counts.passed + counts.failed)) * 100,
            })),
          tracesUrl: link("traces", `${base}/${project.slug}/messages`),
        };
      }
      case "digest-whats-new": {
        if (!week.update) return undefined;
        return {
          weekLabel: common.weekLabel,
          unsubscribeUrl: common.unsubscribeUrl,
          update: common.whatsNew,
          nudge: {
            text: "See what your agents did this week in LangWatch.",
            label: "Open LangWatch",
            url: link("nudge", base),
          },
        };
      }
    }
  }
}

const direct: Linker = (_key, target) => target;

/** `Nov 1`: when a monthly plan count starts again. */
function nextMonthLabel(now: number): string {
  const date = new Date(now);
  const first = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  return first.toLocaleString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
