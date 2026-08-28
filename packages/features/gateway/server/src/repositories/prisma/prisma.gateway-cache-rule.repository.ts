import {
  gatewayCacheRuleActionSchema,
  gatewayCacheRuleMatchersSchema,
  gatewayCacheRuleResourceSchema,
  type ArchiveGatewayCacheRuleInput,
  type CreateGatewayCacheRuleInput,
  type GatewayCacheRuleAction,
  type GatewayCacheRuleMatchers,
  type GatewayCacheRuleResource,
  type UpdateGatewayCacheRuleInput,
} from "@langwatch/gateway-contract";
import {
  Prisma,
  type GatewayCacheRule,
  type PrismaClient,
} from "@langwatch/prisma-client/generated";
import { serializeRowForAudit } from "../../adapters/gateway-audit-serializer.adapter";
import { keysetAfter } from "../../adapters/gateway-wire-pagination.adapter";
import type { GatewayAuditPort } from "../../ports/gateway-audit.port";
import type { GatewayChangeEventsPort } from "../../ports/gateway-change-events.port";
import { GatewayCacheRuleRepository } from "../gateway-cache-rule.repository";

/** Private Prisma owner for Gateway cache-rule rows and their durable effects. */
export class PrismaGatewayCacheRuleRepository extends GatewayCacheRuleRepository {
  static create(input: {
    database: PrismaClient;
    changes: GatewayChangeEventsPort;
    audit: GatewayAuditPort;
  }): PrismaGatewayCacheRuleRepository {
    return new PrismaGatewayCacheRuleRepository(input.database, input.changes, input.audit);
  }

  private constructor(
    private readonly database: PrismaClient,
    private readonly changes: GatewayChangeEventsPort,
    private readonly audit: GatewayAuditPort,
  ) {
    super();
  }

  async list(organizationId: string): Promise<GatewayCacheRuleResource[]> {
    const rows = await this.database.gatewayCacheRule.findMany({
      where: { organizationId, archivedAt: null },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    });
    return rows.map(toResource);
  }

