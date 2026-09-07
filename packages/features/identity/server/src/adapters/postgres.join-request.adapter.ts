import { SYSTEM_ACTORS } from "@langwatch/actor";
import type { AuthzGrantsService } from "@langwatch/authz-contract";
import { DEFAULT_DOMAIN_JOIN_SETTING, type DomainJoinSetting } from "@langwatch/identity-contract";
import { newJoinRequestCommandId } from "../rules/join-request-id.rules.ts";
import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "@langwatch/authz-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { JoinRequestLifecyclePort } from "../processes/join-request-lifecycle.process.ts";
import type { JoinRequestNotificationMailPort } from "../ports/join-request-notification-mail.port.ts";
import type {
  JoinMembershipPort,
  JoinRequestNotifier,
  JoinSettingPort,
} from "../rules/join-requests-contract.rules.ts";
import { PrismaJoinCandidateRepository } from "../repositories/prisma/prisma.join-request.repository.ts";
import type { JoinRequestService } from "../services/join-request.service.ts";

const logger = createLogger("langwatch:identity:join-request-adapters");

/**
 * The KSUID resource an organization-scoped grant is born under. Spelled as a literal, the way
 * every other feature package spells its own: the prefix is a PERSISTED format, and a second
 * description of it writes bindings the revocation queries never find.
 */
const ROLE_BINDING_KSUID_RESOURCE = "rolebinding";

/**
 * How a join approval becomes a membership: the `OrganizationUser` row plus
 * the organization-scoped grant, the SAME two-step shape invitation
 * acceptance and SSO auto-join already use (ADR-092).
 */
export class PrismaJoinMembershipAdapter implements JoinMembershipPort {
  static create(prisma: PrismaClient, writer: AuthzGrantsService): PrismaJoinMembershipAdapter {
    return new PrismaJoinMembershipAdapter(prisma, writer);
  }

  private constructor(
    private readonly prisma: PrismaClient,
    private readonly writer: AuthzGrantsService,
  ) {}

  async isMember({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<boolean> {
    const held = await this.prisma.organizationUser.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      select: { userId: true },
    });
    return held !== null;
  }

  async attachDefaultMembership({
    userId,
    organizationId,
    approvedByUserId,
  }: {
    userId: string;
    organizationId: string;
    approvedByUserId: string | null;
  }): Promise<void> {
    await this.prisma.organizationUser.createMany({
      data: [{ userId, organizationId, role: OrganizationUserRole.MEMBER }],
      skipDuplicates: true,
    });

    await this.writer.attachBindings({
      organizationId,
      bindings: [
        {
          bindingId: generate(ROLE_BINDING_KSUID_RESOURCE).toString(),
          principal: { userId },
          role: TeamUserRole.MEMBER,
          customRoleId: null,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: organizationId,
        },
      ],
      // The admin who approved, or the policy that did. Both reach the
      // customer's audit page — `join-request` is deliberately NOT in
      // `NON_AUDITABLE_SOURCES`, so a surprising automatic join looks exactly
      // like a surprising approval somebody clicked.
      actor: approvedByUserId
        ? { type: "user", id: approvedByUserId }
        : { type: "system", id: SYSTEM_ACTORS.joinRequests },
      source: "join-request",
      onDuplicate: "skip",
    });
  }
}

/**
 * The organization's joining setting, as two plain columns. Not event-sourced, on purpose: it is
 * configuration an administrator sets, like every other organization setting, and the thing that
 * needs a history is the requests it produces rather than the switch itself.
 */
export class PrismaJoinSettingsAdapter implements JoinSettingPort {
  static create(prisma: PrismaClient): PrismaJoinSettingsAdapter {
    return new PrismaJoinSettingsAdapter(prisma);
  }

  private constructor(private readonly prisma: PrismaClient) {}

  async read({ organizationId }: { organizationId: string }): Promise<{
    domainJoin: DomainJoinSetting;
    joinDomains: string[];
  }> {
    const row = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { domainJoin: true, joinDomains: true },
    });
    return {
      domainJoin: row
        ? PrismaJoinCandidateRepository.readDomainJoin(row.domainJoin)
        : DEFAULT_DOMAIN_JOIN_SETTING,
      joinDomains: row?.joinDomains ?? [],
    };
  }

  async write({
    organizationId,
    domainJoin,
    joinDomains,
  }: {
    organizationId: string;
    domainJoin: DomainJoinSetting;
    joinDomains: string[];
  }): Promise<void> {
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { domainJoin, joinDomains },
    });
  }
}

