import { SYSTEM_ACTORS } from "@langwatch/actor";
import {
  DEFAULT_DOMAIN_JOIN_SETTING,
  type DomainJoinSetting,
  JoinRequestNotFoundError,
} from "@langwatch/identity";
import { newJoinRequestCommandId } from "@langwatch/identity-server";
import { generate } from "@langwatch/ksuid";
import { context, propagation } from "@opentelemetry/api";
import type { z } from "zod";
import { env } from "~/env.mjs";
import {
  OrganizationUserRole,
  type PrismaClient,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { AuthzGrantNotConfirmedError } from "~/server/app-layer/authz/errors";
import type { GrantsLedgerWriter } from "~/server/app-layer/authz/ledger";
import { liveGrants } from "~/server/app-layer/authz/repositories/live-rows";
import type { IntentContext } from "~/server/event-sourcing/pipeline/processManagerDefinition";
import {
  attachMembershipGrantIntentSchema,
  JOIN_REQUEST_LIFECYCLE_PROCESS_NAME,
  type joinRequestNotificationDeliverySchema,
  type joinRequestNotificationFanoutSchema,
  type joinRequestNotificationIntentSchema,
  type JoinRequestLifecyclePort as LifecyclePort,
} from "~/server/event-sourcing/pipelines/join-requests/process-manager/joinRequestLifecycle.process";
import { appendProcessManagerIntents } from "~/server/event-sourcing/process-manager/stores/prismaProcessStore";
import type { ProcessStore } from "~/server/event-sourcing/process-manager/stores/processStore.types";
import { buildMembersSettingsUrl } from "~/server/invites/invite-link";
import { computeDefaultFrom, sendEmail } from "~/server/mailer/emailSender";
import {
  renderDomainAutoJoinedEmail,
  renderJoinRequestApprovedEmail,
  renderJoinRequestArrivedEmail,
  renderJoinRequestExpiredEmail,
  renderJoinRequestRejectedEmail,
  renderJoinRequestReminderEmail,
} from "~/server/mailer/joinRequestEmails";
import { KSUID_RESOURCES } from "~/utils/constants";
import type {
  JoinMembershipPort,
  JoinOfferDismissalPort,
  JoinRequestNotifier,
  JoinSettingPort,
} from "./join-requests.service";
import { readDomainJoin } from "./repositories/join-request.prisma.repository";
import { joinRequests } from "./runtime";

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
    private readonly writer: GrantsLedgerWriter,
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
    joinRequestId,
    commandId,
    approvedByUserId,
  }: {
    userId: string;
    organizationId: string;
    joinRequestId: string;
    commandId: string;
    approvedByUserId: string | null;
  }): Promise<void> {
    const bindingId = generate(KSUID_RESOURCES.ROLE_BINDING).toString();
    const now = Date.now();
    const intentPayload = await this.prisma.$transaction(async (tx) => {
      const membership = await tx.organizationUser.createMany({
        data: [{ userId, organizationId, role: OrganizationUserRole.MEMBER }],
        skipDuplicates: true,
      });
      if (membership.count !== 1) return void 0;

      const insertedMembership = await tx.organizationUser.findUniqueOrThrow({
        where: { userId_organizationId: { userId, organizationId } },
        select: { membershipStamp: true },
      });

      const intentPayload = attachMembershipGrantIntentSchema.parse({
        joinRequestId,
        organizationId,
        userId,
        bindingId,
        commandId,
        occurredAtMs: now,
        membershipStamp: insertedMembership.membershipStamp,
        approvedByUserId,
      });

      await appendProcessManagerIntents(tx, {
        ref: {
          processName: JOIN_REQUEST_LIFECYCLE_PROCESS_NAME,
          projectId: organizationId,
          processKey: joinRequestId,
        },
        tenantId: organizationId,
        sourceEventId: commandId,
        messages: [
          {
            messageKey: `join-membership-grant:${commandId}`,
            intentType: "attachMembershipGrant",
            payload: intentPayload,
            traceCarrier: traceCarrier(),
          },
        ],
        now,
      });
      return intentPayload;
    });
    if (!intentPayload) return;

    await this.attachMembershipGrant(intentPayload);
  }

  async attachMembershipGrant(
    payload: z.infer<typeof attachMembershipGrantIntentSchema>,
  ): Promise<void> {
    const {
      organizationId,
      userId,
      bindingId,
      commandId,
      occurredAtMs,
      membershipStamp,
      approvedByUserId,
    } = payload;
    await this.writer.attachBindings({
      organizationId,
      commandId,
      bindings: [
        {
          bindingId,
          principal: { userId },
          role: TeamUserRole.MEMBER,
          customRoleId: null,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: organizationId,
          membershipStamp,
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
      occurredAtMs,
      requireProjection: true,
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
      domainJoin: row
        ? readDomainJoin(row.domainJoin)
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

/**
 * "No thanks", remembered on the account.
 *
 * A list of domains rather than one flag, because the offer is per domain: a
 * person who waves Acme away and later verifies an address at their new
 * employer should be offered that organization, not silenced by a decision
 * they made about the old one.
 *
 * On the account rather than in browser storage for the reason the passkey
 * nudge gives — "appears once" that only holds on one browser is not "appears
 * once".
 */
export class PrismaJoinOfferDismissals implements JoinOfferDismissalPort {
  constructor(private readonly prisma: PrismaClient) {}

  async dismissedDomains({ userId }: { userId: string }): Promise<string[]> {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { joinOfferDismissedDomains: true },
    });
    return row?.joinOfferDismissedDomains ?? [];
  }

  async dismiss({
    userId,
    domain,
  }: {
    userId: string;
    domain: string;
  }): Promise<void> {
    const held = await this.dismissedDomains({ userId });
    if (held.includes(domain)) return;
    // APPEND, never rewrite. Waving two organizations away at once reads the
    // same list twice, and a write of `[...held, domain]` would persist one
    // snapshot over the other — the dismissal that lost would reappear as an
    // offer on the next lookup. `push` is `array_append` in Postgres, so the
    // two writes compose instead of racing. The read above stays as a cheap
    // short-circuit, not as the value being written: the worst a lost race
    // costs now is the same domain listed twice, which reads identically.
    await this.prisma.user.update({
      where: { id: userId },
      data: { joinOfferDismissedDomains: { push: domain } },
    });
  }
}

/**
 * Who is told, and how.
 *
 * Notification content is rendered into a durable fan-out intent before any
 * delivery. Each recipient then gets its own idempotent outbox intent, so one
 * failed address can retry without changing the audience or duplicating the
 * other recipients.
 */
export class EmailJoinRequestNotifier implements JoinRequestNotifier {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly processStore: ProcessStore,
  ) {}

  async joinedAutomatically({
    organizationId,
    requesterUserId,
    domain,
    admissionId,
  }: {
    organizationId: string;
    requesterUserId: string;
    domain: string;
    admissionId?: string;
  }): Promise<void> {
    const joinRequestId =
      admissionId ?? `automatic:${organizationId}:${requesterUserId}:${domain}`;
    await this.enqueueFromService({
      kind: "joinedAutomatically",
      notificationId: `join:${joinRequestId}:joinedAutomatically`,
      joinRequestId,
      organizationId,
      requesterUserId,
      domain,
      admissionId,
    });
  }

  async prepareNotification({
    payload,
    context,
  }: {
    payload: NotificationPayload;
    context: IntentContext;
  }): Promise<void> {
    const resolvedPayload = await this.resolveNotificationPayload(payload);
    if (
      resolvedPayload.kind === "requestStillWaiting" &&
      !(await this.isPendingRequest(resolvedPayload.joinRequestId))
    ) {
      return;
    }
    const ref = {
      processName: context.processName,
      projectId: context.projectId,
      processKey: context.processKey,
    };
    const audience = await this.adminUserIds(
      resolvedPayload.kind,
      resolvedPayload.organizationId,
      resolvedPayload.requesterUserId,
    );
    const from = computeDefaultFrom();
    const organizationName = await this.organizationName(
      resolvedPayload.organizationId,
    );
    const requesterName = await this.displayName({
      userId: resolvedPayload.requesterUserId,
    });
    const rendered = await this.renderRecipients({
      payload: resolvedPayload,
      context,
      audience,
      organizationName,
      requesterName,
      from,
    });
    await this.processStore.appendIntents({
      ref,
      tenantId: context.tenantId,
      sourceEventId: context.messageKey,
      messages: [
        {
          messageKey: `${context.messageKey}:fanout`,
          intentType: "fanoutNotification",
          payload: {
            notificationId: resolvedPayload.notificationId,
            kind: resolvedPayload.kind,
            joinRequestId: resolvedPayload.joinRequestId,
            organizationId: resolvedPayload.organizationId,
            requesterUserId: resolvedPayload.requesterUserId,
            ...(resolvedPayload.admissionId
              ? { admissionId: resolvedPayload.admissionId }
              : {}),
            messages: rendered,
          },
          traceCarrier: traceCarrier(),
        },
      ],
      now: Date.now(),
    });
  }

  async fanoutNotification({
    payload,
    context,
  }: {
    payload: z.infer<typeof joinRequestNotificationFanoutSchema>;
    context: IntentContext;
  }): Promise<void> {
    const messages = payload.messages.map((message) => ({
      messageKey: `${context.messageKey}:recipient:${message.recipientUserId}`,
      intentType: "sendNotification",
      payload: {
        kind: payload.kind,
        joinRequestId: payload.joinRequestId,
        organizationId: payload.organizationId,
        requesterUserId: payload.requesterUserId,
        ...(payload.admissionId ? { admissionId: payload.admissionId } : {}),
        recipientUserId: message.recipientUserId,
        isAdmin: message.isAdmin,
        content: message.content,
      },
      traceCarrier: traceCarrier(),
      userId: message.recipientUserId,
    }));
    await this.processStore.appendIntents({
      ref: {
        processName: context.processName,
        projectId: context.projectId,
        processKey: context.processKey,
      },
      tenantId: context.tenantId,
      sourceEventId: context.messageKey,
      messages,
      now: Date.now(),
    });
  }

  async sendNotification(payload: NotificationDelivery): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.recipientUserId },
      select: { email: true, deactivatedAt: true },
    });
    if (
      !user?.email ||
      user.deactivatedAt ||
      user.email !== payload.content.to
    ) {
      return;
    }
    if (
      payload.kind === "requestStillWaiting" &&
      !(await this.isPendingRequest(payload.joinRequestId))
    ) {
      return;
    }
    if (!(await this.admissionCanNotify(payload))) return;
    if (
      payload.isAdmin &&
      !(await this.prisma.organizationUser.findFirst({
        where: {
          organizationId: payload.organizationId,
          userId: payload.recipientUserId,
          role: OrganizationUserRole.ADMIN,
          disabledAt: null,
        },
        select: { userId: true },
      }))
    ) {
      return;
    }
    await sendEmail(payload.content);
  }

  private async admissionCanNotify(
    payload: NotificationDelivery,
  ): Promise<boolean> {
    if (
      payload.kind === "requestApproved" ||
      (payload.kind === "joinedAutomatically" && !payload.admissionId)
    ) {
      return await this.membershipCanNotify(payload);
    }
    if (payload.kind !== "joinedAutomatically" || !payload.admissionId) {
      return true;
    }

    const admission = await this.prisma.organizationUser.findUnique({
      where: {
        userId_organizationId: {
          userId: payload.requesterUserId,
          organizationId: payload.organizationId,
        },
      },
      select: {
        disabledAt: true,
        pendingSsoGrantId: true,
        user: { select: { deactivatedAt: true } },
      },
    });
    const grant = await liveGrants(this.prisma).findFirst({
      where: {
        id: payload.admissionId,
        organizationId: payload.organizationId,
        principalType: "USER",
        principalId: payload.requesterUserId,
        scopeType: "ORGANIZATION",
        scopeId: payload.organizationId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { id: true },
    });
    if (
      !admission ||
      admission.disabledAt ||
      admission.user.deactivatedAt ||
      !grant
    )
      return false;
    if (admission.pendingSsoGrantId) {
      throw new AuthzGrantNotConfirmedError();
    }
    return true;
  }

  private async membershipCanNotify(
    payload: NotificationDelivery,
  ): Promise<boolean> {
    const membership = await this.prisma.organizationUser.findFirst({
      where: {
        organizationId: payload.organizationId,
        userId: payload.requesterUserId,
        disabledAt: null,
        user: { deactivatedAt: null },
      },
      select: { userId: true },
    });
    const grant = await liveGrants(this.prisma).findFirst({
      where: {
        organizationId: payload.organizationId,
        principalType: "USER",
        principalId: payload.requesterUserId,
        scopeType: "ORGANIZATION",
        scopeId: payload.organizationId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { id: true },
    });
    if (!membership || !grant) throw new AuthzGrantNotConfirmedError();
    return true;
  }

  private async isPendingRequest(joinRequestId: string): Promise<boolean> {
    const request = await this.prisma.joinRequest.findUnique({
      where: { id: joinRequestId },
      select: { state: true },
    });
    return request?.state === "PENDING";
  }

  private async resolveNotificationPayload(
    payload: NotificationPayload,
  ): Promise<ResolvedNotificationPayload> {
    if (payload.requesterUserId && payload.domain) {
      return {
        ...payload,
        requesterUserId: payload.requesterUserId,
        domain: payload.domain,
      };
    }
    const request = await this.prisma.joinRequest.findUnique({
      where: { id: payload.joinRequestId },
      select: { organizationId: true, userId: true, domain: true },
    });
    if (!request) {
      throw new JoinRequestNotFoundError(
        `join request ${payload.joinRequestId} projection is not ready`,
      );
    }
    if (request.organizationId !== payload.organizationId) {
      throw new JoinRequestNotFoundError(
        `join request ${payload.joinRequestId} is outside this organization`,
      );
    }
    return {
      ...payload,
      requesterUserId: payload.requesterUserId ?? request.userId,
      domain: payload.domain ?? request.domain,
    };
  }

  private async renderRecipients({
    payload,
    context,
    audience,
    organizationName,
    requesterName,
    from,
  }: {
    payload: ResolvedNotificationPayload;
    context: IntentContext;
    audience: string[];
    organizationName: string;
    requesterName: string;
    from: string;
  }): Promise<
    Array<{
      recipientUserId: string;
      isAdmin: boolean;
      content: NotificationContent;
    }>
  > {
    const isAdmin =
      payload.kind === "requestArrived" ||
      payload.kind === "requestStillWaiting" ||
      payload.kind === "joinedAutomatically";
    const rendered = [];
    for (const recipientUserId of audience) {
      const recipient = await this.prisma.user.findUnique({
        where: { id: recipientUserId },
        select: { email: true },
      });
      if (!recipient?.email) continue;
      const content = await this.renderNotification({
        payload,
        recipientEmail: recipient.email,
        organizationName,
        requesterName,
        from,
        idempotencyKey: `${context.processName}:${context.tenantId}:${context.messageKey}:${recipientUserId}`,
      });
      rendered.push({ recipientUserId, isAdmin, content });
    }
    return rendered;
  }

  private async renderNotification({
    payload,
    recipientEmail,
    organizationName,
    requesterName,
    from,
    idempotencyKey,
  }: {
    payload: ResolvedNotificationPayload;
    recipientEmail: string;
    organizationName: string;
    requesterName: string;
    from: string;
    idempotencyKey: string;
  }): Promise<NotificationContent> {
    const common = { from, idempotencyKey };
    switch (payload.kind) {
      case "requestArrived":
        return {
          ...(await renderJoinRequestArrivedEmail({
            adminEmail: recipientEmail,
            organizationName,
            requesterName,
            domain: payload.domain,
            membersSettingsUrl: buildMembersSettingsUrl(),
          })),
          ...common,
        };
      case "requestStillWaiting":
        return {
          ...(await renderJoinRequestReminderEmail({
            adminEmail: recipientEmail,
            organizationName,
            requesterName,
            membersSettingsUrl: buildMembersSettingsUrl(),
          })),
          ...common,
        };
      case "requestApproved":
        return {
          ...(await renderJoinRequestApprovedEmail({
            requesterEmail: recipientEmail,
            organizationName,
            organizationUrl: env.BASE_HOST,
          })),
          ...common,
        };
      case "requestRejected":
        return {
          ...(await renderJoinRequestRejectedEmail({
            requesterEmail: recipientEmail,
            organizationName,
          })),
          ...common,
        };
      case "requestExpired":
        return {
          ...(await renderJoinRequestExpiredEmail({
            requesterEmail: recipientEmail,
            organizationName,
          })),
          ...common,
        };
      case "joinedAutomatically":
        return {
          ...(await renderDomainAutoJoinedEmail({
            adminEmail: recipientEmail,
            organizationName,
            memberName: requesterName,
            domain: payload.domain,
            membersSettingsUrl: buildMembersSettingsUrl(),
          })),
          ...common,
        };
    }
  }

  private async enqueueFromService(
    payload: NotificationPayload,
  ): Promise<void> {
    const context: IntentContext = {
      attempt: 1,
      processName: JOIN_REQUEST_LIFECYCLE_PROCESS_NAME,
      projectId: payload.organizationId,
      processKey: payload.joinRequestId,
      tenantId: payload.organizationId,
      messageKey: `join-notification:${payload.notificationId}`,
    };
    await this.prepareNotification({ payload, context });
  }

  private async adminUserIds(
    kind: NotificationPayload["kind"],
    organizationId: string,
    requesterUserId: string,
  ): Promise<string[]> {
    if (
      kind === "requestApproved" ||
      kind === "requestRejected" ||
      kind === "requestExpired"
    ) {
      return [requesterUserId];
    }
    const admins = await this.prisma.organizationUser.findMany({
      where: {
        organizationId,
        role: OrganizationUserRole.ADMIN,
        disabledAt: null,
      },
      select: { userId: true },
      orderBy: { userId: "asc" },
    });
    return admins.map(({ userId }) => userId);
  }

  private async organizationName(organizationId: string): Promise<string> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    });
    return organization?.name ?? "your organization";
  }

  private async displayName({ userId }: { userId: string }): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true },
    });
    return user?.name ?? user?.email ?? "A colleague";
  }
}

