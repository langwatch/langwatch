import type { GatewayVirtualKeyRecord } from "@langwatch/gateway-contract";
import { Temporal } from "@langwatch/time";

const at = Temporal.Instant.fromEpochMilliseconds(1);

export function gatewayKey(
  overrides: Partial<GatewayVirtualKeyRecord> = {},
): GatewayVirtualKeyRecord {
  return {
    id: "key",
    organizationId: "organization",
    name: "default",
    description: "Personal virtual key",
    status: "ACTIVE",
    purpose: "USER",
    externalId: null,
    metadata: null,
    disabledAt: null,
    disabledReason: null,
    expiresAt: null,
    hashedSecret: "hashed",
    displayPrefix: "vk-lw-test",
    principalUserId: "user",
    traceProjectId: null,
    config: null,
    revision: 1n,
    previousHashedSecret: null,
    previousSecretValidUntil: null,
    revokedAt: null,
    revokedById: null,
    createdAt: at,
    updatedAt: at,
    createdById: "user",
    lastUsedAt: null,
    routingPolicyId: null,
    routingMode: "NONE",
    scopes: [{ scopeType: "PROJECT", scopeId: "project" }],
    principalUser: null,
    routingPolicy: null,
    ...overrides,
  };
}