/** The organization's plan, read only for the fields the seat census needs. */
export type JoinRequestNotifierPlans = {
  getActivePlan(input: {
    organizationId: string;
  }): Promise<{ maxMembers: number; planSource?: string; overrideAddingLimitations?: boolean }>;
};

/** How many full members an organization holds, for the same seat census the plan is checked against. */
export type JoinRequestNotifierMemberships = {
  getMemberCount(organizationId: string): Promise<number>;
};

/**
 * Who is told, and how. Every fan-out is `Promise.allSettled`, for the reason D11's re-request mail
 * gives: one bouncing admin address must not silence the rest. A mail that cannot be sent is logged
 * and the request stands — the durable fact is the request, not the notification.
 */
export class EmailJoinRequestNotifierAdapter implements JoinRequestNotifier {
  static create(options: {
    prisma: PrismaClient;
    mail: JoinRequestNotificationMailPort;
    /** This deployment's public origin, for a lapsed requester's personal project link. */
    baseHost: string;
    /** Read for the seat census a domain-auto-join notice carries. Absent omits it. */
    plans?: JoinRequestNotifierPlans;
    memberships?: JoinRequestNotifierMemberships;
  }): EmailJoinRequestNotifierAdapter {
    return new EmailJoinRequestNotifierAdapter(
      options.prisma,
      options.mail,
      options.baseHost,
      options.plans,
      options.memberships,
    );
  }

  private constructor(
    private readonly prisma: PrismaClient,
    private readonly mail: JoinRequestNotificationMailPort,
    private readonly baseHost: string,
    private readonly plans: JoinRequestNotifierPlans | undefined,
    private readonly memberships: JoinRequestNotifierMemberships | undefined,
  ) {}

  async requestArrived({
    joinRequestId,
    organizationId,
    requesterUserId,
    domain,
  }: {
    joinRequestId: string;
    organizationId: string;
    requesterUserId: string;
    domain: string;
  }): Promise<void> {
    const [organizationName, requesterName, admins, approvedFromDomainCount] = await Promise.all([
      this.organizationName({ organizationId }),
      this.displayName({ userId: requesterUserId }),
      this.adminEmails({ organizationId }),
      this.approvedFromDomainCount({ organizationId, domain }),
    ]);
    await this.fanOut({
      joinRequestId,
      what: "requestArrived",
      sends: admins.map((adminEmail) =>
        this.mail.sendRequestArrived({
          adminEmail,
          organizationName,
          requesterName,
          domain,
          approvedFromDomainCount,
        }),
      ),
    });
  }

  async requestStillWaiting({
    joinRequestId,
    organizationId,
  }: {
    joinRequestId: string;
    organizationId: string;
  }): Promise<void> {
    const request = await this.prisma.joinRequest.findUnique({
      where: { id: joinRequestId },
      select: { userId: true },
    });
    if (!request) return;
    const [organizationName, requesterName, admins] = await Promise.all([
      this.organizationName({ organizationId }),
      this.displayName({ userId: request.userId }),
      this.adminEmails({ organizationId }),
    ]);
    await this.fanOut({
      joinRequestId,
      what: "requestStillWaiting",
      sends: admins.map((adminEmail) =>
        this.mail.sendRequestStillWaiting({ adminEmail, organizationName, requesterName }),
      ),
    });
  }

  async requestApproved({
    joinRequestId,
    organizationId,
    requesterUserId,
  }: {
    joinRequestId: string;
    organizationId: string;
    requesterUserId: string;
  }): Promise<void> {
    const [organizationName, requesterEmail, intent] = await Promise.all([
      this.organizationName({ organizationId }),
      this.emailOf({ userId: requesterUserId }),
      this.organizationIntent({ organizationId }),
    ]);
    if (!requesterEmail) return;
    await this.fanOut({
      joinRequestId,
      what: "requestApproved",
      sends: [this.mail.sendRequestApproved({ requesterEmail, organizationName, ...intent })],
    });
  }

