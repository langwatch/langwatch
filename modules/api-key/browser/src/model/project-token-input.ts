import { defaultCliKeyPermissions, type ApiKeyTrpcCreateInput } from "@langwatch/api-key-contract";
import { bindingScopeCanGrantPermission } from "@langwatch/authz-contract";
import { toDate, type Instant } from "@langwatch/time";

/** The device-flow defaults a project binding can grant, capped at what the person holds there. */
export function cappedDeviceFlowPermissions({ held }: { held: readonly string[] }) {
  return defaultCliKeyPermissions().filter(
    (permission) =>
      held.includes(permission) &&
      bindingScopeCanGrantPermission({ scopeType: "PROJECT", permission }),
  );
}

/**
 * A personal access token restricted to `permissions` on one project; never a full key
 * (ARCHITECTURE.md, setup tokens, Alex 2026-10-01). `expiresAt` is the reader's explicit
 * choice, `undefined` meaning "No expiration": there is no default (rulings 2026-10-05, Q48).
 */
export function projectTokenInput({
  organizationId,
  projectId,
  permissions,
  expiresAt,
  name = "Personal access token",
}: {
  organizationId: string;
  projectId: string;
  permissions: readonly string[];
  expiresAt: Instant | undefined;
  name?: string;
}): ApiKeyTrpcCreateInput {
  return {
    organizationId,
    name,
    permissionMode: "restricted",
    permissions: [...permissions],
    keyType: "personal",
    expiresAt: expiresAt && toDate(expiresAt),
    bindings: [{ role: "CUSTOM", scopeType: "PROJECT", scopeId: projectId }],
  };
}
