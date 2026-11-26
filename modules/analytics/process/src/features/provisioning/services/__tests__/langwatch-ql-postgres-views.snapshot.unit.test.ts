/**
 * File snapshots of the generated Postgres view SQL, shared and scoped, so a downstream consumer
 * can diff its fixtures against them. Regenerate with `vitest run -u` after an intended change.
 * @see ../langwatch-ql-postgres-views.service.ts
 */

import { describe, expect, it } from "vitest";

import {
  LWQL_ORG_MEMBERSHIP_FRAGMENT,
  LWQL_ORG_SCOPE_FRAGMENT,
  LWQL_CURRENT_USER_FRAGMENT,
  LWQL_SCOPED_READER_GROUP,
  scopedCopiesWritableCondition,
} from "../../rules/lwql-scoped-view.rules.ts";
import { LangWatchQLPostgresViewsService } from "../langwatch-ql-postgres-views.service.ts";
import { LangWatchQLProductionProvisioningService } from "../langwatch-ql-production-provisioning.service.ts";

const provisioning = LangWatchQLProductionProvisioningService.create();
const postgresViews = LangWatchQLPostgresViewsService.create();

const names = postgresViews.approvedViewNames();
const shared = provisioning.postgresApprovedViewStatements({ schema: "public" });
const copies = postgresViews.scopedViewStatements({ schema: "public" });

describe("given the generated approved Postgres views", () => {
  describe("when the shared views are rendered for the public schema", () => {
    it("matches the approved snapshot", async () => {
      const blocks = shared.map((s, i) => `\n-- view: ${names[i]}\n${s};\n`);
      const text = `-- approved views: ${names.length}\n` + blocks.join("");

      await expect(text).toMatchFileSnapshot(
        "./__snapshots__/approved-postgres-views.snapshot.sql",
      );
    });

    it("yields one statement per approved view", () => {
      expect(shared).toHaveLength(names.length);
    });

    /** @scenario "An older version's converge cannot weaken a scoped copy" */
    it.each(["security_barrier", "lwql_org_", "current_user", "pg_auth_members"])(
      "carries no %s in any shared view, as origin/main renders them",
      (fragment) => {
        expect(shared.filter((s) => s.includes(fragment))).toEqual([]);
      },
    );
  });

  describe("when the scoped copies are rendered for the public schema", () => {
    it("matches the scoped snapshot", async () => {
      const blocks = copies.map((s, i) => `\n-- copy: ${names[i]}\n${s};\n`);
      const text = `-- scoped copies: ${names.length}\n` + blocks.join("");

      await expect(text).toMatchFileSnapshot("./__snapshots__/scoped-postgres-views.snapshot.sql");
    });

    it("creates each copy in lwql_scoped under its shared view's name", () => {
      expect(
        copies.filter(
          (s, i) => !s.includes(`CREATE OR REPLACE VIEW "lwql_scoped"."${names[i]}" WITH`),
        ),
      ).toEqual([]);
    });

    it("reads the base tables in the app schema, never a shared view", () => {
      expect(copies.filter((s) => !s.includes(`FROM "public".`))).toEqual([]);
      expect(copies.filter((s) => s.includes(`FROM "public"."lwql_`))).toEqual([]);
    });

    it("makes every copy a security barrier carrying the org-role lookup", () => {
      expect(copies.filter((s) => !s.includes("security_barrier=true"))).toEqual([]);
      expect(copies.filter((s) => !s.includes(LWQL_ORG_SCOPE_FRAGMENT))).toEqual([]);
    });

    it("ties the org-role membership to the current user in every copy", () => {
      const lowered = copies.map((s) => s.toLowerCase());

      expect(lowered.filter((s) => !s.includes(LWQL_ORG_MEMBERSHIP_FRAGMENT))).toEqual([]);
      expect(lowered.filter((s) => !s.includes(LWQL_CURRENT_USER_FRAGMENT))).toEqual([]);
    });

    it("exempts no login, the shared reader included", () => {
      expect(copies.filter((s) => s.includes("current_user = 'lwql_ro'"))).toEqual([]);
    });

    it("runs each only where the group exists and lwql_scoped is this installation's", () => {
      const onlyWhen = scopedCopiesWritableCondition({ appSchema: "public" });

      expect(copies.filter((s) => !s.includes(`IF ${onlyWhen} THEN`))).toEqual([]);
    });

    it("re-grants only the scoped-reader group on the fallback", () => {
      expect(copies.filter((s) => /GRANT SELECT ON [^\n]+ TO "lwql_ro"/.test(s))).toEqual([]);
      expect(copies.filter((s) => !s.includes(`TO "${LWQL_SCOPED_READER_GROUP}"`))).toEqual([]);
    });
  });
});
