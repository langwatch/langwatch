/**
 * GatewayCacheRule CRUD service.
 *
 * Rules are org-scoped operator-authored overrides that modulate cache
 * behaviour for requests routed through the gateway. They sit between the
 * per-request header (highest precedence) and the per-VK default (lowest).
 * First-match-wins by priority descending.
 *
 * Every mutation writes:
 *   - a GatewayChangeEvent (CACHE_RULE_{CREATED,UPDATED,DELETED}) so the
 *     gateway's /changes long-poll picks up new rules ≤30 s and re-compiles
 *     the VK bundle (preserves the 700 ns hot path — Resolve() reads from
 *     the bundle array, not from Postgres per request);
 *   - a GatewayAuditLog row with before/after JSON for compliance.
 *
 * Matcher shape (validated at the service boundary; stored as JSONB so the
 * wire format can evolve without a migration):
 *
 *   {
 *     vk_id?:            string,
 *     vk_tags?:          string[],
 *     vk_prefix?:        string,
 *     principal_id?:     string,
 *     model?:            string,
 *     request_metadata?: Record<string, string>
 *   }
 *
 * Action shape:
 *
 *   { mode: "respect" | "force" | "disable", ttl?: number, salt?: string }
 *
 * `modeEnum` is redundantly captured so we can index and aggregate by mode
 * without parsing the JSON in hot queries (e.g. Prometheus rule-hit export).
 */
import type {
  GatewayCacheRule,
  GatewayCacheRuleMode,
  PrismaClient,
} from "@prisma/client";
import { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";

import { GatewayAuditLogRepository } from "./auditLog.repository";
import { serializeRowForAudit } from "./auditSerializer";
import { ChangeEventRepository } from "./changeEvent.repository";

export type CacheRuleMatchers = {
  vk_id?: string;
  vk_tags?: string[];
  vk_prefix?: string;
  principal_id?: string;
  model?: string;
  request_metadata?: Record<string, string>;
};

export type CacheRuleAction = {
  mode: "respect" | "force" | "disable";
  ttl?: number;
  salt?: string;
};

export type CreateCacheRuleInput = {
  organizationId: string;
  name: string;
  description?: string | null;
  priority?: number;
  enabled?: boolean;
  matchers: CacheRuleMatchers;
  action: CacheRuleAction;
  actorUserId: string;
};

export type UpdateCacheRuleInput = {
  id: string;
  organizationId: string;
  name?: string;
  description?: string | null;
  priority?: number;
  enabled?: boolean;
  matchers?: CacheRuleMatchers;
  action?: CacheRuleAction;
  actorUserId: string;
};

export type ArchiveCacheRuleInput = {
  id: string;
  organizationId: string;
  actorUserId: string;
};

function actionToEnum(mode: CacheRuleAction["mode"]): GatewayCacheRuleMode {
  switch (mode) {
    case "respect":
      return "RESPECT";
    case "force":
      return "FORCE";
    case "disable":
      return "DISABLE";
  }
}

function validateMatchers(matchers: CacheRuleMatchers): void {
  if (
    matchers.vk_tags !== undefined &&
    !Array.isArray(matchers.vk_tags)
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "matchers.vk_tags must be an array of strings",
    });
  }
  if (
    matchers.request_metadata !== undefined &&
    (typeof matchers.request_metadata !== "object" ||
      matchers.request_metadata === null ||
      Array.isArray(matchers.request_metadata))
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "matchers.request_metadata must be a flat key-value object",
    });
  }
}

