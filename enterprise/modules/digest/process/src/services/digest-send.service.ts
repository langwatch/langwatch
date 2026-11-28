// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { AuthzApi } from "@langwatch/authz-contract";
import {
  DigestMemberAddressMissingError,
  DigestMemberDeactivatedError,
  DigestMemberNotFoundError,
  DigestMemberUnsubscribedError,
  DigestNothingToSendError,
  DigestOperatorAddressMissingError,
  DigestPublicBaseUrlMissingError,
  type DigestTemplateId,
  type DigestTestDelivery,
  type DigestTestTemplate,
} from "@langwatch/enterprise-digest-contract";
import { createLogger } from "@langwatch/observability";
import {
  MemberNotFoundError,
  ORGANIZATION_ID_PAGE_LIMIT,
  type OrganizationApi,
  type OrganizationRestMemberSummary,
} from "@langwatch/organization-contract";
import { isAggregateProjectKind, type ProjectApi } from "@langwatch/project-contract";
import type { UserApi } from "@langwatch/user-contract";

import type { DigestMailChannel } from "../channels/digest-mail.channel.ts";
import type {
  DigestOrganizationPlanRequest,
  DigestSendRequest,
} from "../eventing/digest-send.events.ts";
import type { DigestAudienceRepository } from "../repositories/digest-audience.repository.ts";
import type { DigestSendRepository } from "../repositories/digest-send.repository.ts";
import {
  buildDigestWeekProps,
  digestMessageId,
  type DigestProjectName,
  digestSendKey,
  type DigestTemplateProps,
  type OrganizationWeek,
} from "../rules/digest-email.rules.ts";
import {
  DIGEST_EMAIL_PREFERENCES_PATH,
  DIGEST_UNSUBSCRIBE_PATH,
  type DigestMailRender,
  renderDigestMail,
} from "../rules/digest-mail.rules.ts";
import { plannableWeek, sendableWeek } from "../rules/digest-week.rules.ts";
import type { DigestUnsubscribeService } from "./digest-unsubscribe.service.ts";
import type { DigestWeekService } from "./digest-week.service.ts";

type Member = Readonly<{ userId: string; admin: boolean }>;

/** A member's standing when their email is sent, which may differ from the plan's. */
type Membership = Readonly<{ kind: "active"; admin: boolean }> | Readonly<{ kind: "gone" }>;

/** A plan that left some asks unmade, thrown after the walk so the outbox retries it. */
class DigestPlanIncompleteError extends Error {
  constructor(detail: { isoWeek: string; organizationId?: string; failed: number }) {
    super(`the digest plan left ${detail.failed} ask(s) unmade: ${JSON.stringify(detail)}`);
    this.name = "DigestPlanIncompleteError";
  }
}

const logger = createLogger("langwatch:digest");

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
    /** Organization ids a page at a time, the install's hidden system one left out. */
    listAllIds: OrganizationApi["listAllIds"];
  }>;
  /** Each live project's name and team, which is what its access is decided on. */
  projects: Pick<ProjectApi, "listNamesByIds" | "findLiveNonGovernanceIdsByOrganization">;
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
  requestOrganizationPlan: (
    request: DigestOrganizationPlanRequest & { occurredAt: number },
  ) => Promise<void>;
  now: () => number;
}>;

/** The member's week, and the names of the projects in it, read in the one visibility pass. */
type MemberWeek = Readonly<{
  week: OrganizationWeek;
  projects: ReadonlyMap<string, DigestProjectName>;
}>;

/** One email ready to hand to the mail channel. */
type Composed = Readonly<{
  template: DigestTemplateProps;
  oneClick: string;
  /** What the subject names, so a person's emails from different organizations differ. */
  organizationName: string | null;
}>;

/**
 * The weekly send, on for every organization. A plan asks one send per member of each
 * organization, so a person in three gets three emails, each about that organization's week and
 * naming it; each send picks the member's rows for that organization, renders them through `@langwatch/mail` and sends them through our own mailer
 * (`NotificationApi.sendEmail`), with a one-click unsubscribe the digest's own route honours.
 */
export class DigestSendService {
  static create(deps: Deps): DigestSendService {
    return new DigestSendService(deps);
  }

  private constructor(private readonly deps: Deps) {}

