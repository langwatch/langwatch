import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { DomainError } from "../app-layer/domain-error";
import { Actions, Resources } from "../api/rbac";

const VALID_PERMISSIONS: Set<string> = new Set(
  Object.values(Resources).flatMap((r) =>
    Object.values(Actions).map((a) => `${r}:${a}`),
  ),
);

export const permissionFormatSchema = z
  .string()
  .refine((val) => VALID_PERMISSIONS.has(val), {
    message: "must be a valid resource:action permission",
  });

export const CustomRolePermissionsSchema = z.array(permissionFormatSchema);

/**
 * Thrown when a `CustomRole.permissions` JSON value cannot be parsed as an
 * array of `resource:action` strings. Indicates either data corruption or a
 * manual-SQL write that bypassed the write-path validator.
 *
 * Call sites decide how to respond:
 *   - Auth/ceiling decisions → bubble up, refuse the operation (fail closed)
 *   - Read-only aggregations → catch, skip the row, log
 *
 * Do NOT default to "empty permissions" — in a permission-ceiling context,
 * "no permissions granted" is a dangerous fail-open (nothing to verify →
 * every check trivially passes).
 */
export class MalformedCustomRolePermissionsError extends DomainError {
  declare readonly kind: "malformed_custom_role_permissions";

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
        reasons: options.reasons,
      },
    );
    this.name = "MalformedCustomRolePermissionsError";
  }
}

/**
 * Parses a `CustomRole.permissions` JSON value into a typed `string[]` of
 * `resource:action` permission strings, or throws
 * `MalformedCustomRolePermissionsError` if the value does not conform.
 *
 * Shared across:
 *   - `ApiKeyService.assertCustomRoleWithinCeiling` — lets the throw bubble so
 *     API key creation rejects with 403 (wrapped as `ApiKeyScopeViolationError`)
 *   - `checkRoleBindingPermission` — catches and returns `false` (denied)
 *
 * The caller is responsible for mapping the throw to the right outcome for
 * its context; this function never "fails safe" by returning `[]`.
 */
export function parseCustomRolePermissions({
  customRoleId,
  permissions,
}: {
  customRoleId: string;
  permissions: Prisma.JsonValue | null | undefined;
}): string[] {
  const result = CustomRolePermissionsSchema.safeParse(permissions);
  if (!result.success) {
    throw new MalformedCustomRolePermissionsError(customRoleId, {
      meta: { zodIssues: result.error.issues },
    });
  }
  return result.data;
}
