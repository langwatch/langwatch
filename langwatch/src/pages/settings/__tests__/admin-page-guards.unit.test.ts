import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

/**
 * Regression pin for the post-merge dogfood P0 RBAC closure (commit
 * `bca6e0422`). The five legacy admin pages below leaked full org data
 * to MEMBER persona because their `withPermissionGuard` wrapping checked
 * permissions MEMBER inherits by default (`auditLog:view`, `team:view`,
 * `organization:view`). They must require `organization:manage` so the
 * UI deny-page renders for non-admins, matching the pattern used by the
 * governance-era pages.
 *
 * The actual privacy guarantee lives at the tRPC procedure layer (see
 * `commit eadd6e38f` + `fb8f3e8b8` + `4162531ff` and the integration
 * coverage in `governance.rbac.integration.test.ts` + Lane-S follow-up
 * test suite). This unit test is a cheap regression-pin on the UI-side
 * convenience deny — it catches any future PR that downgrades a guard
 * back to `organization:view` or similar permissive shape.
 */
const PAGES_REQUIRING_ORG_MANAGE = [
  "audit-log.tsx",
  "teams.tsx",
  "members.tsx",
  "roles.tsx",
  "groups.tsx",
] as const;

describe("legacy /settings admin pages", () => {
  describe("when guarded by withPermissionGuard", () => {
    it.each(PAGES_REQUIRING_ORG_MANAGE)(
      "%s requires organization:manage",
      (filename) => {
        const source = readFileSync(
          join(__dirname, "..", filename),
          "utf-8",
        );
        expect(source).toMatch(
          /export default withPermissionGuard\("organization:manage"/,
        );
      },
    );
  });
});