function validateAction(action: CacheRuleAction): void {
  if (
    action.mode !== "respect" &&
    action.mode !== "force" &&
    action.mode !== "disable"
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Unknown cache-rule action mode: ${String(action.mode)}`,
    });
  }
  if (action.ttl !== undefined && (action.ttl < 0 || action.ttl > 86_400)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "action.ttl must be between 0 and 86400 seconds",
    });
  }
}

export class GatewayCacheRuleService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly changeEvents = new ChangeEventRepository(prisma),
    private readonly auditLog = new GatewayAuditLogRepository(prisma),
  ) {}

  static create(prisma: PrismaClient): GatewayCacheRuleService {
    return new GatewayCacheRuleService(prisma);
  }

  async list(organizationId: string): Promise<GatewayCacheRule[]> {
    return this.prisma.gatewayCacheRule.findMany({
      where: { organizationId, archivedAt: null },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    });
  }

  async get(
    id: string,
    organizationId: string,
  ): Promise<GatewayCacheRule | null> {
    return this.prisma.gatewayCacheRule.findFirst({
      where: { id, organizationId, archivedAt: null },
    });
  }

  async create(input: CreateCacheRuleInput): Promise<GatewayCacheRule> {
    validateMatchers(input.matchers);
    validateAction(input.action);

    return this.prisma.$transaction(async (tx) => {
      const row = await tx.gatewayCacheRule.create({
        data: {
          organizationId: input.organizationId,
          name: input.name,
          description: input.description ?? null,
          priority: input.priority ?? 100,
          enabled: input.enabled ?? true,
          matchers: input.matchers as Prisma.InputJsonValue,
          action: input.action as Prisma.InputJsonValue,
          modeEnum: actionToEnum(input.action.mode),
          createdById: input.actorUserId,
        },
      });
      await this.changeEvents.append(
        {
          organizationId: input.organizationId,
          kind: "CACHE_RULE_CREATED",
          payload: { cacheRuleId: row.id },
        },
        tx,
      );
      await this.auditLog.append(
        {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: "CACHE_RULE_CREATED",
          targetKind: "cache_rule",
          targetId: row.id,
          after: serializeRowForAudit(row),
        },
        tx,
      );
      return row;
    });
  }

  async update(input: UpdateCacheRuleInput): Promise<GatewayCacheRule> {
    const existing = await this.get(input.id, input.organizationId);
    if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
    if (input.matchers) validateMatchers(input.matchers);
    if (input.action) validateAction(input.action);
    const before = serializeRowForAudit(existing);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.gatewayCacheRule.update({
        where: { id: input.id },
        data: {
          name: input.name ?? existing.name,
          description:
            input.description === undefined
              ? existing.description
              : input.description,
          priority: input.priority ?? existing.priority,
          enabled: input.enabled ?? existing.enabled,
          matchers:
            input.matchers !== undefined
              ? (input.matchers as Prisma.InputJsonValue)
              : (existing.matchers as Prisma.InputJsonValue),
          action:
            input.action !== undefined
              ? (input.action as Prisma.InputJsonValue)
              : (existing.action as Prisma.InputJsonValue),
          modeEnum:
            input.action !== undefined
              ? actionToEnum(input.action.mode)
              : existing.modeEnum,
        },
      });
      await this.changeEvents.append(
        {
          organizationId: input.organizationId,
          kind: "CACHE_RULE_UPDATED",
          payload: { cacheRuleId: updated.id },
        },
        tx,
      );
      await this.auditLog.append(
        {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: "CACHE_RULE_UPDATED",
          targetKind: "cache_rule",
          targetId: updated.id,
          before,
          after: serializeRowForAudit(updated),
        },
        tx,
      );
      return updated;
    });
  }

  async archive(input: ArchiveCacheRuleInput): Promise<GatewayCacheRule> {
    const existing = await this.get(input.id, input.organizationId);
    if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
    const before = serializeRowForAudit(existing);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.gatewayCacheRule.update({
        where: { id: input.id },
        data: { archivedAt: new Date() },
      });
      await this.changeEvents.append(
        {
          organizationId: input.organizationId,
          kind: "CACHE_RULE_DELETED",
          payload: { cacheRuleId: updated.id },
        },
        tx,
      );
      await this.auditLog.append(
        {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: "CACHE_RULE_DELETED",
          targetKind: "cache_rule",
          targetId: updated.id,
          before,
          after: serializeRowForAudit(updated),
        },
        tx,
      );
      return updated;
    });
  }

  /**
   * Bundle projection — used by config.materialiser when the gateway calls
   * GET /internal/gateway/config/:vk_id. Returns rules pre-sorted priority
   * descending so the Go side can first-match-wins with a linear scan.
   * Disabled rules are filtered out here so the gateway doesn't need to
   * care about the enabled flag at eval time.
   */
  async bundleFor(
    organizationId: string,
  ): Promise<GatewayCacheRule[]> {
    return this.prisma.gatewayCacheRule.findMany({
      where: {
        organizationId,
        archivedAt: null,
        enabled: true,
      },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    });
  }
}
