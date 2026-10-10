import {
  gatewayCacheRuleResourceSchema,
  serializeRowForAudit,
  type ArchiveGatewayCacheRuleInput,
  type CreateGatewayCacheRuleInput,
  type GatewayCacheRuleAction,
  type GatewayCacheRuleCursor,
  type GatewayCacheRuleMatchers,
  type GatewayCacheRuleResource,
  type UpdateGatewayCacheRuleInput,
} from "@langwatch/gateway-contract";
import { nowInstant, toDate, type Instant } from "@langwatch/time";

import type { GatewayAuditRepository } from "../gateway-audit.repository.ts";
import { GatewayCacheRuleRepository } from "../gateway-cache-rule.repository.ts";
import type { GatewayChangeEventsRepository } from "../gateway-change-event.repository.ts";
import {
  memoryKeysetAfter,
  memoryKeysetCompare,
  type MemoryGatewayStore,
  type MemoryKeysetColumn,
} from "./memory.gateway.store.ts";

/** A cache-rule row as the table stores it, so its audit snapshot reads as the live one does. */
type CacheRuleRow = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  priority: number;
  enabled: boolean;
  matchers: GatewayCacheRuleMatchers;
  action: GatewayCacheRuleAction;
  modeEnum: "RESPECT" | "FORCE" | "DISABLE";
  archivedAt: Instant | null;
  createdAt: Instant;
  updatedAt: Instant;
  createdById: string;
};

/** Cache rules in memory; each write lands with its change event and its audit row. */
export class MemoryGatewayCacheRuleRepository extends GatewayCacheRuleRepository {
  static create(input: {
    store: MemoryGatewayStore;
    changes: GatewayChangeEventsRepository;
    audit: GatewayAuditRepository;
  }): MemoryGatewayCacheRuleRepository {
    return new MemoryGatewayCacheRuleRepository(input.store, input.changes, input.audit);
  }

  readonly #rows = new Map<string, CacheRuleRow>();

  private constructor(
    private readonly store: MemoryGatewayStore,
    private readonly changes: GatewayChangeEventsRepository,
    private readonly audit: GatewayAuditRepository,
  ) {
    super();
  }

  async findAll(organizationId: string): Promise<GatewayCacheRuleResource[]> {
    return this.#live(organizationId).map(toResource);
  }

  async findPage(input: {
    organizationId: string;
    limit: number;
    cursor: GatewayCacheRuleCursor | null;
  }): Promise<GatewayCacheRuleResource[]> {
    const { cursor } = input;
    return this.#live(input.organizationId)
      .filter(
        (row) =>
          cursor === null ||
          memoryKeysetAfter(pageOrder(row), [cursor.priority, cursor.createdAt, cursor.id]),
      )
      .slice(0, input.limit)
      .map(toResource);
  }

  async findById(input: {
    id: string;
    organizationId: string;
  }): Promise<GatewayCacheRuleResource | null> {
    const row = this.#existing(input);
    return row ? toResource(row) : null;
  }

  async create(input: CreateGatewayCacheRuleInput): Promise<GatewayCacheRuleResource> {
    const now = nowInstant();
    const row: CacheRuleRow = {
      id: this.store.newId("gatewaycacherule"),
      organizationId: input.organizationId,
      name: input.name,
      description: input.description ?? null,
      priority: input.priority ?? 100,
      enabled: input.enabled ?? true,
      matchers: structuredClone(input.matchers),
      action: structuredClone(input.action),
      modeEnum: modeOf(input.action),
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
      createdById: input.actorUserId,
    };
    this.#rows.set(row.id, row);
    await this.changes.append({
      organizationId: input.organizationId,
      kind: "CACHE_RULE_CREATED",
      payload: { cacheRuleId: row.id },
    });
    await this.audit.append({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "gateway.cache_rule.created",
      targetKind: "cache_rule",
      targetId: row.id,
      after: auditRowOf(row),
    });

    return toResource(row);
  }

  async update(input: UpdateGatewayCacheRuleInput): Promise<GatewayCacheRuleResource> {
    const existing = this.#existing(input);
    if (!existing) throw new Error("Cache rule must exist before update");
    const action = input.action ?? existing.action;
    const row: CacheRuleRow = {
      ...existing,
      name: input.name ?? existing.name,
      description: input.description === undefined ? existing.description : input.description,
      priority: input.priority ?? existing.priority,
      enabled: input.enabled ?? existing.enabled,
      matchers: structuredClone(input.matchers ?? existing.matchers),
      action: structuredClone(action),
      modeEnum: modeOf(action),
      updatedAt: nowInstant(),
    };
    this.#rows.set(row.id, row);
    await this.changes.append({
      organizationId: input.organizationId,
      kind: "CACHE_RULE_UPDATED",
      payload: { cacheRuleId: row.id },
    });
    await this.audit.append({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "gateway.cache_rule.updated",
      targetKind: "cache_rule",
      targetId: row.id,
      before: auditRowOf(existing),
      after: auditRowOf(row),
    });

    return toResource(row);
  }

  async archive(input: ArchiveGatewayCacheRuleInput): Promise<GatewayCacheRuleResource> {
    const existing = this.#existing(input);
    if (!existing) throw new Error("Cache rule must exist before archive");
    const now = nowInstant();
    const row: CacheRuleRow = { ...existing, archivedAt: now, updatedAt: now };
    this.#rows.set(row.id, row);
    await this.changes.append({
      organizationId: input.organizationId,
      kind: "CACHE_RULE_DELETED",
      payload: { cacheRuleId: row.id },
    });
    await this.audit.append({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "gateway.cache_rule.deleted",
      targetKind: "cache_rule",
      targetId: row.id,
      before: auditRowOf(existing),
    });

    return toResource(row);
  }

  async findEnabledForOrganization(organizationId: string): Promise<GatewayCacheRuleResource[]> {
    return this.#live(organizationId)
      .filter((row) => row.enabled)
      .map(toResource);
  }

  #existing(input: { id: string; organizationId: string }): CacheRuleRow | undefined {
    const row = this.#rows.get(input.id);
    return row?.organizationId === input.organizationId && row.archivedAt === null
      ? row
      : undefined;
  }

  /** Live rows, highest priority first, then oldest, then by id. */
  #live(organizationId: string): CacheRuleRow[] {
    return [...this.#rows.values()]
      .filter((row) => row.organizationId === organizationId && row.archivedAt === null)
      .toSorted((left, right) => memoryKeysetCompare(pageOrder(left), pageOrder(right)));
  }
}

function pageOrder(row: CacheRuleRow): MemoryKeysetColumn[] {
  return [
    { value: row.priority, direction: "desc" },
    { value: row.createdAt, direction: "asc" },
    { value: row.id, direction: "asc" },
  ];
}

function modeOf(action: GatewayCacheRuleAction): CacheRuleRow["modeEnum"] {
  switch (action.mode) {
    case "respect":
      return "RESPECT";
    case "force":
      return "FORCE";
    case "disable":
      return "DISABLE";
  }
}

function toResource(row: CacheRuleRow): GatewayCacheRuleResource {
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
    archivedAt: row.archivedAt ? toDate(row.archivedAt) : null,
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    createdById: row.createdById,
  });
}

/** A rule row as the audit trail snapshots it: instants as the stored timestamps. */
function auditRowOf(row: CacheRuleRow) {
  return serializeRowForAudit({
    ...row,
    archivedAt: row.archivedAt ? toDate(row.archivedAt) : null,
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
  });
}
