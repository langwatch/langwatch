import type {
  GatewayBudget,
  GatewayBudgetBucketBoundary,
  GatewayDecimal,
  GatewayGuardrailResource,
  GatewayVirtualKeyRecord,
  GatewayVirtualKeyScope,
  ModelProvider,
} from "@langwatch/gateway-contract";
import { nowInstant, Temporal, type Instant } from "@langwatch/time";

import type { AppendGatewayAuditInput } from "../gateway-audit.repository.ts";

/** A group as the memory directory holds it; the organization module owns the real rows. */
export type MemoryGatewayGroup = {
  id: string;
  organizationId: string;
  name: string;
  slug?: string;
};

/** A team as gateway reads it; the team module owns the real row. */
export type MemoryGatewayTeam = { id: string; organizationId: string; name: string; slug: string };

/** A person and the organizations they are a member of; the auth module owns the real rows. */
export type MemoryGatewayUser = {
  id: string;
  name: string | null;
  email: string | null;
  organizationIds: readonly string[];
};

/** A model provider row and the scopes it is reachable from; the model-provider module owns it. */
export type MemoryGatewayModelProvider = ModelProvider & {
  scopes: readonly GatewayVirtualKeyScope[];
};

/** A routing policy row as a key's join and the dispatch order read it. */
export type MemoryGatewayRoutingPolicy = {
  id: string;
  organizationId: string;
  name: string;
  modelAliases: unknown;
  defaultModel: string | null;
  policyRules: unknown;
  modelProviderIds: unknown;
};

/** The CONNECT-only columns of a key row, which the shared key record does not carry. */
export type MemoryGatewayConnectColumns = {
  connectServices: string[];
  licenseTokenHash: string | null;
  licenseInstanceId: string | null;
  licenseExpiresAt: Instant | null;
};

/** Rows other modules own, seeded as their tables would answer gateway's reads. */
export type MemoryGatewaySeed = Readonly<{
  groups?: readonly MemoryGatewayGroup[];
  groupMemberships?: readonly { groupId: string; userId: string }[];
  modelProviders?: readonly MemoryGatewayModelProvider[];
  teams?: readonly MemoryGatewayTeam[];
  projects?: readonly { id: string; teamId: string }[];
  users?: readonly MemoryGatewayUser[];
  organizations?: readonly { id: string; name: string; slug: string }[];
  routingPolicies?: readonly MemoryGatewayRoutingPolicy[];
  evaluators?: readonly { id: string; slug: string | null }[];
}>;

type Tables = {
  budgets: Map<string, GatewayBudget>;
  bucketBoundaries: Map<string, GatewayBudgetBucketBoundary>;
  virtualKeys: Map<string, GatewayVirtualKeyRecord>;
  connectColumns: Map<string, MemoryGatewayConnectColumns>;
};

/**
 * The rows several gateway twins share, the way one Postgres connection
 * serves them: a budget a key's drawer writes is the budget every budget read
 * answers from. Rows are replaced, never mutated, so a transaction can restore.
 */
export class MemoryGatewayStore {
  static create(seed: MemoryGatewaySeed = {}): MemoryGatewayStore {
    return new MemoryGatewayStore(seed);
  }

  budgets = new Map<string, GatewayBudget>();
  /** Keyed by `budgetId` and `bucketScopeId`, the table's unique pair. */
  bucketBoundaries = new Map<string, GatewayBudgetBucketBoundary>();
  virtualKeys = new Map<string, GatewayVirtualKeyRecord>();
  connectColumns = new Map<string, MemoryGatewayConnectColumns>();
  readonly guardrails = new Map<string, GatewayGuardrailResource>();
  /** The audit trail, oldest first; the audit twin appends and a test reads it back. */
  readonly auditEntries: AppendGatewayAuditInput[] = [];
  readonly groups: readonly MemoryGatewayGroup[];
  readonly groupMemberships: readonly { groupId: string; userId: string }[];
  readonly modelProviders: readonly MemoryGatewayModelProvider[];
  readonly teams: readonly MemoryGatewayTeam[];
  readonly projects: readonly { id: string; teamId: string }[];
  readonly users: readonly MemoryGatewayUser[];
  readonly organizations: readonly { id: string; name: string; slug: string }[];
  readonly routingPolicies: readonly MemoryGatewayRoutingPolicy[];
  readonly evaluators: readonly { id: string; slug: string | null }[];
  #nextId = 0;

  private constructor(seed: MemoryGatewaySeed) {
    this.groups = seed.groups ?? [];
    this.groupMemberships = seed.groupMemberships ?? [];
    this.modelProviders = seed.modelProviders ?? [];
    this.teams = seed.teams ?? [];
    this.projects = seed.projects ?? [];
    this.users = seed.users ?? [];
    this.organizations = seed.organizations ?? [];
    this.routingPolicies = seed.routingPolicies ?? [];
    this.evaluators = seed.evaluators ?? [];
  }

  /** A fresh row id, unique within this store. */
  newId(prefix: string): string {
    this.#nextId += 1;
    return `${prefix}_${this.#nextId.toString().padStart(8, "0")}`;
  }

