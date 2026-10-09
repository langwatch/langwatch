/**
 * ADR-175: the tenants a sealed proof lets one resource be read from, and the windows its shared
 * grants open. Pure over the proof, so a service or a memory twin can ask it without a store
 * client; the store client turns it into the statement's only tenant predicate.
 */
import {
  AccessNotGrantedError,
  type Authorization,
  type AuthorizationGrant,
} from "./authorization-proof.ts";
import type { AuthorizationConditionType } from "./decision.ts";
import type { AuthzPermission } from "./registry.ts";
import { sha256Hex } from "./sha256.ts";

/** The permission each read needs, and the resource a shared grant's window must apply to. */
const READ_RESOURCES = {
  traces: { permission: "traces:view", condition: "trace" },
  analytics: { permission: "analytics:view", condition: "trace" },
} as const satisfies Record<
  string,
  { permission: AuthzPermission; condition: AuthorizationConditionType }
>;
export type ReadResource = keyof typeof READ_RESOURCES;

/** The occurrence time a marker may name: the table's own partition key, where windows apply. */
export const TENANT_SCOPE_TIME_COLUMNS = [
  "OccurredAt",
  "StartTime",
  "ScheduledAt",
  "Timestamp",
] as const;
export type TenantScopeTimeColumn = (typeof TENANT_SCOPE_TIME_COLUMNS)[number];

/** The markers as the store client finds them; `tenantScope` and `tenantSet` write them. */
export const TENANT_SCOPE_MARKER = /\{\{tenantScope:([A-Za-z_][A-Za-z0-9_]*)\}\}/;
export const TENANT_SET_MARKER = /\{\{tenantSet\}\}/;

/** The marker a read writes where its tenant predicate used to go; the store client fences it. */
export function tenantScope(column: TenantScopeTimeColumn): string {
  return `{{tenantScope:${column}}}`;
}

/**
 * The set-only marker: every tenant the proof names, with no window. For a subquery on a side
 * table whose own timestamp is not the trace's; the statement must still carry a windowed marker.
 */
export function tenantSet(): string {
  return "{{tenantSet}}";
}

/** One shared project and the window its grant opens. */
export type SharedWindow = { projectId: string; from: number; until: number | null };

export type TenantFence = {
  /** The own projects, read outright. Empty only on a proof narrowed to a shared project. */
  own: readonly string[];
  shared: readonly SharedWindow[];
};

/** Every tenant the fence names, own first. */
export function fenceTenants(fence: TenantFence): string[] {
  return [...fence.own, ...fence.shared.map((window) => window.projectId)];
}

/**
 * The fence a proof allows for one resource. The own grant must carry the resource's permission
 * or the read is not granted; a shared grant without it, or windowed on another resource,
 * contributes nothing. A narrowed proof fences that one project alone.
 */
export function fenceFor({
  authorization,
  reads,
}: {
  authorization: Authorization;
  reads: ReadResource;
}): TenantFence {
  const { permission, condition } = READ_RESOURCES[reads];
  const carries = (grant: AuthorizationGrant) => grant.permissions.includes(permission);
  const own = authorization.grants
    .filter((grant) => grant.kind === "own" && carries(grant))
    .flatMap((grant) => (grant.projectId === void 0 ? [] : [grant.projectId]));
  if (own.length === 0) throw new AccessNotGrantedError({ permission });
  const shared = authorization.grants
    .filter((grant) => grant.kind === "shared" && grant.condition?.type === condition)
    .filter(carries)
    .flatMap((grant) =>
      grant.projectId === void 0
        ? []
        : [
            {
              projectId: grant.projectId,
              from: grant.condition?.from ?? 0,
              until: grant.condition?.until ?? null,
            },
          ],
    );
  const narrowedTo = authorization.narrowedTo;
  if (narrowedTo === void 0) return { own, shared };
  const narrowed = {
    own: own.filter((projectId) => projectId === narrowedTo),
    shared: shared.filter((window) => window.projectId === narrowedTo),
  };
  if (narrowed.own.length === 0 && narrowed.shared.length === 0) {
    throw new AccessNotGrantedError({ permission });
  }
  return narrowed;
}

/**
 * A stable key for the fence a proof allows, for a cache or a log line. The own project stays
 * readable; the shared windows are hashed, so the key does not grow with the organisation.
 */
export function tenantScopeKey({
  authorization,
  reads,
}: {
  authorization: Authorization;
  reads: ReadResource;
}): string {
  const fence = fenceFor({ authorization, reads });
  const own = fence.own.toSorted().join(",");
  if (fence.shared.length === 0) return own;
  const windows = fence.shared
    .map((window) => `${window.projectId}@${window.from}-${window.until ?? ""}`)
    .toSorted()
    .join("|");
  return `${own}+${fence.shared.length}:${sha256Hex(windows)}`;
}

/**
 * The own project behind a proof: the one a route minted it for, where its Postgres rows live.
 * Narrowing does not move it; a proof whose own grant lacks the resource is refused.
 */
export function ownProjectIdOf({
  authorization,
  reads,
}: {
  authorization: Authorization;
  reads: ReadResource;
}): string {
  const { permission } = READ_RESOURCES[reads];
  const own = authorization.grants.find(
    (grant) =>
      grant.kind === "own" && grant.projectId !== void 0 && grant.permissions.includes(permission),
  )?.projectId;
  if (own === void 0) throw new AccessNotGrantedError({ permission });
  return own;
}

/**
 * The one project a proof reads, when it reads exactly one; undefined while it spans several.
 * For data outside ClickHouse under one project id, which a proof cannot fence.
 */
export function singleTenantOf({
  authorization,
  reads,
}: {
  authorization: Authorization;
  reads: ReadResource;
}): string | undefined {
  const tenants = fenceTenants(fenceFor({ authorization, reads }));
  return tenants.length === 1 ? tenants[0] : void 0;
}
