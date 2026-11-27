/**
 * The scoped-reader group's SQL: revokes first, then the scoped schema with its ownership marker,
 * then USAGE on lwql_scoped only and SELECT only on a copy that is provably row-scoped.
 * @see ../langwatch-ql-production-provisioning.service.ts
 */

import { describe, expect, it } from "vitest";

import {
  LWQL_ORG_MEMBERSHIP_FRAGMENT,
  LWQL_ORG_SCOPE_FRAGMENT,
  LWQL_CURRENT_USER_FRAGMENT,
  LWQL_SCOPED_READER_GROUP,
  scopedSchemaMarker,
} from "../../rules/lwql-scoped-view.rules.ts";
import { LangWatchQLPostgresViewsService } from "../langwatch-ql-postgres-views.service.ts";
import { LangWatchQLProductionProvisioningService } from "../langwatch-ql-production-provisioning.service.ts";

const provisioning = LangWatchQLProductionProvisioningService.create();
const names = LangWatchQLPostgresViewsService.create().approvedViewNames();
const [grants = ""] = provisioning.postgresScopedReaderGrantStatements({ schema: "public" });
const [revokeFirst = ""] = provisioning.postgresScopedReaderRevokeFirstStatements({
  schema: "public",
});
const [schemaStatement = "", ...copyStatements] = provisioning.postgresScopedViewStatements({
  schema: "public",
});
const ownedByThisInstallation =
  `obj_description(to_regnamespace('lwql_scoped'), 'pg_namespace') = ` +
  `'${scopedSchemaMarker({ appSchema: "public" })}'`;

describe("given the scoped-reader group's grant statements", () => {
  describe("when rendered for the public schema", () => {
    it("is a single block guarded by the group's existence", () => {
      expect(grants).toContain(`rolname = '${LWQL_SCOPED_READER_GROUP}'`);
    });

    it("grants USAGE on lwql_scoped only, and only in this installation's scoped schema", () => {
      expect(grants.match(/GRANT USAGE ON SCHEMA [^ ]+/g)).toEqual([
        'GRANT USAGE ON SCHEMA "lwql_scoped"',
      ]);
      expect(grants).toContain(`IF ${ownedByThisInstallation} THEN`);
    });

    it("grants only after proving the live copy is a scoped barrier view", () => {
      expect(grants).toContain("c.relkind = 'v'");
      expect(grants).toContain("'security_barrier=true' = ANY(coalesce(c.reloptions, '{}'))");
      expect(grants).toContain(
        `position('${LWQL_ORG_SCOPE_FRAGMENT.replaceAll("'", "''")}' in pg_get_viewdef(c.oid))`,
      );
      expect(grants).toContain(
        `position('${LWQL_ORG_MEMBERSHIP_FRAGMENT}' in lower(pg_get_viewdef(c.oid)))`,
      );
      expect(grants).toContain(
        `position('${LWQL_CURRENT_USER_FRAGMENT}' in lower(pg_get_viewdef(c.oid)))`,
      );
      expect(grants).not.toContain("position('current_user' in");
    });

    it("finds each copy by name in the catalog, never by to_regclass", () => {
      expect(grants).toContain("n.nspname = 'lwql_scoped' AND c.relname = ");
      expect(grants).not.toContain("to_regclass");
    });

    it("grants and revokes on copies alone, one of each per approved view", () => {
      const granted = grants.match(/EXECUTE 'GRANT SELECT ON "lwql_scoped"\."[a-z0-9_]+"/g) ?? [];
      const revoked = grants.match(/EXECUTE 'REVOKE SELECT ON "lwql_scoped"\."[a-z0-9_]+"/g) ?? [];

      expect([granted.length, revoked.length]).toEqual([names.length, names.length]);
      expect(grants).not.toContain('"public"."lwql_');
    });
  });
});

describe("given the scoped-reader group's revoke-first statement", () => {
  describe("when rendered for the public schema", () => {
    it("is guarded by the group's existence", () => {
      expect(revokeFirst).toContain(`rolname = '${LWQL_SCOPED_READER_GROUP}'`);
    });

    it("only revokes", () => {
      expect(revokeFirst).not.toMatch(/\bGRANT\b/);
      expect(revokeFirst).not.toMatch(/\bCREATE\b/);
    });

    it("revokes USAGE on the app schema and SELECT on every shared view", () => {
      expect(revokeFirst).toContain(`REVOKE USAGE ON SCHEMA "public" FROM "lwql_scoped_reader"`);
      const shared = revokeFirst.match(/REVOKE SELECT ON "public"\."[a-z0-9_]+"/g) ?? [];

      expect(shared).toHaveLength(names.length);
    });

    it("revokes on a copy only when it fails the check, and only in its own scoped schema", () => {
      const onCopies = revokeFirst.match(/REVOKE SELECT ON "lwql_scoped"\."[a-z0-9_]+"/g) ?? [];

      expect(onCopies).toHaveLength(names.length);
      expect(revokeFirst).toContain(`IF ${ownedByThisInstallation} THEN`);
      expect(revokeFirst).toContain("AND NOT (c.relkind = 'v'");
    });
  });
});

describe("given the scoped schema statement", () => {
  describe("when rendered for the public schema", () => {
    it("creates lwql_scoped only when the group exists and the schema is absent", () => {
      expect(schemaStatement).toContain(
        `IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${LWQL_SCOPED_READER_GROUP}') ` +
          `AND to_regnamespace('lwql_scoped') IS NULL THEN`,
      );
      expect(schemaStatement).toContain('CREATE SCHEMA "lwql_scoped";');
    });

    /** @scenario "A scoped schema marked as another installation's is left alone" */
    it("marks the schema it creates with the app schema that owns it", () => {
      expect(schemaStatement).toContain(
        `COMMENT ON SCHEMA "lwql_scoped" IS 'langwatch-lwql-scoped:public';`,
      );
    });

    /** @scenario "Without CREATE on the database, the scoped part fails closed" */
    it("leaves the schema absent, raising nothing, for a role without CREATE", () => {
      expect(schemaStatement).toContain("WHEN insufficient_privilege OR duplicate_schema THEN");
    });

    /** @scenario "A scoped schema marked as another installation's is left alone" */
    it("writes every copy only into a scoped schema marked as this installation's", () => {
      expect(copyStatements).toHaveLength(names.length);
      expect(copyStatements.filter((s) => !s.includes(ownedByThisInstallation))).toEqual([]);
    });
  });
});
