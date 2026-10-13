import {
  type GatewayVirtualKeySnakeDto,
  type VirtualKeyCamelDtoResponse,
  type VirtualKeyWithScopes,
  metadataFromRow,
  toWireEnum,
} from "@langwatch/gateway-contract";
import type { ProjectApi } from "@langwatch/project-contract";
/**
 * Shared DTO for VirtualKey (tRPC camelCase, REST snake_case). Post-collapse:
 * providerCredentialIds/providerChain are gone — eligible providers derive
 * from the scope graph + RoutingPolicy at request time (scopeResolver.ts).
 */
import { toDate } from "@langwatch/time";

/**
 * A key follows its stored trace-destination pointer even after the project
 * behind it is deleted — spans keep landing there and reappear if restored.
 * Unreadable from the row alone, so it's read once per listing and published.
 */
type TraceDestinationFacts = {
  archivedProjectIds: ReadonlySet<string>;
};

export type VirtualKeyCamelDto = VirtualKeyCamelDtoResponse;

export type VirtualKeySnakeDto = GatewayVirtualKeySnakeDto;

type BaseVk = Omit<VirtualKeyCamelDto, never>;

const STATUS_BY_ROW: Record<VirtualKeyWithScopes["status"], VirtualKeyCamelDto["status"]> = {
  ACTIVE: "active",
  DISABLED: "disabled",
  REVOKED: "revoked",
};

function baseVk(vk: VirtualKeyWithScopes, facts: TraceDestinationFacts): BaseVk {
  return {
    id: vk.id,
    organizationId: vk.organizationId,
    name: vk.name,
    description: vk.description,
    status: STATUS_BY_ROW[vk.status],
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
    createdAt: toDate(vk.createdAt).toISOString(),
    updatedAt: toDate(vk.updatedAt).toISOString(),
    lastUsedAt: vk.lastUsedAt ? toDate(vk.lastUsedAt).toISOString() : null,
    revokedAt: vk.revokedAt ? toDate(vk.revokedAt).toISOString() : null,
    expiresAt: vk.expiresAt ? toDate(vk.expiresAt).toISOString() : null,
  };
}

/** Virtual-key rows to their two wire shapes. */
export class GatewayVirtualKeyDtoService {
  static create(): GatewayVirtualKeyDtoService {
    return new GatewayVirtualKeyDtoService();
  }

  private constructor() {}

  /**
   * Loads the flag for a page of keys in one query. Passed to the DTO
   * explicitly, not defaulted, since a forgetful caller would publish
   * trace_project_archived: false for a deleted project.
   */
  async loadTraceDestinationFacts({
    projects,
    virtualKeys,
  }: {
    projects: ProjectApi;
    virtualKeys: { traceProjectId: string | null }[];
  }): Promise<TraceDestinationFacts> {
    const destinationRows = await projects.listTraceDestinations(
      virtualKeys.flatMap((vk) => (vk.traceProjectId ? [vk.traceProjectId] : [])),
    );
    const archivedProjectIds = new Set<string>();
    for (const project of destinationRows) {
      if (project.archivedAt) archivedProjectIds.add(project.id);
    }
    return { archivedProjectIds };
  }

  toVirtualKeyCamelDto({
    virtualKey,
    facts,
  }: {
    virtualKey: VirtualKeyWithScopes;
    facts: TraceDestinationFacts;
  }): VirtualKeyCamelDto {
    return baseVk(virtualKey, facts);
  }

  toVirtualKeySnakeDto({
    virtualKey,
    facts,
  }: {
    virtualKey: VirtualKeyWithScopes;
    facts: TraceDestinationFacts;
  }): VirtualKeySnakeDto {
    const base = baseVk(virtualKey, facts);
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
      expires_at: base.expiresAt,
    };
  }
}
