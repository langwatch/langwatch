// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { AuthzApi } from "@langwatch/authz-contract";
import {
  DigestMemberNotFoundError,
  DigestMemberUnsubscribedError,
  DigestNothingToSendError,
  DigestOperatorAddressMissingError,
  DigestOrganizationNotEnrolledError,
  DigestPublicBaseUrlMissingError,
} from "@langwatch/enterprise-digest-contract";
import { createLogger } from "@langwatch/observability";
import {
  MemberNotFoundError,
  type OrganizationApi,
  type OrganizationRestMemberSummary,
} from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { UserApi } from "@langwatch/user-contract";

import type { DigestMailChannel } from "../channels/digest-mail.channel.ts";
import type { DigestSendRequest } from "../eventing/digest-send.events.ts";
import type { DigestAudienceRepository } from "../repositories/digest-audience.repository.ts";
import type { DigestSendRepository } from "../repositories/digest-send.repository.ts";
import {
  buildDigestTemplateProps,
  digestMessageId,
  digestSendKey,
  digestTemplateInput,
  type DigestTemplateProps,
  type OrganizationWeek,
  pickFocusProject,
  weekVisibleTo,
} from "../rules/digest-email.rules.ts";
import {
  DIGEST_UNSUBSCRIBE_PATH,
  type DigestMailRender,
  renderDigestMail,
} from "../rules/digest-mail.rules.ts";
import {
  type DigestTemplatePick,
  eligibleDigestTemplates,
} from "../rules/digest-template.rules.ts";
import { plannableWeek, sendableWeek } from "../rules/digest-week.rules.ts";
import {
  DigestHomeOrganizationService,
  type HomeRanking,
  type Membership,
} from "./digest-home-organization.service.ts";
import type { DigestUnsubscribeService } from "./digest-unsubscribe.service.ts";
import type { DigestWeekService } from "./digest-week.service.ts";

type Member = Readonly<{ userId: string; admin: boolean }>;

const logger = createLogger("langwatch:digest");

/**
 * Asks each organization's sends. A person's home organization is decided once here, not by each
 * organization's send, so the sends cannot disagree.
 */
async function requestSends({
  rosters,
  organizationsOf,
  attempt,
  rankHome,
  requestSend,
  isoWeek,
  at,
}: {
  rosters: ReadonlyMap<string, Member[]>;
  organizationsOf: ReadonlyMap<string, string[]>;
  attempt: (organizationId: string, work: () => Promise<void>) => Promise<void>;
  rankHome: (query: {
    userId: string;
    isoWeek: string;
    candidates: readonly string[];
  }) => Promise<HomeRanking>;
  requestSend: (request: DigestSendRequest & { occurredAt: number }) => Promise<void>;
  isoWeek: string;
  at: number;
}): Promise<void> {
  const homes = new Map<string, string | null>();
  for (const [organizationId, members] of rosters) {
    await attempt(organizationId, async () => {
      for (const member of members) {
        if (!homes.has(member.userId)) {
          const candidates = organizationsOf.get(member.userId) ?? [organizationId];
          const home = await rankHome({ userId: member.userId, isoWeek, candidates });
          homes.set(member.userId, home.kind === "home" ? home.organizationId : null);
        }
        await requestSend({
          userId: member.userId,
          organizationId,
          isoWeek,
          homeOrganizationId: homes.get(member.userId) ?? null,
          occurredAt: at,
        });
      }
    });
  }
}

const MEMBER_PAGE = 500;

