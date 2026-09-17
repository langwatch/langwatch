import { roleKeyForTeamRole } from "@langwatch/authz";
import { grantFactToRow } from "@langwatch/authz-server";
import { z } from "zod";

const keyFixture = z.object({
  id: z.string(),
  organizationId: z.string(),
  roleBindings: z
    .array(
      z.object({
        id: z.string(),
        role: z.enum(["ADMIN", "MEMBER", "VIEWER", "CUSTOM"]),
        customRoleId: z.string().nullable(),
        scopeType: z.enum(["ORGANIZATION", "TEAM", "PROJECT"]),
        scopeId: z.string(),
      }),
    )
    .default([]),
});

export async function grantRowsForKeyResult(result: unknown) {
  const value = await result;
  if (value == null) return [];
  const key = keyFixture.parse(value);
  return key.roleBindings.map((binding) => ({
    ...grantFactToRow({
      organizationId: key.organizationId,
      grant: {
        grantId: binding.id,
        principal: { type: "apiKey", id: key.id },
        roleKey: binding.customRoleId
          ? `custom:${binding.customRoleId}`
          : roleKeyForTeamRole(binding.role),
        legacyRole: binding.role,
        source: "api-key-service",
        scope: { type: binding.scopeType, id: binding.scopeId },
        occurredAtMs: 0,
      },
    }),
    updatedAt: new Date(0),
  }));
}
