import { SYSTEM_ACTORS } from "@langwatch/actor";
import type { AuthzGrantsService } from "@langwatch/authz-contract";
import { DEFAULT_DOMAIN_JOIN_SETTING, type DomainJoinSetting } from "@langwatch/identity";
import { newJoinRequestCommandId } from "@langwatch/identity-server";
import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import { env } from "~/env.mjs";
import {
  OrganizationUserRole,
  type PrismaClient,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import type { JoinRequestLifecyclePort } from "~/server/event-sourcing/pipelines/join-requests/process-manager/joinRequestLifecycle.process";
import { buildMembersSettingsUrl } from "~/server/invites/invite-link";
import {
  sendDomainAutoJoinedEmail,
  sendJoinRequestApprovedEmail,
  sendJoinRequestArrivedEmail,
  sendJoinRequestExpiredEmail,
  sendJoinRequestRejectedEmail,
  sendJoinRequestReminderEmail,
} from "~/server/mailer/joinRequestEmails";
import type { EmailDeliveryPort } from "~/server/mailer/providers/types";
import { KSUID_RESOURCES } from "~/utils/constants";
import type {
  JoinMembershipPort,
  JoinRequestNotifier,
  JoinSettingPort,
} from "./join-requests.service";
import { readDomainJoin } from "./repositories/join-request.prisma.repository";
import { joinRequests } from "./runtime";

const logger = createLogger("langwatch:identity:join-request-adapters");

/**
 * How a join approval becomes a membership: the `OrganizationUser` row plus
 * the organization-scoped grant, in the SAME two-step shape an invitation
 * acceptance and the SSO auto-join already use (ADR-092 — the row is a table
 * write, the grant is a ledger command, and they cannot share a transaction).
 *
 * Two things make it safe to re-run, which is what a retried approval needs:
 * `skipDuplicates` on the row and `onDuplicate: "skip"` on the grant. So an
 * approval retried after a partial failure finishes the job rather than
 * attaching a second membership.
 *
 * The role is the literal default and there is no parameter for it. An
 * approval — by an admin or by the policy — grants MEMBER and nothing else;
 * least privilege by construction, and an admin who wants to hand over more
 * sends a formal invitation, which is the flow that owns roles and teams.
 */
export class PrismaJoinMembership implements JoinMembershipPort {
  constructor(
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
          bindingId: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
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
 * The organization's joining setting, as two plain columns.
 *
 * Not event-sourced, on purpose: it is configuration an administrator sets,
 * like every other organization setting, and the thing that needs a history
 * is the requests it produces rather than the switch itself. The change is
 * still audited — the setting write goes through the organization service's
 * own audited update path.
 */
export class PrismaJoinSettings implements JoinSettingPort {
  constructor(private readonly prisma: PrismaClient) {}

  async read({ organizationId }: { organizationId: string }): Promise<{
    domainJoin: DomainJoinSetting;
    joinDomains: string[];
  }> {
    const row = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { domainJoin: true, joinDomains: true },
    });
    return {
      domainJoin: row ? readDomainJoin(row.domainJoin) : DEFAULT_DOMAIN_JOIN_SETTING,
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

/**
 * Who is told, and how.
 *
 * Every fan-out is `Promise.allSettled`, for the reason D11's re-request mail
 * gives: one bouncing admin address must not silence the rest. A mail that
 * cannot be sent is logged and the request stands — the durable fact is the
 * request, not the notification.
 */
export class EmailJoinRequestNotifier implements JoinRequestNotifier {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly mailer: EmailDeliveryPort,
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
    const [organizationName, requesterName, admins] = await Promise.all([
      this.organizationName({ organizationId }),
      this.displayName({ userId: requesterUserId }),
      this.adminEmails({ organizationId }),
    ]);
    await this.fanOut({
      joinRequestId,
      what: "requestArrived",
      sends: admins.map((adminEmail) =>
        sendJoinRequestArrivedEmail({
          mailer: this.mailer,
          adminEmail,
          organizationName,
          requesterName,
          domain,
          membersSettingsUrl: buildMembersSettingsUrl(),
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
        sendJoinRequestReminderEmail({
          mailer: this.mailer,
          adminEmail,
          organizationName,
          requesterName,
          membersSettingsUrl: buildMembersSettingsUrl(),
        }),
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
    const [organizationName, requesterEmail] = await Promise.all([
      this.organizationName({ organizationId }),
      this.emailOf({ userId: requesterUserId }),
    ]);
    if (!requesterEmail) return;
    await this.fanOut({
      joinRequestId,
      what: "requestApproved",
      sends: [
        sendJoinRequestApprovedEmail({
          mailer: this.mailer,
          requesterEmail,
          organizationName,
          organizationUrl: env.BASE_HOST,
        }),
      ],
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
      sends: [
        sendJoinRequestRejectedEmail({ mailer: this.mailer, requesterEmail, organizationName }),
      ],
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
    const [organizationName, requesterEmail] = await Promise.all([
      this.organizationName({ organizationId }),
      this.emailOf({ userId: requesterUserId }),
    ]);
    if (!requesterEmail) return;
    await this.fanOut({
      joinRequestId,
      what: "requestExpired",
      sends: [
        sendJoinRequestExpiredEmail({ mailer: this.mailer, requesterEmail, organizationName }),
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
    const [organizationName, memberName, admins] = await Promise.all([
      this.organizationName({ organizationId }),
      this.displayName({ userId: requesterUserId }),
      this.adminEmails({ organizationId }),
    ]);
    await this.fanOut({
      joinRequestId,
      what: "joinedAutomatically",
      sends: admins.map((adminEmail) =>
        sendDomainAutoJoinedEmail({
          mailer: this.mailer,
          adminEmail,
          organizationName,
          memberName,
          domain,
          membersSettingsUrl: buildMembersSettingsUrl(),
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
}

/**
 * What the two wakes actually do (D12): send the one reminder, and dispatch
 * the guarded `expireJoin` command.
 *
 * A command rather than a projection write, and that is the point — the
 * process manager decides WHEN, the guard still decides WHETHER. It re-reads
 * the folded deadline, so a wake that fires early expires nothing.
 *
 * The service is composed per call because the ledger inside it resolves the
 * pipeline handle lazily off the App, which is what lets this be constructed
 * during composition and still append once the App exists.
 */
export class JoinRequestLifecycleDispatcher implements JoinRequestLifecyclePort {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly notifier: JoinRequestNotifier,
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

    const facts = await joinRequests().expireJoin({
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
