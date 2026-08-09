/**
 * Shared DTO shape for VirtualKey. Consumed by both the tRPC router
 * (camelCase for the UI) and the public Hono REST API (snake_case for
 * SDK / CLI clients).
 *
 * Post-collapse: the legacy `providerCredentialIds` + `providerChain`
 * fields are gone from the wire. The VK's eligible-provider set is
 * derived from the scope graph + optional RoutingPolicy at request time
 * (see `scopeResolver.ts`); the DTO exposes the scope set + the
 * `routingPolicyId` so callers can render the binding-equivalent view.
 *
 * The token format is `vk-lw-<ulid>` with no live/test discriminator;
 * the gateway never branches on environment, so there is no env field.
 */
import type { Prisma, PrismaClient } from "@prisma/client";

import { metadataFromRow, type ResourceMetadata } from "./resourceMetadata";
import { traceProjectsByIds } from "./scopeResolver";
import type { VirtualKeyWithScopes } from "./virtualKey.repository";
import { toWireEnum } from "./wireEnums";

/**
 * The one fact about a key's trace destination that is not on the key row.
 *
 * A key follows its stored pointer even after the project behind it is
 * deleted: the spans keep landing there, intact, and reappear if the customer
 * restores it. That is the right thing to do and the one thing a reader
 * cannot work out from the row, since the destination still resolves and the
 * traffic still flows. So it is read once per listing and published.
 */
export type TraceDestinationFacts = {
  archivedProjectIds: ReadonlySet<string>;
};

export const NO_ARCHIVED_TRACE_DESTINATIONS: TraceDestinationFacts = {
  archivedProjectIds: new Set<string>(),
};

/**
 * Load the flag for a page of keys in one query, whatever the page's size.
 * Passed to the DTO explicitly rather than defaulted, because a caller that
 * forgets it would publish `trace_project_archived: false` for a deleted
 * project, which is the failure this field exists to prevent.
 */
export async function loadTraceDestinationFacts(
  client: PrismaClient | Prisma.TransactionClient,
  vks: { traceProjectId: string | null }[],
): Promise<TraceDestinationFacts> {
  const projects = await traceProjectsByIds(
    client,
    vks.map((vk) => vk.traceProjectId),
  );
  const archivedProjectIds = new Set<string>();
  for (const project of projects.values()) {
    if (project.archivedAt) archivedProjectIds.add(project.id);
  }
  return { archivedProjectIds };
}

export type VirtualKeyScopeEntry = {
  scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
  scopeId: string;
};

export type VirtualKeyCamelDto = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  status: "active" | "disabled" | "revoked";
  purpose: "user" | "langy";
  displayPrefix: string;
  principalUserId: string | null;
  /**
   * Where this key's traces and costs land; grants no access to the key.
   * Null only for a key written before the destination was stored, in an
   * organization that had no governance project to fall back to.
   */
  traceProjectId: string | null;
  /**
   * True when the customer has deleted the project the key traces into. The
   * key keeps sending its traces there, so nothing else on the row says so.
   */
  traceProjectArchived: boolean;
  principalUser: { name: string | null; email: string | null } | null;
  /** The caller's own id for this key, unique per organization. */
  externalId: string | null;
  /** Customer-owned bookkeeping, echoed back verbatim. */
  metadata: ResourceMetadata;
  scopes: VirtualKeyScopeEntry[];
  routingPolicyId: string | null;
  routingMode: "NONE" | "FALLBACK_ALL" | "POLICY";
  config: unknown;
  revision: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export type VirtualKeySnakeDto = {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  status: "active" | "disabled" | "revoked";
  purpose: "user" | "langy";
  display_prefix: string;
  principal_user_id: string | null;
  trace_project_id: string | null;
  trace_project_archived: boolean;
  external_id: string | null;
  metadata: ResourceMetadata;
  /**
   * Wire casing, lower_snake_case, unlike the camel DTO next to it: this is
   * the shape the public REST surface publishes, and every enum it carries is
   * lowercase there.
   */
  scopes: Array<{
    scope_type: "organization" | "team" | "project";
    scope_id: string;
  }>;
  routing_policy_id: string | null;
  routing_mode: "none" | "fallback_all" | "policy";
  config: unknown;
  revision: string;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

type BaseVk = Omit<VirtualKeyCamelDto, never>;

function baseVk(
  vk: VirtualKeyWithScopes,
  facts: TraceDestinationFacts,
): BaseVk {
  return {
    id: vk.id,
    organizationId: vk.organizationId,
    name: vk.name,
    description: vk.description,
    status:
      vk.status === "ACTIVE"
        ? "active"
        : vk.status === "DISABLED"
          ? "disabled"
          : "revoked",
    purpose: vk.purpose === "LANGY" ? "langy" : "user",
    displayPrefix: vk.displayPrefix,
    principalUserId: vk.principalUserId,
    traceProjectId: vk.traceProjectId ?? null,
    traceProjectArchived: vk.traceProjectId
      ? facts.archivedProjectIds.has(vk.traceProjectId)
      : false,
    principalUser: vk.principalUser
      ? { name: vk.principalUser.name, email: vk.principalUser.email }
      : null,
    externalId: vk.externalId ?? null,
    metadata: metadataFromRow(vk.metadata),
    scopes: vk.scopes.map((s) => ({
      scopeType: s.scopeType,
      scopeId: s.scopeId,
    })),
    routingPolicyId: vk.routingPolicyId,
    routingMode: vk.routingMode,
    config: vk.config,
    revision: vk.revision.toString(),
    createdAt: vk.createdAt.toISOString(),
    updatedAt: vk.updatedAt.toISOString(),
    lastUsedAt: vk.lastUsedAt?.toISOString() ?? null,
    revokedAt: vk.revokedAt?.toISOString() ?? null,
  };
}

export function toVirtualKeyCamelDto(
  vk: VirtualKeyWithScopes,
  facts: TraceDestinationFacts,
): VirtualKeyCamelDto {
  return baseVk(vk, facts);
}

export function toVirtualKeySnakeDto(
  vk: VirtualKeyWithScopes,
  facts: TraceDestinationFacts,
): VirtualKeySnakeDto {
  const base = baseVk(vk, facts);
  return {
    id: base.id,
    organization_id: base.organizationId,
    name: base.name,
    description: base.description,
    status: base.status,
    purpose: base.purpose,
    display_prefix: base.displayPrefix,
    principal_user_id: base.principalUserId,
    trace_project_id: base.traceProjectId,
    trace_project_archived: base.traceProjectArchived,
    external_id: base.externalId,
    metadata: base.metadata,
    scopes: base.scopes.map((s) => ({
      scope_type: toWireEnum(s.scopeType),
      scope_id: s.scopeId,
    })),
    routing_policy_id: base.routingPolicyId,
    routing_mode: toWireEnum(base.routingMode),
    config: base.config,
    revision: base.revision,
    created_at: base.createdAt,
    updated_at: base.updatedAt,
    last_used_at: base.lastUsedAt,
    revoked_at: base.revokedAt,
  };
}
