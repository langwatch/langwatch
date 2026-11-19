// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  DigestMemberNotFoundError,
  DigestNothingToSendError,
} from "@langwatch/enterprise-digest-contract";
import type {
  OrganizationApi,
  OrganizationRestMemberSummary,
} from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { UserApi } from "@langwatch/user-contract";

import type { DigestMailChannel } from "../channels/digest-mail.channel.ts";
import { type DigestSendRequest, digestSendKey } from "../eventing/digest-send.events.ts";
import type { DigestAudienceRepository } from "../repositories/digest-audience.repository.ts";
import type { DigestSendRepository } from "../repositories/digest-send.repository.ts";
import type {
  DigestProjectWeekRepository,
  DigestUserWeekRepository,
} from "../repositories/digest-week.repository.ts";
import {
  digestMessageId,
  digestTemplateInput,
  digestTemplateProps,
  type DigestTemplateProps,
  focusProjectOf,
  type OrganizationWeek,
} from "../rules/digest-email.rules.ts";
import { type DigestTemplatePick, pickDigestTemplate } from "../rules/digest-template.rules.ts";
import { oldestKeptWeek, plannableWeek, sendableWeek } from "../rules/digest-week.rules.ts";
import type { DigestUnsubscribeService } from "./digest-unsubscribe.service.ts";
import type { DigestWeekService } from "./digest-week.service.ts";

type Member = Readonly<{ userId: string; admin: boolean }>;

const MEMBER_PAGE = 500;

/** The address both the email's unsubscribe link (GET, a page) and its RFC 8058 header (POST) use. */
export const DIGEST_UNSUBSCRIBE_PATH = "/api/digest/unsubscribe";

type Deps = Readonly<{
  audience: DigestAudienceRepository;
  sends: DigestSendRepository;
  projectWeeks: Pick<DigestProjectWeekRepository, "deleteBefore">;
  userWeeks: Pick<DigestUserWeekRepository, "deleteBefore">;
  weeks: DigestWeekService;
  /** Who an organization's members are, which are admins, and the organization's name. */
  organizations: Readonly<{
    listMembers(input: { organizationId: string; offset?: number; limit?: number }): Promise<{
      members: readonly Pick<OrganizationRestMemberSummary, "userId" | "role" | "disabledAt">[];
      totalCount: number;
    }>;
    findProvisioningSummary: OrganizationApi["findProvisioningSummary"];
  }>;
  projects: Pick<ProjectApi, "findSummaryById">;
  /** The address an email goes to, read when it is sent and never stored. */
  users: Pick<UserApi, "findById">;
  mail: DigestMailChannel;
  unsubscribes: Pick<DigestUnsubscribeService, "token">;
  /** The deployment's public origin; absent, a send refuses by name, since no link could work. */
  publicBaseUrl: string | undefined;
  requestSend: (request: DigestSendRequest & { occurredAt: number }) => Promise<void>;
  now: () => number;
}>;

/** One email ready to hand to the mail channel. */
type Composed = Readonly<{ pick: DigestTemplatePick; props: DigestTemplateProps; oneClick: string }>;

/**
 * The weekly send. A plan asks one send per enrolled member; each send picks the member's
 * template, renders it through `@langwatch/mail` and sends it through our own mailer
 * (`NotificationApi.sendEmail`), with a one-click unsubscribe the digest's own route honours.
 */
export class DigestSendService {
  static create(deps: Deps): DigestSendService {
    return new DigestSendService(deps);
  }

  private constructor(private readonly deps: Deps) {}

  /**
   * The hourly wake's work: sweep old folds, then, for the week the slot may send, armed and not
   * yet planned, ask the sends.
   */
  async planWeek({ isoWeek, at }: { isoWeek: string; at: number }): Promise<void> {
    const oldest = oldestKeptWeek(at);
    await Promise.all([
      this.deps.projectWeeks.deleteBefore({ isoWeek: oldest }),
      this.deps.userWeeks.deleteBefore({ isoWeek: oldest }),
    ]);
    // Only the week the plan's own slot may send: before Monday 08:00 that is none (ADR-001).
    if (plannableWeek(at) !== isoWeek) return;
    const settings = await this.deps.audience.getSettings();
    if (!settings.armed) return;
    if (settings.lastPlannedWeek !== null && settings.lastPlannedWeek >= isoWeek) return;
    const enrolled = await this.deps.audience.listEnrolled();
    if (enrolled.length === 0) return;
    for (const organizationId of enrolled) {
      for (const member of await this.members({ organizationId })) {
        await this.deps.requestSend({ ...member, organizationId, isoWeek, occurredAt: at });
      }
    }
    await this.deps.audience.markPlanned({ isoWeek });
  }