type NotificationPayload = z.infer<typeof joinRequestNotificationIntentSchema>;
type ResolvedNotificationPayload = NotificationPayload & {
  requesterUserId: string;
  domain: string;
};
type NotificationContent = NotificationDelivery["content"];
type NotificationDelivery = z.infer<
  typeof joinRequestNotificationDeliverySchema
>;

function traceCarrier(): Record<string, string> {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return carrier;
}

/**
 * What the two wakes actually do (D12): send the one reminder, and dispatch
 * the guarded `expireJoin` command.
 *
 * A command rather than a projection write, and that is the point — the
 * process manager decides WHEN, the guard still decides WHETHER. It re-reads
 * the folded deadline, so a wake that fires early expires nothing.
 *
 */
export class JoinRequestLifecycleDispatcher implements LifecyclePort {
  constructor(
    private readonly notifier: EmailJoinRequestNotifier,
    private readonly membership: PrismaJoinMembership,
  ) {}

  async attachMembershipGrant(
    payload: z.infer<typeof attachMembershipGrantIntentSchema>,
  ): Promise<void> {
    await this.membership.attachMembershipGrant(payload);
  }

  async prepareNotification(args: {
    payload: NotificationPayload;
    context: IntentContext;
  }): Promise<void> {
    await this.notifier.prepareNotification(args);
  }

  async sendNotification(payload: NotificationDelivery): Promise<void> {
    await this.notifier.sendNotification(payload);
  }

  async fanoutNotification(args: {
    payload: z.infer<typeof joinRequestNotificationFanoutSchema>;
    context: IntentContext;
  }): Promise<void> {
    await this.notifier.fanoutNotification(args);
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
    await joinRequests().expireJoin({
      tenantId: organizationId,
      organizationId,
      joinRequestId,
      commandId: newJoinRequestCommandId(),
      occurredAtMs,
      actor: { type: "system", id: SYSTEM_ACTORS.joinRequests },
      scheduledFor: occurredAtMs,
    });
  }
}