type Deps = Readonly<{
  audience: DigestAudienceRepository;
  sends: DigestSendRepository;
  weeks: DigestWeekService;
  /** Who an organization's members are, which are admins, and the organization's name. */
  organizations: Readonly<{
    listMembers(input: { organizationId: string; offset?: number; limit?: number }): Promise<{
      members: readonly Pick<OrganizationRestMemberSummary, "userId" | "role" | "disabledAt">[];
      totalCount: number;
    }>;
    getMember(input: {
      organizationId: string;
      userId: string;
    }): Promise<Pick<OrganizationRestMemberSummary, "role" | "disabledAt">>;
    findProvisioningSummary: OrganizationApi["findProvisioningSummary"];
  }>;
  /** A project's name, and each project's team, which is what its access is decided on. */
  projects: Pick<ProjectApi, "findSummaryById" | "listNamesByIds">;
  /** Which of the week's projects a member may view; the email shows no other. */
  access: Pick<AuthzApi, "canBatchByIds">;
  /** The address an email goes to, read when it is sent and never stored. */
  users: Pick<UserApi, "findById">;
  mail: DigestMailChannel;
  /** The digest templates' renders, injected so react-email stays at the app's composition. */
  renderer: DigestMailRender;
  unsubscribes: Pick<DigestUnsubscribeService, "token">;
  /** The deployment's public origin; absent, a send refuses by name, since no link could work. */
  publicBaseUrl: string | undefined;
  requestSend: (request: DigestSendRequest & { occurredAt: number }) => Promise<void>;
  now: () => number;
}>;

/** One email ready to hand to the mail channel. */
type Composed = Readonly<{
  template: DigestTemplateProps;
  oneClick: string;
}>;

/**
 * The weekly send. A plan asks one send per enrolled member; each send picks the member's
 * template, renders it through `@langwatch/mail` and sends it through our own mailer
 * (`NotificationApi.sendEmail`), with a one-click unsubscribe the digest's own route honours.
 */
export class DigestSendService {
  static create(deps: Deps): DigestSendService {
    return new DigestSendService(deps);
  }

  readonly #home: DigestHomeOrganizationService;