  /**
   * The hourly wake's plan, after the week service's sweep: for the week the slot may send, armed
   * and not yet planned, ask one plan per organization, a page of ids at a time. Each plan is its
   * own intent, so the walk here is short and one organization failing holds up no other.
   */
  async planWeek({ isoWeek, at }: { isoWeek: string; at: number }): Promise<void> {
    // Only the week the plan's own slot may send: before Monday 08:00 that is none (ADR-001).
    const plannable = plannableWeek(at);
    if (plannable.kind === "closed" || plannable.isoWeek !== isoWeek) return;
    const settings = await this.deps.audience.getSettings();
    if (!settings.armed) return;
    if (settings.lastPlannedWeek !== null && settings.lastPlannedWeek >= isoWeek) return;
    let after: string | undefined;
    let failed = 0;
    do {
      const page = await this.deps.organizations.listAllIds({
        after,
        limit: ORGANIZATION_ID_PAGE_LIMIT,
      });
      for (const organizationId of page.ids) {
        // One organization failing must not keep the rest from being asked.
        try {
          await this.deps.requestOrganizationPlan({ organizationId, isoWeek, occurredAt: at });
        } catch (error) {
          failed += 1;
          logger.error({ error, organizationId, isoWeek }, "the digest could not ask a plan");
        }
      }
      after = page.next ?? undefined;
    } while (after !== undefined);
    // Thrown once the walk is done so the intent retries; a request is keyed by organization and
    // week, so the retry asks nothing twice, and the week is marked planned only when all went.
    if (failed > 0) throw new DigestPlanIncompleteError({ isoWeek, failed });
    await this.deps.audience.markPlanned({ isoWeek });
  }

  /**
   * One organization's plan: a send asked for each member. A failure is retried by the outbox,
   * and a member already asked is not asked twice, so only this organization is walked again.
   */
  async planOrganization({
    organizationId,
    isoWeek,
  }: {
    organizationId: string;
    isoWeek: string;
  }): Promise<void> {
    const occurredAt = this.deps.now();
    let failed = 0;
    for (const { userId } of await this.members({ organizationId })) {
      // One member failing must not keep the rest from being asked; the retry skips those asked.
      try {
        await this.deps.requestSend({ userId, organizationId, isoWeek, occurredAt });
      } catch (error) {
        failed += 1;
        logger.error({ error, organizationId, userId, isoWeek }, "the digest could not ask a send");
      }
    }
    if (failed > 0) throw new DigestPlanIncompleteError({ isoWeek, organizationId, failed });
  }