  /**
   * One member's week, sent at most once: only the caller that claims the week sends it. Skipped
   * if disarmed, unenrolled or opted out since the plan, when the person has no address, or when
   * the picked template has nothing to show.
   */
  async sendDigest({
    userId,
    organizationId,
    isoWeek,
    admin,
  }: DigestSendRequest & { at: number }): Promise<void> {
    const [settings, enrolled, unsubscribed, sent] = await Promise.all([
      this.deps.audience.getSettings(),
      this.deps.audience.listEnrolled(),
      this.deps.audience.listUnsubscribed({ userIds: [userId] }),
      this.deps.sends.isSent({ userId, isoWeek }),
    ]);
    if (!settings.armed || !enrolled.includes(organizationId)) return;
    if (unsubscribed.length > 0 || sent) return;
    const user = await this.deps.users.findById({ id: userId });
    if (!user?.email) return;
    const week = await this.deps.weeks.organizationWeek({ organizationId, isoWeek });
    const composed = await this.#compose({
      week,
      member: { userId, admin },
      recipient: { userId, sendId: digestSendKey({ userId, isoWeek }) },
    });
    if (!composed) return;
    // Claimed before the mailer is called, since SMTP does not dedupe a retry: a failure past
    // the claim loses this week's email rather than risk sending it twice (ADR-001).
    const claimed = await this.deps.sends.claim({
      userId,
      organizationId,
      isoWeek,
      templateId: composed.pick.template,
      sentAt: this.deps.now(),
    });
    if (!claimed) return;
    await this.deps.mail.send({
      to: user.email,
      templateId: composed.pick.template,
      props: composed.props,
      oneClickUnsubscribeUrl: composed.oneClick,
      idempotencyKey: digestMessageId({ userId, isoWeek }),
      test: false,
    });
  }

  /**
   * A member's last week, mailed to the operator alone; no send is recorded. Its unsubscribe
   * link names the operator, the person it reached, never the member.
   */
  async sendTest({
    organizationId,
    userId,
    operatorId,
  }: {
    organizationId: string;
    userId: string;
    operatorId: string;
  }): Promise<void> {
    const member = (await this.members({ organizationId })).find((row) => row.userId === userId);
    if (!member) throw new DigestMemberNotFoundError(userId);
    const operator = await this.deps.users.findById({ id: operatorId });
    if (!operator?.email) throw new DigestMemberNotFoundError(operatorId);
    const isoWeek = sendableWeek(this.deps.now());
    const week = await this.deps.weeks.organizationWeek({ organizationId, isoWeek });
    const composed = await this.#compose({
      week,
      member,
      recipient: { userId: operatorId, sendId: `test:${isoWeek}` },
    });
    if (!composed) throw new DigestNothingToSendError(userId);
    await this.deps.mail.send({
      to: operator.email,
      templateId: composed.pick.template,
      props: composed.props,
      oneClickUnsubscribeUrl: composed.oneClick,
      test: true,
    });
  }

  /** An organization's active members, admins marked; names stay with the user module. */
  async members({ organizationId }: { organizationId: string }): Promise<Member[]> {
    const members: Member[] = [];
    for (let offset = 0; ; offset += MEMBER_PAGE) {
      const page = await this.deps.organizations.listMembers({
        organizationId,
        offset,
        limit: MEMBER_PAGE,
      });
      for (const row of page.members) {
        if (row.disabledAt !== null) continue;
        members.push({ userId: row.userId, admin: row.role === "ADMIN" });
      }
      if (page.members.length < MEMBER_PAGE || offset + MEMBER_PAGE >= page.totalCount) break;
    }
    return members;
  }

  /** The member's pick and its props, with an unsubscribe signed for whoever receives it. */
  async #compose({
    week,
    member,
    recipient,
  }: {
    week: OrganizationWeek;
    member: Member;
    recipient: Readonly<{ userId: string; sendId: string }>;
  }): Promise<Composed | null> {
    const baseUrl = this.#baseUrl();
    const pick = pickDigestTemplate(digestTemplateInput({ week, ...member }));
    const unsubscribeUrl = `${baseUrl}${DIGEST_UNSUBSCRIBE_PATH}?token=${encodeURIComponent(
      this.deps.unsubscribes.token(recipient),
    )}`;
    const props = digestTemplateProps({
      pick,
      week,
      userId: member.userId,
      names: await this.#names({ week, pick }),
      baseUrl,
      unsubscribeUrl,
      now: this.deps.now(),
    });
    return props ? { pick, props, oneClick: unsubscribeUrl } : null;
  }

  /** Only the names the picked template shows are read. */
  async #names({ week, pick }: { week: OrganizationWeek; pick: DigestTemplatePick }) {
    if (pick.template === "digest-plan-pressure") {
      const organization = await this.deps.organizations.findProvisioningSummary(
        week.organizationId,
      );
      return { organizationName: organization?.name ?? null, project: null };
    }
    const focus = focusProjectOf(week);
    const showsProject =
      pick.template === "digest-scenarios-trend" || pick.template === "digest-traces-week";
    const project =
      showsProject && focus ? await this.deps.projects.findSummaryById(focus.projectId) : null;
    return { organizationName: null, project };
  }

  #baseUrl(): string {
    const base = this.deps.publicBaseUrl;
    if (!base) throw new Error("digest needs the deployment's public base URL (BASE_HOST) to send");
    return base.replace(/\/$/, "");
  }
}