  async requestRejected({
    joinRequestId,
    organizationId,
    requesterUserId,
  }: {
    joinRequestId: string;
    organizationId: string;
    requesterUserId: string;
  }): Promise<void> {
    const [organizationName, requesterEmail] = await Promise.all([
      this.organizationName({ organizationId }),
      this.emailOf({ userId: requesterUserId }),
    ]);
    if (!requesterEmail) return;
    await this.fanOut({
      joinRequestId,
      what: "requestRejected",
      sends: [this.mail.sendRequestRejected({ requesterEmail, organizationName })],
    });
  }

  async requestExpired({
    joinRequestId,
    organizationId,
    requesterUserId,
  }: {
    joinRequestId: string;
    organizationId: string;
    requesterUserId: string;
  }): Promise<void> {
    const [organizationName, requesterEmail, personalProjectUrl] = await Promise.all([
      this.organizationName({ organizationId }),
      this.emailOf({ userId: requesterUserId }),
      this.tryPersonalProjectUrl({ userId: requesterUserId }),
    ]);
    if (!requesterEmail) return;
    await this.fanOut({
      joinRequestId,
      what: "requestExpired",
      sends: [
        this.mail.sendRequestExpired({
          requesterEmail,
          organizationName,
          ...(personalProjectUrl ? { personalProjectUrl } : {}),
        }),
      ],
    });
  }

  async joinedAutomatically({
    joinRequestId,
    organizationId,
    requesterUserId,
    domain,
  }: {
    joinRequestId: string;
    organizationId: string;
    requesterUserId: string;
    domain: string;
  }): Promise<void> {
    const [organizationName, memberName, admins, seats] = await Promise.all([
      this.organizationName({ organizationId }),
      this.displayName({ userId: requesterUserId }),
      this.adminEmails({ organizationId }),
      this.trySeats({ organizationId }),
    ]);
    await this.fanOut({
      joinRequestId,
      what: "joinedAutomatically",
      sends: admins.map((adminEmail) =>
        this.mail.sendJoinedAutomatically({
          adminEmail,
          organizationName,
          memberName,
          domain,
          ...(seats ? { seats } : {}),
        }),
      ),
    });
  }

  private async fanOut({
    joinRequestId,
    what,
    sends,
  }: {
    joinRequestId: string;
    what: string;
    sends: Promise<unknown>[];
  }): Promise<void> {
    const outcomes = await Promise.allSettled(sends);
    const failed = outcomes.filter((outcome) => outcome.status === "rejected");
    if (failed.length > 0) {
      // Never fatal: the request is the durable fact and it stands whether or
      // not the mail went. A deployment with no email provider configured is
      // an ordinary self-hosted install, not an error.
      logger.warn(
        { joinRequestId, what, failed: failed.length, of: sends.length },
        "some join-request notifications could not be sent",
      );
    }
  }

