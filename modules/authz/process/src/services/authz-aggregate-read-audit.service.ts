import { isAggregateProjectKind, type Actor, type Authorization } from "@langwatch/authorization";
import type { AuthzScopeRef } from "@langwatch/authz-contract";
import type { EventingCommandSender } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";

import type { RecordAggregateReadCommandData } from "../eventing/authz-aggregate-read.events.ts";
import {
  AuthzReadAuditWindowService,
  READ_AUDIT_WINDOW_MS,
} from "./authz-read-audit-window.service.ts";

/** One user's read of an aggregate: who, in which organization, of which aggregate. */
export type AggregateRead = Readonly<{
  actorUserId: string;
  organizationId: string;
  aggregateProjectId: string;
}>;

type AggregateReadSender = Pick<EventingCommandSender<RecordAggregateReadCommandData>, "send">;

/** ADR-177 decision 9: one audit row per actor and aggregate per five minutes. */
export const AGGREGATE_READ_AUDIT_WINDOW_MS = READ_AUDIT_WINDOW_MS;

const logger = createLogger("langwatch:authz:aggregate-read-audit");

/**
 * Records `lw.authz.aggregate_read` behind a per-process window: repeat and concurrent reads of a
 * pair send once; a failed send is passed on and not remembered. Governance's write is the guard
 * across processes.
 */
export class AuthzAggregateReadAuditService {
  static create({
    windowMs = AGGREGATE_READ_AUDIT_WINDOW_MS,
    now = Date.now,
  }: { windowMs?: number; now?: () => number } = {}): AuthzAggregateReadAuditService {
    return new AuthzAggregateReadAuditService(
      AuthzReadAuditWindowService.create({ windowMs, now }),
      now,
    );
  }

  #sender: AggregateReadSender | undefined;

  private constructor(
    private readonly window: AuthzReadAuditWindowService,
    private readonly now: () => number,
  ) {}

  connect(sender: AggregateReadSender): void {
    this.#sender = sender;
  }

  /**
   * A user's read that crosses shared grants into an aggregate is audited. The audit never fails
   * the read: a failure is logged and the read carries on.
   */
  async auditRead({
    actor,
    authorization,
    projectId,
    findScope,
  }: {
    actor: Actor;
    authorization: Authorization;
    projectId: string;
    findScope: () => Promise<AuthzScopeRef | null>;
  }): Promise<void> {
    if (actor.type !== "user") return;
    if (!authorization.grants.some((grant) => grant.kind === "shared")) return;
    try {
      const scope = await findScope();
      if (scope?.type !== "project" || !isAggregateProjectKind(scope.kind)) return;
      await this.record({
        actorUserId: actor.id,
        organizationId: authorization.scope.organizationId,
        aggregateProjectId: projectId,
      });
    } catch (error) {
      logger.warn({ error, projectId }, "aggregate read audit failed; the read carries on");
    }
  }

  async record(read: AggregateRead): Promise<void> {
    const key = `${read.actorUserId}\u0000${read.aggregateProjectId}`;
    return this.window.once({ key, send: () => this.send(read) });
  }

  private async send(read: AggregateRead): Promise<void> {
    const sender = this.#sender;
    if (!sender) throw new Error("authz_aggregate_read is not registered in this process");
    await sender.send({ ...read, tenantId: read.organizationId, occurredAt: this.now() });
  }
}
