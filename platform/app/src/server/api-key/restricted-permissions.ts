import { z } from "zod";

/**
 * The permission modes an API key can be in.
 *
 * `all` and `readonly` take their meaning from the key's role bindings alone;
 * `restricted` additionally carries an explicit permission list, held on a
 * private custom role the key owns.
 */
export const API_KEY_PERMISSION_MODES = [
  "all",
  "readonly",
  "restricted",
] as const;

export type ApiKeyPermissionMode = (typeof API_KEY_PERMISSION_MODES)[number];

/**
 * The three-way consistency rule between `permissionMode`, `permissions` and
 * the CUSTOM bindings that carry them, expressed as a zod refinement so the
 * caller is told which field is wrong instead of getting a 403 from the
 * service after the request was already accepted.
 *
 * Shared by tRPC and REST on purpose: the service enforces the same rule as a
 * last line of defense, and two hand-written copies of it in front of that had
 * already started to disagree on wording.
 */
export function refineRestrictedPermissions(
  data: {
    permissionMode?: string;
    permissions?: string[];
    bindings?: Array<{ role: string }>;
  },
  ctx: z.RefinementCtx,
): void {
  const isRestricted = data.permissionMode === "restricted";
  const hasCustomBinding =
    data.bindings?.some((b) => b.role === "CUSTOM") ?? false;
  const hasPermissions = !!data.permissions && data.permissions.length > 0;

  if (!isRestricted && !hasCustomBinding && !hasPermissions) return;

  if (!isRestricted) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "CUSTOM permissions require permissionMode 'restricted'",
      path: ["permissionMode"],
    });
  }
  if (!hasCustomBinding) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "restricted mode requires at least one CUSTOM binding",
      path: ["bindings"],
    });
  }
  if (!hasPermissions) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "restricted mode requires at least one permission",
      path: ["permissions"],
    });
  }
}
