import { type CreateApiKeyInput, deriveBindingRole } from "./api-key-permissions.ts";

export const LEGACY_KEY_REPLACEMENT_NAME = "Project API Key";

/**
 * The key that takes over from a revoked legacy key: full access to its project, no expiry.
 * An organization admin gets an ownerless service key, like the legacy key; others a personal one.
 * Undefined when that key could not send traces, so the legacy key must stay.
 */
export function legacyKeyReplacementInput({
  projectId,
  isOrganizationAdmin,
  reader,
}: {
  projectId: string;
  isOrganizationAdmin: boolean;
  reader: Pick<
    Parameters<typeof deriveBindingRole>[0],
    "myBindings" | "organizationId" | "orgProjects"
  >;
}): CreateApiKeyInput | undefined {
  const keyType = isOrganizationAdmin ? "service" : "personal";
  const role = deriveBindingRole({
    permissionMode: "all",
    scopeType: "PROJECT",
    scopeId: projectId,
    ...reader,
    isServiceKey: keyType === "service",
  });
  if (role !== "ADMIN" && role !== "MEMBER") return undefined;
  return {
    name: LEGACY_KEY_REPLACEMENT_NAME,
    description: "Project API Key",
    expiresAt: undefined,
    permissionMode: "all",
    keyType,
    scopeType: "PROJECT",
    scopeId: projectId,
    bindings: [{ role, scopeType: "PROJECT", scopeId: projectId }],
  };
}