  async listPage(input: {
    organizationId: string;
    limit: number;
    cursor: { priority: number; createdAt: Date; id: string } | null;
  }): Promise<GatewayCacheRuleResource[]> {
    const rows = await this.database.gatewayCacheRule.findMany({
      where: {
        organizationId: input.organizationId,
        archivedAt: null,
        ...(input.cursor
          ? {
              OR: keysetAfter([
                { name: "priority", value: input.cursor.priority, direction: "desc" },
                { name: "createdAt", value: input.cursor.createdAt, direction: "asc" },
                { name: "id", value: input.cursor.id, direction: "asc" },
              ]),
            }
          : {}),
      },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }, { id: "asc" }],
      take: input.limit,
    });
    return rows.map(toResource);
  }

  async tryGet(id: string, organizationId: string): Promise<GatewayCacheRuleResource | null> {
    const row = await this.database.gatewayCacheRule.findFirst({
      where: { id, organizationId, archivedAt: null },
    });
    return row ? toResource(row) : null;
  }

  async create(input: CreateGatewayCacheRuleInput): Promise<GatewayCacheRuleResource> {
    return this.database.$transaction(async (transaction) => {
      const row = await transaction.gatewayCacheRule.create({
        data: {
          organizationId: input.organizationId,
          name: input.name,
          description: input.description ?? null,
          priority: input.priority ?? 100,
          enabled: input.enabled ?? true,
          matchers: matchersJson(input.matchers),
          action: actionJson(input.action),
          modeEnum: actionToMode(input.action.mode),
          createdById: input.actorUserId,
        },
      });
      await this.changes.append(
        {
          organizationId: input.organizationId,
          kind: "CACHE_RULE_CREATED",
          payload: { cacheRuleId: row.id },
        },
        transaction,
      );
      await this.audit.append(
        {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: "gateway.cache_rule.created",
          targetKind: "cache_rule",
          targetId: row.id,
          after: serializeRowForAudit(row),
        },
        transaction,
      );
      return toResource(row);
    });
  }

  async update(input: UpdateGatewayCacheRuleInput): Promise<GatewayCacheRuleResource> {
    const existing = await this.database.gatewayCacheRule.findFirst({
      where: { id: input.id, organizationId: input.organizationId, archivedAt: null },
    });
    if (!existing) {
      throw new Error("Cache rule must exist before update");
    }
    const existingMatchers = gatewayCacheRuleMatchersSchema.parse(existing.matchers);
    const existingAction = gatewayCacheRuleActionSchema.parse(existing.action);
    return this.database.$transaction(async (transaction) => {
      const action = input.action ?? existingAction;
      const row = await transaction.gatewayCacheRule.update({
        where: { id: input.id },
        data: {
          name: input.name ?? existing.name,
          description: input.description === undefined ? existing.description : input.description,
          priority: input.priority ?? existing.priority,
          enabled: input.enabled ?? existing.enabled,
          matchers: matchersJson(input.matchers ?? existingMatchers),
          action: actionJson(action),
          modeEnum: actionToMode(action.mode),
        },
      });
      await this.changes.append(
        {
          organizationId: input.organizationId,
          kind: "CACHE_RULE_UPDATED",
          payload: { cacheRuleId: row.id },
        },
        transaction,
      );
      await this.audit.append(
        {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: "gateway.cache_rule.updated",
          targetKind: "cache_rule",
          targetId: row.id,
          before: serializeRowForAudit(existing),
          after: serializeRowForAudit(row),
        },
        transaction,
      );
      return toResource(row);
    });
  }

  async archive(input: ArchiveGatewayCacheRuleInput): Promise<GatewayCacheRuleResource> {
    const existing = await this.database.gatewayCacheRule.findFirst({
      where: { id: input.id, organizationId: input.organizationId, archivedAt: null },
    });
    if (!existing) {
      throw new Error("Cache rule must exist before archive");
    }
    return this.database.$transaction(async (transaction) => {
      const row = await transaction.gatewayCacheRule.update({
        where: { id: input.id },
        data: { archivedAt: new Date() },
      });
      await this.changes.append(
        {
          organizationId: input.organizationId,
          kind: "CACHE_RULE_DELETED",
          payload: { cacheRuleId: row.id },
        },
        transaction,
      );
      await this.audit.append(
        {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: "gateway.cache_rule.deleted",
          targetKind: "cache_rule",
          targetId: row.id,
          before: serializeRowForAudit(existing),
        },
        transaction,
      );
      return toResource(row);
    });
  }

  async listEnabledForOrganization(organizationId: string): Promise<GatewayCacheRuleResource[]> {
    const rows = await this.database.gatewayCacheRule.findMany({
      where: { organizationId, archivedAt: null, enabled: true },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    });
    return rows.map(toResource);
  }
}

function actionToMode(action: GatewayCacheRuleAction["mode"]): "RESPECT" | "FORCE" | "DISABLE" {
  switch (action) {
    case "respect":
      return "RESPECT";
    case "force":
      return "FORCE";
    case "disable":
      return "DISABLE";
  }
}

function matchersJson(matchers: GatewayCacheRuleMatchers): Prisma.InputJsonObject {
  return {
    ...(matchers.vk_id === undefined ? {} : { vk_id: matchers.vk_id }),
    ...(matchers.vk_tags === undefined ? {} : { vk_tags: matchers.vk_tags }),
    ...(matchers.vk_prefix === undefined ? {} : { vk_prefix: matchers.vk_prefix }),
    ...(matchers.principal_id === undefined ? {} : { principal_id: matchers.principal_id }),
    ...(matchers.model === undefined ? {} : { model: matchers.model }),
    ...(matchers.request_metadata === undefined
      ? {}
      : { request_metadata: { ...matchers.request_metadata } }),
  };
}

function actionJson(action: GatewayCacheRuleAction): Prisma.InputJsonObject {
  return {
    mode: action.mode,
    ...(action.ttl === undefined ? {} : { ttl: action.ttl }),
    ...(action.salt === undefined ? {} : { salt: action.salt }),
  };
}

function toResource(row: GatewayCacheRule): GatewayCacheRuleResource {
  return gatewayCacheRuleResourceSchema.parse({
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    description: row.description,
    priority: row.priority,
    enabled: row.enabled,
    matchers: row.matchers,
    action: row.action,
    mode: row.modeEnum,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdById: row.createdById,
  });
}