  /** Runs `work` over the tables; a throw restores them as they were. */
  async atomically<T>(work: () => Promise<T>): Promise<T> {
    const before: Tables = {
      budgets: new Map(this.budgets),
      bucketBoundaries: new Map(this.bucketBoundaries),
      virtualKeys: new Map(this.virtualKeys),
      connectColumns: new Map(this.connectColumns),
    };
    try {
      return await work();
    } catch (error) {
      this.budgets = before.budgets;
      this.bucketBoundaries = before.bucketBoundaries;
      this.virtualKeys = before.virtualKeys;
      this.connectColumns = before.connectColumns;
      throw error;
    }
  }
}

/**
 * What a unique index refuses with, in the shape the contract's conflict
 * translator reads, so a duplicate external id answers as it does live.
 */
export class MemoryGatewayUniqueConflictError extends Error {
  readonly code = "P2002";
  readonly meta: { target: string[] };

  constructor(target: string[]) {
    super(`Unique constraint failed on the fields: (${target.join(", ")})`);
    this.name = "MemoryGatewayUniqueConflictError";
    this.meta = { target };
  }
}

/** What an update of a row that is not there refuses with. */
export class MemoryGatewayRowNotFoundError extends Error {
  constructor(table: string, id: string) {
    super(`No ${table} ${id} to update`);
    this.name = "MemoryGatewayRowNotFoundError";
  }
}

/** A provider row with the columns its table defaults, for seeding a store. */
export function memoryGatewayModelProvider(
  input: Pick<ModelProvider, "id" | "name" | "provider" | "organizationId"> &
    Partial<MemoryGatewayModelProvider>,
): MemoryGatewayModelProvider {
  const now = nowInstant();
  return {
    routingHandle: null,
    enabled: true,
    customKeys: null,
    extraHeaders: null,
    customModels: null,
    customEmbeddingsModels: null,
    deploymentMapping: null,
    rateLimitRpm: null,
    rateLimitTpm: null,
    rateLimitRpd: null,
    rotationPolicy: "MANUAL",
    providerConfig: null,
    fallbackPriorityGlobal: null,
    langySkipPermissionsModels: null,
    healthStatus: "UNKNOWN",
    circuitOpenedAt: null,
    lastHealthCheckAt: null,
    disabledAt: null,
    createdAt: now,
    updatedAt: now,
    scopes: [{ scopeType: "ORGANIZATION", scopeId: input.organizationId }],
    ...input,
  };
}

/** The total order of a keyset: each column compared in its own direction, in turn. */
export type MemoryKeysetColumn = {
  value: string | number | Instant;
  direction: "asc" | "desc";
};

/** Whether a row's keyset comes strictly after the cursor's, as `keysetAfter` filters live. */
export function memoryKeysetAfter(
  row: readonly MemoryKeysetColumn[],
  cursor: readonly (string | number | Instant)[],
): boolean {
  for (const [index, column] of row.entries()) {
    const order = compareKeysetValues(column.value, cursor[index]!);
    if (order !== 0) return column.direction === "asc" ? order > 0 : order < 0;
  }
  return false;
}

/** Sorts rows by a keyset, the comparator a query's `orderBy` applies. */
export function memoryKeysetCompare(
  left: readonly MemoryKeysetColumn[],
  right: readonly MemoryKeysetColumn[],
): number {
  for (const [index, column] of left.entries()) {
    const order = compareKeysetValues(column.value, right[index]!.value);
    if (order !== 0) return column.direction === "asc" ? order : -order;
  }
  return 0;
}

function compareKeysetValues(left: string | number | Instant, right: string | number | Instant) {
  if (typeof left === "object" && typeof right === "object") {
    return Temporal.Instant.compare(left, right);
  }
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/**
 * A decimal money value from its string, rounded half away from zero to `places`
 * (six, as `Decimal(18, 6)` stores it) and serialised as its string, as the live decimal is.
 */
export function memoryGatewayDecimal(value: string, places = 6): GatewayDecimal {
  const text = /e/i.test(value) ? Number(value).toFixed(places + 1) : value.trim();
  const negative = text.startsWith("-");
  const [whole = "0", fraction = ""] = text.replace(/^[-+]/, "").split(".");
  const extended =
    BigInt(whole || "0") * 10n ** BigInt(places + 1) +
    BigInt(fraction.padEnd(places + 1, "0").slice(0, places + 1) || "0");
  const units = (extended + 5n) / 10n;
  const render = (digits: number): string => {
    const unit = 10n ** BigInt(places - digits);
    const rounded = (units + unit / 2n) / unit;
    const body = rounded.toString().padStart(digits + 1, "0");
    const sign = negative && rounded !== 0n ? "-" : "";
    return digits === 0
      ? `${sign}${body}`
      : `${sign}${body.slice(0, -digits)}.${body.slice(-digits)}`;
  };
  const toString = () => render(places).replace(/\.?0+$/, "") || "0";
  const decimal = {
    toString,
    toFixed: (digits = 0) => render(Math.min(Math.max(digits, 0), places)),
    toJSON: toString,
  };

  return decimal;
}
