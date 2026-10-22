import type { Actor } from "@langwatch/authorization";
import type { AuthzRecordBraidedSpansViewInput } from "@langwatch/authz-contract";
import { createLogger } from "@langwatch/observability";
import { Temporal } from "@langwatch/time";

import type { AuthzAuditTrailRepository } from "../repositories/authz-audit-trail.repository.ts";
import type { AuthzLedgerReadRepository } from "../repositories/authz-ledger-read.repository.ts";
import type { ScopeLineageRepository } from "../repositories/authz-read.repository.ts";
import {
  AuthzReadAuditWindowService,
  READ_AUDIT_WINDOW_MS,
} from "./authz-read-audit-window.service.ts";

export const BRAIDED_SPANS_VIEWED_ACTION = "braided_spans.viewed";

const logger = createLogger("langwatch:authz:braided-read-audit");

/**
 * ADR-183 §8: a read showing braided spans writes one audit row per actor, reader and owner per
 * window. The row id carries the window it falls in, so other processes write the same row.
 */
export class AuthzBraidedReadAuditService {
  static create(deps: {
    auditTrail: AuthzAuditTrailRepository;
    lineage: Pick<ScopeLineageRepository, "findProjectLineage">;
    reads: Pick<AuthzLedgerReadRepository, "findBraids">;
    window?: AuthzReadAuditWindowService;
    now?: () => number;
  }): AuthzBraidedReadAuditService {
    const now = deps.now ?? Date.now;
    return new AuthzBraidedReadAuditService({
      ...deps,
      window: deps.window ?? AuthzReadAuditWindowService.create({ now }),
      now,
    });
  }

  private constructor(
    private readonly deps: Readonly<{
      auditTrail: AuthzAuditTrailRepository;
      lineage: Pick<ScopeLineageRepository, "findProjectLineage">;
      reads: Pick<AuthzLedgerReadRepository, "findBraids">;
      window: AuthzReadAuditWindowService;
      now: () => number;
    }>,
  ) {}

  /** The audit never fails the read: a failure is logged and the read carries on. */
  async recordBraidedSpansView({
    actor,
    readerProjectId,
    ownerProjectIds,
  }: AuthzRecordBraidedSpansViewInput): Promise<void> {
    const owners = [...new Set(ownerProjectIds)].filter((id) => id !== readerProjectId);
    if (!isAudited(actor) || owners.length === 0) return;
    const who = whoOf(actor);
    try {
      const lineage = await this.deps.lineage.findProjectLineage({ projectId: readerProjectId });
      if (!lineage) return;
      const { organizationId } = lineage;
      const results = await Promise.allSettled(
        owners.map((ownerProjectId) =>
          this.deps.window.once({
            key: [who.type, who.id, readerProjectId, ownerProjectId].join("\u0000"),
            send: () => this.write({ organizationId, actor, readerProjectId, ownerProjectId }),
          }),
        ),
      );
      for (const result of results) {
        if (result.status === "rejected") throw result.reason;
      }
    } catch (error) {
      logger.warn({ error, readerProjectId }, "braided read audit failed; the read carries on");
    }
  }

  private async write({
    organizationId,
    actor,
    readerProjectId,
    ownerProjectId,
  }: {
    organizationId: string;
    actor: AuditedActor;
    readerProjectId: string;
    ownerProjectId: string;
  }): Promise<void> {
    const who = whoOf(actor);
    const braids = await this.deps.reads.findBraids({ organizationId, projectId: readerProjectId });
    const braidIds = braids
      .filter(
        (row) => row.ownerProjectId === ownerProjectId && row.readerProjectId === readerProjectId,
      )
      .map((row) => row.grantId);
    const now = this.deps.now();
    const windowIndex = Math.floor(now / READ_AUDIT_WINDOW_MS);
    await this.deps.auditTrail.insert({
      id: `authz-braided-view-${who.type}-${who.id}-${readerProjectId}-${ownerProjectId}-${windowIndex}`,
      createdAt: Temporal.Instant.fromEpochMilliseconds(now),
      userId: actor.type === "user" ? actor.id : null,
      organizationId,
      projectId: readerProjectId,
      action: BRAIDED_SPANS_VIEWED_ACTION,
      metadata: {
        actor: who,
        ...(actor.type === "user" && actor.impersonatorId
          ? { impersonatorId: actor.impersonatorId }
          : {}),
        readerProjectId,
        ownerProjectId,
        braidIds,
      },
    });
  }
}

type AuditedActor = Extract<Actor, { type: "user" | "api_key" }>;

/** A person or a key reads; platform work reading its own data is not a braided view. */
function isAudited(actor: Actor): actor is AuditedActor {
  return actor.type === "user" || actor.type === "api_key";
}

function whoOf(actor: AuditedActor): { type: AuditedActor["type"]; id: string } {
  return { type: actor.type, id: actor.id };
}