  private async organizationName({ organizationId }: { organizationId: string }): Promise<string> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    });
    return organization?.name ?? "your organization";
  }

  /**
   * Why the organization came, for the one message a new member reads first.
   *
   * Read off the same row the name comes from rather than through the
   * organization feature: this adapter already asks that row who it is, and a
   * second hop for one column on it would buy nothing. Null is a supported
   * answer — plenty of organizations never said.
   */
  private async organizationIntent({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<{ intent?: "AGENT_GOVERNANCE" | "LLM_OPS" }> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { primaryIntent: true },
    });

    return organization?.primaryIntent ? { intent: organization.primaryIntent } : {};
  }

  private async adminEmails({ organizationId }: { organizationId: string }): Promise<string[]> {
    const admins = await this.prisma.organizationUser.findMany({
      where: {
        organizationId,
        role: OrganizationUserRole.ADMIN,
        disabledAt: null,
      },
      select: { user: { select: { email: true } } },
    });
    return admins
      .map((admin) => admin.user.email)
      .filter((email): email is string => Boolean(email));
  }

  private async displayName({ userId }: { userId: string }): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true },
    });
    return user?.name ?? user?.email ?? "A colleague";
  }

  private async emailOf({ userId }: { userId: string }): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    return user?.email ?? null;
  }

  /**
   * How many join requests from this domain have already been approved.
   *
   * Read here directly rather than through a repository method: this adapter
   * already reads `JoinRequest` rows for `requestStillWaiting`, and a count
   * on the same table is not a new collaborator, only a new query.
   */
  private async approvedFromDomainCount({
    organizationId,
    domain,
  }: {
    organizationId: string;
    domain: string;
  }): Promise<number> {
    return this.prisma.joinRequest.count({
      where: { organizationId, domain, state: "APPROVED" },
    });
  }

  /**
   * A personal project of the requester's own, in any organization they already hold one
   * in — not necessarily the one whose request just lapsed, since a request that never
   * resolved never gave them a personal workspace THERE. `undefined` when they have none
   * yet, which is the ordinary case for somebody who has never signed in before.
   */
  private async tryPersonalProjectUrl({ userId }: { userId: string }): Promise<string | undefined> {
    const team = await this.prisma.team.findFirst({
      where: { ownerUserId: userId, isPersonal: true },
      select: { slug: true },
      orderBy: { createdAt: "asc" },
    });
    return team ? `${this.baseHost}/${team.slug}` : undefined;
  }

  /**
   * Seats held against what the plan covers, or nothing for an organization on
   * enterprise or negotiated terms — the same gate the invitation re-request
   * mail's seat census uses, since a public seat ceiling is not that
   * organization's number either.
   */
  private async trySeats({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<{ used: number; ceiling: number } | undefined> {
    if (!this.plans || !this.memberships) return undefined;
    try {
      const plan = await this.plans.getActivePlan({ organizationId });
      const accountManaged =
        plan.planSource === "license" || plan.overrideAddingLimitations === true;
      if (accountManaged || plan.maxMembers <= 0) return undefined;

      return {
        used: await this.memberships.getMemberCount(organizationId),
        ceiling: plan.maxMembers,
      };
    } catch (error) {
      logger.warn(
        { organizationId, error },
        "Could not read the seat census for a domain-auto-join notice",
      );

      return undefined;
    }
  }
}

/**
 * What the two wakes actually do (D12): send the one reminder, and dispatch the guarded
 * `expireJoin` command. A command rather than a projection write, and that is the point — the
 * process manager decides WHEN, the guard still decides WHETHER.
 */
export class JoinRequestLifecycleDispatcherAdapter implements JoinRequestLifecyclePort {
  static create(
    prisma: PrismaClient,
    notifier: JoinRequestNotifier,
    joinRequests: () => JoinRequestService,
  ): JoinRequestLifecycleDispatcherAdapter {
    return new JoinRequestLifecycleDispatcherAdapter(prisma, notifier, joinRequests);
  }

  private constructor(
    private readonly prisma: PrismaClient,
    private readonly notifier: JoinRequestNotifier,
    private readonly joinRequests: () => JoinRequestService,
  ) {}

  async remindAdmins({
    joinRequestId,
    organizationId,
  }: {
    joinRequestId: string;
    organizationId: string;
  }): Promise<void> {
    await this.notifier.requestStillWaiting({ joinRequestId, organizationId });
  }

  async expireRequest({
    joinRequestId,
    organizationId,
    occurredAtMs,
  }: {
    joinRequestId: string;
    organizationId: string;
    occurredAtMs: number;
  }): Promise<void> {
    // Read the requester BEFORE the command: the fold that follows it is the
    // only thing that changes here, and reading first keeps the "who do we
    // tell" question independent of when the projection catches up.
    const request = await this.prisma.joinRequest.findUnique({
      where: { id: joinRequestId },
      select: { userId: true, state: true },
    });

    const facts = await this.joinRequests().expireJoin({
      tenantId: organizationId,
      organizationId,
      joinRequestId,
      commandId: newJoinRequestCommandId(),
      occurredAtMs,
      actor: { type: "system", id: SYSTEM_ACTORS.joinRequests },
      scheduledFor: occurredAtMs,
    });

    // Only if something actually expired. A wake that fired early, or one for
    // a request an admin answered in the meantime, states nothing — and
    // telling somebody their request lapsed when it did not would be worse
    // than telling them nothing.
    if (facts.length === 0 || !request) return;
    await this.notifier.requestExpired({
      joinRequestId,
      organizationId,
      requesterUserId: request.userId,
    });
  }
}