  private constructor(private readonly deps: Deps) {
    this.#home = DigestHomeOrganizationService.create({
      weeks: deps.weeks,
      membership: (input) => this.#membership(input),
      visibleWeek: (input) => this.#visibleWeek(input),
    });
  }

  /**
   * The hourly wake's plan, after the week service's sweep: for the week the slot may send, armed
   * and not yet planned, ask the sends.
   */
  async planWeek({ isoWeek, at }: { isoWeek: string; at: number }): Promise<void> {
    // Only the week the plan's own slot may send: before Monday 08:00 that is none (ADR-001).
    const plannable = plannableWeek(at);
    if (plannable.kind === "closed" || plannable.isoWeek !== isoWeek) return;
    const settings = await this.deps.audience.getSettings();
    if (!settings.armed) return;
    if (settings.lastPlannedWeek !== null && settings.lastPlannedWeek >= isoWeek) return;
    const enrolled = await this.deps.audience.findEnrolled();
    if (enrolled.length === 0) return;
    let failed = 0;
    // One organization failing (a deleted one, say) must not keep the rest from being asked.
    const attempt = async (organizationId: string, work: () => Promise<void>) => {
      try {
        await work();
      } catch (error) {
        failed += 1;
        logger.error(
          { error, organizationId, isoWeek },
          "the digest could not plan an organization",
        );
      }
    };
    const rosters = new Map<string, Member[]>();
    for (const organizationId of enrolled) {
      await attempt(organizationId, async () => {
        rosters.set(organizationId, await this.members({ organizationId }));
      });
    }
    const organizationsOf = new Map<string, string[]>();
    for (const [organizationId, members] of rosters) {
      for (const { userId } of members) {
        organizationsOf.set(userId, [...(organizationsOf.get(userId) ?? []), organizationId]);
      }
    }
    // Decided once here, not by each organization's send, so the sends cannot disagree.
    await requestSends({
      rosters,
      organizationsOf,
      attempt,
      rankHome: (query) => this.#home.rankHome(query),
      requestSend: this.deps.requestSend,
      isoWeek,
      at,
    });
    // Left unplanned so the next wake tries the failed ones again; a request is keyed by
    // organization, person and week, so the organizations that went through are not asked twice.
    if (failed === 0) await this.deps.audience.markPlanned({ isoWeek });
  }

  /**
   * One member's week, sent at most once: only the claimer sends. Role and visible projects are
   * read now, not from the plan; the email is rendered before the claim, so one that cannot be
   * rendered claims nothing and is retried.
   */
  async sendDigest({
    userId,
    organizationId,
    isoWeek,
    homeOrganizationId,
  }: DigestSendRequest): Promise<void> {
    const [settings, enrolled, unsubscribed, sent] = await Promise.all([
      this.deps.audience.getSettings(),
      this.deps.audience.findEnrolled(),
      this.deps.audience.findUnsubscribed({ userIds: [userId] }),
      this.deps.sends.isSent({ userId, isoWeek }),
    ]);
    // A skipped send is otherwise silent: the reason is the only trace of why no email went out.
    // Never the address: logs outlive the email.
    const skip = (reason: string) =>
      logger.info({ reason, userId, organizationId, isoWeek }, "the digest skipped a send");
    if (!settings.armed) return skip("digest is not armed");
    if (!enrolled.includes(organizationId)) return skip("organization is not enrolled");
    if (unsubscribed.length > 0) return skip("member opted out");
    if (sent) return skip("week already sent to this member");
    const membership = await this.#membership({ organizationId, userId });
    if (membership.kind === "gone") return skip("member left or was disabled");
    const user = await this.deps.users.findById({ id: userId });
    if (!user?.email) return skip("member has no email address");
    if (user.deactivatedAt !== null) return skip("member is deactivated");
    const choice = { organizationId, userId, isoWeek, enrolled, homeOrganizationId };
    if (!(await this.#home.isHomeOrganization(choice))) return skip("another organization is home");
    const week = await this.#visibleWeek({
      week: await this.deps.weeks.organizationWeek({ organizationId, isoWeek }),
      userId,
    });
    const composed = await this.#compose({
      week,
      member: { userId, admin: membership.admin },
      recipient: { userId, sendId: digestSendKey({ userId, isoWeek }) },
    });
    if (!composed) return skip("no template has anything to show");
    // Rendered and checked before the claim: a refusal fails this attempt and leaves the week
    // unclaimed, so the retry can still send it.
    const rendered = await renderDigestMail({
      mail: {
        ...composed.template,
        to: user.email,
        oneClickUnsubscribeUrl: composed.oneClick,
        idempotencyKey: digestMessageId({ userId, isoWeek }),
        test: false,
      },
      renderer: this.deps.renderer,
    });
    // Claimed before the mailer is called, since SMTP does not dedupe a retry: a failure past
    // the claim loses this week's email rather than risk sending it twice (ADR-001).
    const claimed = await this.deps.sends.claim({
      userId,
      organizationId,
      isoWeek,
      templateId: composed.template.templateId,
      sentAt: this.deps.now(),
    });
    if (!claimed) return skip("another attempt claimed the week");
    await this.deps.mail.send(rendered);
  }

  /**
   * A member's last week, mailed to the operator alone, its unsubscribe link naming the operator;
   * no send is recorded. It respects enrolment and opt-out like the weekly send, but not arming,
   * so a test can come first.
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
    if (!(await this.deps.audience.findEnrolled()).includes(organizationId)) {
      throw new DigestOrganizationNotEnrolledError(organizationId);
    }
    const membership = await this.#membership({ organizationId, userId });
    if (membership.kind === "gone") throw new DigestMemberNotFoundError(userId);
    const member = { userId, admin: membership.admin };
    if ((await this.deps.audience.findUnsubscribed({ userIds: [userId] })).length > 0) {
      throw new DigestMemberUnsubscribedError(userId);
    }
    const operator = await this.deps.users.findById({ id: operatorId });
    if (!operator?.email) throw new DigestOperatorAddressMissingError();
    const isoWeek = sendableWeek(this.deps.now());
    // The member's own view: the operator sees what the member would be sent.
    const week = await this.#visibleWeek({
      week: await this.deps.weeks.organizationWeek({ organizationId, isoWeek }),
      userId,
    });
    const composed = await this.#compose({
      week,
      member,
      recipient: { userId: operatorId, sendId: `test:${isoWeek}` },
    });
    if (!composed) throw new DigestNothingToSendError(userId);
    await this.deps.mail.send(
      await renderDigestMail({
        mail: {
          ...composed.template,
          to: operator.email,
          oneClickUnsubscribeUrl: composed.oneClick,
          test: true,
        },
        renderer: this.deps.renderer,
      }),
    );
  }

  /** An organization's active members, admins marked; names stay with the user module. */
  async members({ organizationId }: { organizationId: string }): Promise<Member[]> {
    const members: Member[] = [];
    let total = Number.POSITIVE_INFINITY;
    for (let offset = 0; offset < total; offset += MEMBER_PAGE) {
      const page = await this.deps.organizations.listMembers({
        organizationId,
        offset,
        limit: MEMBER_PAGE,
      });
      for (const row of page.members) {
        if (row.disabledAt !== null) continue;
        members.push({ userId: row.userId, admin: row.role === "ADMIN" });
      }
      // A short page is the last one, whatever the count said.
      total = page.members.length < MEMBER_PAGE ? offset : page.totalCount;
    }
    return members;
  }

  /** The member's standing now; a member removed since the plan answers not-found. */
  async #membership({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string;
  }): Promise<Membership> {
    try {
      const member = await this.deps.organizations.getMember({ organizationId, userId });
      if (member.disabledAt !== null) return { kind: "gone" };
      return { kind: "active", admin: member.role === "ADMIN" };
    } catch (error) {
      if (error instanceof MemberNotFoundError) return { kind: "gone" };
      throw error;
    }
  }

  /** The week as the member may see it: only the projects they hold `project:view` on. */
  async #visibleWeek({
    week,
    userId,
  }: {
    week: OrganizationWeek;
    userId: string;
  }): Promise<OrganizationWeek> {
    if (week.projects.length === 0) return week;
    const identities = await this.deps.projects.listNamesByIds({
      projectIds: week.projects.map(({ projectId }) => projectId),
    });
    const decided = await this.deps.access.canBatchByIds({
      principal: { type: "user", id: userId },
      permission: "project:view",
      organizationId: week.organizationId,
      teams: [...new Set(identities.map(({ teamId }) => teamId))].map((teamId) => ({ teamId })),
      projects: identities.map(({ id, teamId }) => ({ projectId: id, teamId })),
    });
    const visible = identities.filter(({ id }) => decided.projects.get(id) === true);
    return weekVisibleTo({ week, visibleProjectIds: new Set(visible.map(({ id }) => id)) });
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
    const unsubscribeUrl = `${baseUrl}${DIGEST_UNSUBSCRIBE_PATH}?token=${encodeURIComponent(
      this.deps.unsubscribes.token(recipient),
    )}`;
    // The first eligible template whose props build: one that cannot (a name not found) must
    // not cost the member the email a lower-ranked template could send.
    for (const pick of eligibleDigestTemplates(digestTemplateInput({ week, ...member }))) {
      const template = buildDigestTemplateProps({
        pick,
        week,
        userId: member.userId,
        names: await this.#names({ week, pick }),
        baseUrl,
        unsubscribeUrl,
        now: this.deps.now(),
      });
      if (template) return { template, oneClick: unsubscribeUrl };
    }
    return null;
  }

  /** Only the names the picked template shows are read. */
  async #names({ week, pick }: { week: OrganizationWeek; pick: DigestTemplatePick }) {
    if (pick.template === "digest-plan-pressure") {
      const organization = await this.deps.organizations.findProvisioningSummary(
        week.organizationId,
      );
      return { organizationName: organization?.name ?? null, project: null };
    }
    const focus = pickFocusProject(week);
    const showsProject =
      pick.template === "digest-scenarios-trend" || pick.template === "digest-traces-week";
    const project =
      showsProject && focus ? await this.deps.projects.findSummaryById(focus.projectId) : null;
    return { organizationName: null, project };
  }

  #baseUrl(): string {
    const base = this.deps.publicBaseUrl;
    if (!base) throw new DigestPublicBaseUrlMissingError();
    return base.replace(/\/$/, "");
  }
}
