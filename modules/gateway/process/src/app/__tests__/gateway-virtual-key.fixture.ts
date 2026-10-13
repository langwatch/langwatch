import type { GatewayVirtualKeyRecord } from "@langwatch/gateway-contract";
import { Temporal } from "@langwatch/time";

export function virtualKeyRow(): GatewayVirtualKeyRecord {
  const now = Temporal.Instant.from("2026-08-01T00:00:00.000Z");

  return {
    id: "vk_1",
    organizationId: "organization_1",
    name: "k",
    description: null,
    status: "ACTIVE",
    purpose: "USER",
    externalId: null,
    metadata: {},
    disabledAt: null,
    disabledReason: null,
    expiresAt: null,
    hashedSecret: "test-hash",
    displayPrefix: "lw_",
    principalUserId: null,
    traceProjectId: null,
    config: {},
    revision: 1n,
    previousHashedSecret: null,
    previousSecretValidUntil: null,
    revokedAt: null,
    revokedById: null,
    createdAt: now,
    updatedAt: now,
    createdById: "usr_1",
    lastUsedAt: null,
    routingPolicyId: null,
    routingMode: "NONE",
    scopes: [{ scopeType: "PROJECT", scopeId: "project_caller" }],
    principalUser: null,
    routingPolicy: null,
  };
}