  /**
   * One member's week in one organization, sent at most once: only the claimer sends. Role and visible projects are
   * read now, not from the plan; the email is rendered before the claim, so one that cannot be
   * rendered claims nothing and is retried.
   */
  async sendDigest({ userId, organizationId, isoWeek }: DigestSendRequest): Promise<void> {
    const sendKey = { userId, organizationId, isoWeek };
    const [settings, unsubscribed, sent] = await Promise.all([
      this.deps.audience.getSettings(),
      this.deps.audience.findUnsubscribed({ userIds: [userId] }),
      this.deps.sends.isSent(sendKey),
    ]);
    // A skipped send is otherwise silent: the reason is the only trace of why no email went out.
    // Never the address: logs outlive the email.
    const skip = (reason: string) =>
      logger.info({ reason, userId, organizationId, isoWeek }, "the digest skipped a send");
    if (!settings.armed) return skip("digest is not armed");
    if (unsubscribed.length > 0) return skip("member opted out");
    if (sent) return skip("week already sent to this member");
    const membership = await this.#membership({ organizationId, userId });
    if (membership.kind === "gone") return skip("member left or was disabled");
    const user = await this.deps.users.findById({ id: userId });
    if (!user?.email) return skip("member has no email address");
    if (user.deactivatedAt !== null) return skip("member is deactivated");
    const memberWeek = await this.#weekOf({ organizationId, isoWeek, userId });
    const composed = await this.#compose({
      memberWeek,
      member: { userId, admin: membership.admin },
      recipient: { userId, sendId: digestSendKey(sendKey) },
      template: "auto",
    });
    if (!composed) return skip("no row has anything to show");
    // Rendered and checked before the claim: a refusal fails this attempt and leaves the week
    // unclaimed, so the retry can still send it.
    const rendered = await renderDigestMail({
      mail: {
        ...composed.template,
        to: user.email,
        oneClickUnsubscribeUrl: composed.oneClick,
        organizationName: composed.organizationName,
        idempotencyKey: digestMessageId(sendKey),
        test: false,
      },
      renderer: this.deps.renderer,
    });
    // Claimed before the mailer is called, since SMTP does not dedupe a retry: a failure past
    // the claim loses this week's email rather than risk sending it twice (ADR-001).
    const claimed = await this.deps.sends.claim({
      ...sendKey,
      templateId: composed.template.templateId,
      sentAt: this.deps.now(),
    });
    if (!claimed) return skip("another attempt claimed the week");
    await this.deps.mail.send(rendered);
  }

  /**
   * A member's last week in one organization, mailed to the operator alone, its signed unsubscribe
   * header naming the operator; no send is recorded. It respects opt-out like the weekly send, but not
   * arming, so a test can come first. `template: "every-row"` sends every row with data, uncapped.
   * With `deliverTo: "person"` it goes to the member instead, its unsubscribe header naming them.
   */
  async sendTest({
    organizationId,
    userId,
    operatorId,
    template = "auto",
    deliverTo = "me",
  }: {
    organizationId: string;
    userId: string;
    operatorId: string;
    template?: DigestTestTemplate;
    deliverTo?: DigestTestDelivery;
  }): Promise<DigestTemplateId> {
    const membership = await this.#membership({ organizationId, userId });
    if (membership.kind === "gone") throw new DigestMemberNotFoundError(userId);
    const member = { userId, admin: membership.admin };
    if ((await this.deps.audience.findUnsubscribed({ userIds: [userId] })).length > 0) {
      throw new DigestMemberUnsubscribedError(userId);
    }
    const recipientId = deliverTo === "person" ? userId : operatorId;
    const recipient = await this.deps.users.findById({ id: recipientId });
    if (deliverTo === "person" && recipient?.deactivatedAt) {
      throw new DigestMemberDeactivatedError(userId);
    }
    if (!recipient?.email) {
      throw deliverTo === "person"
        ? new DigestMemberAddressMissingError(userId)
        : new DigestOperatorAddressMissingError();
    }
    const isoWeek = sendableWeek(this.deps.now());
    // The member's own view: the operator sees what the member would be sent.
    const memberWeek = await this.#weekOf({ organizationId, isoWeek, userId });
    const composed = await this.#compose({
      memberWeek,
      member,
      recipient: { userId: recipientId, sendId: `test:${isoWeek}` },
      template,
    });
    if (!composed) throw new DigestNothingToSendError(userId);
    await this.deps.mail.send(
      await renderDigestMail({
        mail: {
          ...composed.template,
          to: recipient.email,
          oneClickUnsubscribeUrl: composed.oneClick,
          organizationName: composed.organizationName,
          test: true,
        },
        renderer: this.deps.renderer,
      }),
    );
    return composed.template.templateId;
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

  /**
   * The member's week: only the live projects they may see are asked of, so analytics is never
   * read for one they may not. Archived and governance projects are never theirs to see here, and
   * a personal workspace is its owner's alone, whatever an admin's role could otherwise view.
   */
  async #weekOf({
    organizationId,
    isoWeek,
    userId,
  }: {
    organizationId: string;
    isoWeek: string;
    userId: string;
  }): Promise<MemberWeek> {
    const visible = await this.#visibleProjects({ organizationId, userId });
    const week = await this.deps.weeks.organizationWeek({
      organizationId,
      isoWeek,
      projectIds: visible.map(({ id }) => id),
    });
    return { week, projects: new Map(visible.map(({ id, name, slug }) => [id, { name, slug }])) };
  }

  async #visibleProjects({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string;
  }): Promise<readonly Readonly<{ id: string; name: string; slug: string }>[]> {
    const liveIds = await this.deps.projects.findLiveNonGovernanceIdsByOrganization({
      organizationId,
    });
    if (liveIds.length === 0) return [];
    const identities = (await this.deps.projects.listNamesByIds({ projectIds: liveIds })).filter(
      ({ isPersonal, ownerUserId, kind }) =>
        // An aggregate reads its members' traces, which analytics refuses without a caller's proof.
        !isAggregateProjectKind(kind) && (!isPersonal || ownerUserId === userId),
    );
    if (identities.length === 0) return [];
    const decided = await this.deps.access.canBatchByIds({
      principal: { type: "user", id: userId },
      permission: "project:view",
      organizationId,
      teams: [...new Set(identities.map(({ teamId }) => teamId))].map((teamId) => ({ teamId })),
      projects: identities.map(({ id, teamId }) => ({ projectId: id, teamId })),
    });
    return identities.filter(({ id }) => decided.projects.get(id) === true);
  }

  /** The member's rows (or every row, for a staff test) as props; the unsubscribe is the recipient's. */
  async #compose({
    memberWeek: { week, projects },
    member,
    recipient,
    template,
  }: {
    memberWeek: MemberWeek;
    member: Member;
    recipient: Readonly<{ userId: string; sendId: string }>;
    template: DigestTestTemplate;
  }): Promise<Composed | null> {
    const baseUrl = this.#baseUrl();
    const organizationName =
      (await this.deps.organizations.findProvisioningSummary(week.organizationId))?.name ?? null;
    const props = buildDigestWeekProps({
      week,
      userId: member.userId,
      admin: member.admin,
      mode: template,
      organizationName,
      projects,
      baseUrl,
      preferencesUrl: `${baseUrl}${DIGEST_EMAIL_PREFERENCES_PATH}`,
      now: this.deps.now(),
    });
    if (!props) return null;
    // The footer opens the person's email preferences; the signed link is only the one-click header.
    const oneClick = `${baseUrl}${DIGEST_UNSUBSCRIBE_PATH}?token=${encodeURIComponent(
      this.deps.unsubscribes.token(recipient),
    )}`;
    return { template: { templateId: "digest-week", props }, oneClick, organizationName };
  }

  #baseUrl(): string {
    const base = this.deps.publicBaseUrl;
    if (!base) throw new DigestPublicBaseUrlMissingError();
    return base.replace(/\/$/, "");
  }
}
