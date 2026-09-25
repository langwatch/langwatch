// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { PersonalVirtualKey } from "@langwatch/enterprise-gateway-contract";
import type { GatewayVirtualKeyRecord } from "@langwatch/gateway-contract";

export const DEFAULT_PERSONAL_KEY_LABEL = "default";

/** A gateway key as the personal surface shows it; instants become epoch milliseconds. */
export function toPersonalVirtualKey(key: GatewayVirtualKeyRecord): PersonalVirtualKey {
  return {
    id: key.id,
    organizationId: key.organizationId,
    name: key.name,
    description: key.description,
    displayPrefix: key.displayPrefix,
    status: key.status,
    principalUserId: key.principalUserId,
    routingPolicyId: key.routingPolicyId,
    createdAtMs: key.createdAt.epochMilliseconds,
    updatedAtMs: key.updatedAt.epochMilliseconds,
    lastUsedAtMs: key.lastUsedAt?.epochMilliseconds ?? null,
    scopes: key.scopes.map(({ scopeType, scopeId }) => ({ scopeType, scopeId })),
  };
}

/** Where a personal key could reach a provider: the organization, the personal team, the project. */
export function personalKeyEligibilityScopes({
  organizationId,
  personalTeamId,
  personalProjectId,
}: {
  organizationId: string;
  personalTeamId?: string;
  personalProjectId: string;
}): { scopeType: "ORGANIZATION" | "TEAM" | "PROJECT"; scopeId: string }[] {
  return [
    { scopeType: "ORGANIZATION", scopeId: organizationId },
    ...(personalTeamId ? [{ scopeType: "TEAM" as const, scopeId: personalTeamId }] : []),
    { scopeType: "PROJECT", scopeId: personalProjectId },
  ];
}

/** Main's default personal key: labelled `default` and scoped to the personal project. */
export function isDefaultPersonalKey({
  key,
  personalProjectId,
}: {
  key: GatewayVirtualKeyRecord;
  personalProjectId: string;
}): boolean {
  return (
    key.name === DEFAULT_PERSONAL_KEY_LABEL &&
    key.scopes.some(
      ({ scopeType, scopeId }) => scopeType === "PROJECT" && scopeId === personalProjectId,
    )
  );
}
