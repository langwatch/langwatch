import { AUTHZ_ACTIONS, AUTHZ_RESOURCES } from "@langwatch/authz";
import { HandledError } from "@langwatch/handled-error";
import { z } from "zod";

// Older stored roles and the public catalogue include the inert scim family.
// Provisioning authorization uses sso:view and sso:manage.
export const CUSTOM_ROLE_RESOURCES = [...Object.keys(AUTHZ_RESOURCES), "scim"];

const VALID_PERMISSIONS: Set<string> = new Set(
  CUSTOM_ROLE_RESOURCES.flatMap((r) => AUTHZ_ACTIONS.map((a) => `${r}:${a}`)),
);

export const permissionFormatSchema = z
  .string()
  .refine((val) => VALID_PERMISSIONS.has(val), {
    message: "must be a valid resource:action permission",
  });

export const CustomRolePermissionsSchema = z.array(permissionFormatSchema);

/** Malformed stored roles are errors, never an empty permission ceiling. */
export class MalformedCustomRolePermissionsError extends HandledError {
  declare readonly code: "malformed_custom_role_permissions";

  constructor(
    customRoleId: string,
    options: {
      meta?: Record<string, unknown>;
      reasons?: readonly Error[];
    } = {},
  ) {
    super(
      "malformed_custom_role_permissions",
      `Custom role ${customRoleId} has malformed permissions`,
      {
        meta: { customRoleId, ...options.meta },
        httpStatus: 500, // infrastructural / data-integrity, not a user error
        fault: "platform",
        reasons: options.reasons,
      },
    );
    this.name = "MalformedCustomRolePermissionsError";
  }
}

export function parseCustomRolePermissions({
  customRoleId,
  permissions,
}: {
  customRoleId: string;
  permissions: unknown;
}): string[] {
  const result = CustomRolePermissionsSchema.safeParse(permissions);
  if (!result.success) {
    throw new MalformedCustomRolePermissionsError(customRoleId, {
      meta: { zodIssues: result.error.issues },
    });
  }
  return result.data;
}
