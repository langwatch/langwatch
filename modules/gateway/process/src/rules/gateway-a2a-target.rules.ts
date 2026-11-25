import type {
  GatewayA2aTargetDto,
  GatewayA2aTargetResource,
  GatewayA2aTargetWire,
  VirtualKeyWithScopes,
} from "@langwatch/gateway-contract";

/** Targets a key of `projectId` reaches: its project's, then org-wide ones it does not shadow. */
export function a2aTargetsForProject({
  targets,
  projectId,
}: {
  targets: GatewayA2aTargetResource[];
  projectId: string | null;
}): GatewayA2aTargetWire[] {
  const own = targets.filter((t) => projectId !== null && t.projectId === projectId);
  const shadowed = new Set(own.map((t) => t.name));
  const orgWide = targets.filter((t) => t.projectId === null && !shadowed.has(t.name));
  return [...own, ...orgWide]
    .toSorted((left, right) => left.name.localeCompare(right.name))
    .map(a2aTargetToWire);
}

export function a2aTargetToWire(target: GatewayA2aTargetResource): GatewayA2aTargetWire {
  return {
    name: target.name,
    agent_name: target.agentName,
    card_url: target.cardUrl,
    upstream_url: target.upstreamUrl,
    upstream_headers: target.upstreamHeaders,
    blocked: target.blocked,
    block_reason: target.blockReason ?? "",
    allowed_virtual_key_ids: target.allowedVirtualKeyIds,
  };
}

export function a2aTargetToDto(target: GatewayA2aTargetResource): GatewayA2aTargetDto {
  const { upstreamHeaders, ...rest } = target;
  return {
    ...rest,
    upstreamHeaderNames: Object.keys(upstreamHeaders).toSorted(),
    createdAt: target.createdAt.toISOString(),
    updatedAt: target.updatedAt.toISOString(),
    archivedAt: target.archivedAt?.toISOString() ?? null,
  };
}

/** No allow list admits every key of the scope; otherwise the key must be on it. */
export function a2aTargetAdmitsKey({
  target,
  virtualKeyId,
}: {
  target: GatewayA2aTargetWire;
  virtualKeyId: string;
}): boolean {
  return (
    target.allowed_virtual_key_ids === null || target.allowed_virtual_key_ids.includes(virtualKeyId)
  );
}

/** Whether a key's own scope entries reach a project: its organization, its team or itself. */
export function keyScopesReachProject({
  vk,
  project,
}: {
  vk: VirtualKeyWithScopes;
  project: { id: string; teamId: string };
}): boolean {
  return vk.scopes.some(
    (scope) =>
      (scope.scopeType === "ORGANIZATION" && scope.scopeId === vk.organizationId) ||
      (scope.scopeType === "TEAM" && scope.scopeId === project.teamId) ||
      (scope.scopeType === "PROJECT" && scope.scopeId === project.id),
  );
}
