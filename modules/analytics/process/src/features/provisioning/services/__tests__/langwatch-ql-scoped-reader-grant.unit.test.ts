/**
 * The scoped-reader group's grant SQL: SELECT only on a live view that is provably the
 * row-scoped one, and a revoke for any live view that is not, so a stale grant never survives.
 * @see ../langwatch-ql-production-provisioning.service.ts
 */

import { describe, expect, it } from "vitest";

import {
  LWQL_ORG_MEMBERSHIP_FRAGMENT,
  LWQL_ORG_SCOPE_FRAGMENT,
  LWQL_SCOPED_READER_GROUP,
  LWQL_SESSION_USER_FRAGMENT,
} from "../langwatch-ql-postgres-mapping.service.ts";
import { LangWatchQLProductionProvisioningService } from "../langwatch-ql-production-provisioning.service.ts";

const provisioning = LangWatchQLProductionProvisioningService.create();
const [block = ""] = provisioning.postgresScopedReaderGrantStatements({ schema: "public" });

describe("given the scoped-reader group's grant statements", () => {
  describe("when rendered for the public schema", () => {
    it("is a single block guarded by the group's existence", () => {
      expect(block).toContain(`rolname = '${LWQL_SCOPED_READER_GROUP}'`);
    });

    it("grants only after proving the live view is a scoped barrier view", () => {
      expect(block).toContain("c.relkind = 'v'");
      expect(block).toContain("'security_barrier=true' = ANY(coalesce(c.reloptions, '{}'))");
      expect(block).toContain(
        `position('${LWQL_ORG_SCOPE_FRAGMENT.replaceAll("'", "''")}' in pg_get_viewdef(c.oid))`,
      );
      expect(block).toContain(
        `position('${LWQL_ORG_MEMBERSHIP_FRAGMENT}' in lower(pg_get_viewdef(c.oid)))`,
      );
      expect(block).toContain(
        `position('${LWQL_SESSION_USER_FRAGMENT}' in lower(pg_get_viewdef(c.oid)))`,
      );
      expect(block).not.toContain("position('current_user' in");
    });

    it("revokes from the group on a live view that fails the guard", () => {
      expect(block).toMatch(
        /ELSIF to_regclass\('"public"\."lwql_[a-z_]+"'\) IS NOT NULL THEN\n\s+EXECUTE 'REVOKE SELECT ON "public"\."lwql_[a-z_]+" FROM "lwql_scoped_reader"'/,
      );
    });

    it("pairs every grant with a revoke", () => {
      const grants = block.match(/EXECUTE 'GRANT SELECT ON/g) ?? [];
      const revokes = block.match(/EXECUTE 'REVOKE SELECT ON/g) ?? [];

      expect(revokes).toHaveLength(grants.length);
    });
  });
});
