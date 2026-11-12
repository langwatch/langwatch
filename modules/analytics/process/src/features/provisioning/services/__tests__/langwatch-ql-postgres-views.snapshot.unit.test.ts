/**
 * File snapshot of the generated Postgres view SQL, so a downstream consumer can diff its
 * fixtures against it. Regenerate with `vitest run -u` after an intended change.
 * @see ../langwatch-ql-postgres-views.service.ts
 */

import { describe, expect, it } from "vitest";

import { LWQL_ORG_SCOPE_FRAGMENT } from "../langwatch-ql-postgres-mapping.service.ts";
import { LangWatchQLPostgresViewsService } from "../langwatch-ql-postgres-views.service.ts";
import { LangWatchQLProductionProvisioningService } from "../langwatch-ql-production-provisioning.service.ts";

const provisioning = LangWatchQLProductionProvisioningService.create();
const postgresViews = LangWatchQLPostgresViewsService.create();

const names = postgresViews.approvedViewNames();
const statements = provisioning.postgresApprovedViewStatements({ schema: "public" });

describe("given the generated approved Postgres views", () => {
  describe("when rendered for the public schema", () => {
    it("matches the approved snapshot", async () => {
      const text =
        `-- approved views: ${names.length}\n` +
        statements.map((statement, index) => `\n-- view: ${names[index]}\n${statement};\n`).join("");

      await expect(text).toMatchFileSnapshot("./__snapshots__/approved-postgres-views.snapshot.sql");
    });

    it("yields one statement per approved view", () => {
      expect(statements).toHaveLength(names.length);
    });

    it("sets security_barrier=true on every statement", () => {
      expect(statements.filter((s) => !s.includes("security_barrier=true"))).toEqual([]);
    });

    it("carries the canonical org-role scope fragment in every statement", () => {
      expect(statements.filter((s) => !s.includes(LWQL_ORG_SCOPE_FRAGMENT))).toEqual([]);
    });

    it("exempts the default shared reader role in every statement", () => {
      expect(statements.filter((s) => !s.includes("current_user = 'lwql_ro'"))).toEqual([]);
    });
  });

  describe("when the shared reader role is passed explicitly", () => {
    it("exempts that role instead of the default", () => {
      const rendered = postgresViews.approvedViewStatements({
        schema: "public",
        sharedReaderRole: "custom_shared_ro",
      });

      expect(rendered.filter((s) => !s.includes("current_user = 'custom_shared_ro'"))).toEqual([]);
    });
  });
});
