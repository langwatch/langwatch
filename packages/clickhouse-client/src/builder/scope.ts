/**
 * The tenant scope a typed read is built from (ADR-202, "The scope is a required constructor
 * argument"). Each scope holds the one tenant list both the predicate and the row policy's
 * `SQL_langwatch_tenant_ids` setting are rendered from, so text and policy cannot disagree.
 */
import { usableAuthorization } from "@langwatch/authorization";
import { nowInstant } from "@langwatch/time";

import { fenceFor, ownProjectIdOf, type ReadResource } from "../authorized-reads.ts";
import { QueryBuilderError } from "./query-builder-error.ts";

export type TenantFence = ReturnType<typeof fenceFor>;

type ReaderTenancy = {
  readonly identity: "reader";
  /** The request's tenant, a member of `tenantIds`. */
  readonly tenantId: string;
  readonly tenantIds: readonly string[];
  /** The tenant whose routed client sends the read: a narrowed proof's own project. */
  readonly routeTenantId: string;
};

export type ProofScope = ReaderTenancy & {
  readonly kind: "proof";
  readonly fence: TenantFence;
  /** Set on a braided read only, which no held statement may outlive (as the fence does). */
  readonly expiresAt: number | undefined;
};
export type SingleTenantScope = ReaderTenancy & { readonly kind: "single" };
export type TenantSetScope = ReaderTenancy & { readonly kind: "set" };
export type AllTenantsScope = {
  readonly kind: "allTenants";
  readonly identity: "system";
  readonly reason: string;
};
/** A read of server metadata, holding no tenant rows: the reader identity, no tenant setting. */
export type ServerMetadataScope = {
  readonly kind: "serverMetadata";
  readonly identity: "reader";
  readonly reason: string;
};
export type ReaderScope = ProofScope | SingleTenantScope | TenantSetScope;
export type TenantScope = ReaderScope | AllTenantsScope | ServerMetadataScope;

/** Refuses a tenant id the comma-separated setting would split or widen. */
function checkedTenantIds(tenantIds: readonly string[]): readonly [string, ...string[]] {
  for (const tenantId of tenantIds) {
    if (tenantId.trim() === "" || tenantId.includes(",")) {
      throw new QueryBuilderError({ kind: "malformed-tenant-id", tenantId });
    }
  }
  const [first, ...rest] = tenantIds;
  if (first === undefined) throw new QueryBuilderError({ kind: "empty-tenant-set" });
  return [first, ...rest];
}

export const tenantScope = {
  /** The tenants a sealed, unexpired proof fences for one resource, as the fence reads them. */
  fromProof({
    authorization,
    reads,
    now = () => nowInstant().epochMilliseconds,
  }: {
    authorization: unknown;
    reads: ReadResource;
    now?: () => number;
  }): ProofScope {
    const proof = usableAuthorization({ authorization, now: now() });
    const fence = fenceFor({ authorization: proof, reads });
    const routeTenantId = ownProjectIdOf({ authorization: proof, reads });
    const tenantIds = checkedTenantIds([
      ...fence.own,
      ...fence.shared.map((window) => window.projectId),
    ]);
    return {
      kind: "proof",
      identity: "reader",
      fence,
      tenantId: tenantIds[0],
      tenantIds,
      routeTenantId,
      expiresAt: fence.braids === undefined ? undefined : proof.expiresAt,
    };
  },

  single({ tenantId }: { tenantId: string }): SingleTenantScope {
    const [checked] = checkedTenantIds([tenantId]);
    return {
      kind: "single",
      identity: "reader",
      tenantId: checked,
      tenantIds: [checked],
      routeTenantId: checked,
    };
  },

  set({ tenantIds }: { tenantIds: readonly string[] }): TenantSetScope {
    const checked = checkedTenantIds(tenantIds);
    return {
      kind: "set",
      identity: "reader",
      tenantId: checked[0],
      tenantIds: checked,
      routeTenantId: checked[0],
    };
  },

  /** Every tenant, on the system identity only (ADR-202, "What needs a policy-exempt identity"). */
  allTenants({ reason }: { reason: string }): AllTenantsScope {
    if (reason.trim() === "") throw new QueryBuilderError({ kind: "missing-reason" });
    return { kind: "allTenants", identity: "system", reason };
  },

  /** Server metadata only: the allow-listed system tables, or no table (ADR-202). */
  serverMetadata({ reason }: { reason: string }): ServerMetadataScope {
    if (reason.trim() === "") throw new QueryBuilderError({ kind: "missing-reason" });
    return { kind: "serverMetadata", identity: "reader", reason };
  },
} as const;
