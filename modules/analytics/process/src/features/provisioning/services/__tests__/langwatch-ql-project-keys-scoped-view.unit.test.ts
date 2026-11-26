/**
 * The Postgres side of a private ClickHouse's key map: a row-scoped copy of each project's key
 * capability in lwql_scoped, granted to the scoped reader group like the other copies.
 * @see specs/lwql/api.feature
 */
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { LangWatchQLCapabilityService } from "../../../../services/langwatch-ql-capability.service.ts";
import {
  LWQL_CURRENT_USER_FRAGMENT,
  LWQL_ORG_MEMBERSHIP_FRAGMENT,
  LWQL_ORG_SCOPE_FRAGMENT,
  LWQL_PROJECT_KEYS_VIEW,
  LWQL_SCOPED_READER_GROUP,
} from "../../rules/lwql-scoped-view.rules.ts";
import { LangWatchQLProductionProvisioningService } from "../langwatch-ql-production-provisioning.service.ts";

const [view = "", grant = ""] =
  LangWatchQLProductionProvisioningService.create().postgresProjectKeysStatements({
    schema: "public",
  });

describe("given the scoped project-keys copy", () => {
  /** @scenario "The Postgres scoped schema carries a row-scoped copy of each project's key capability" */
  it("is a security-barrier view in lwql_scoped carrying the organisation predicate", () => {
    expect(view).toContain(`"lwql_scoped"."${LWQL_PROJECT_KEYS_VIEW}"`);
    expect(view).toContain("security_barrier=true");
    expect(view).toContain(LWQL_ORG_SCOPE_FRAGMENT);
    expect(view).toContain(LWQL_ORG_MEMBERSHIP_FRAGMENT);
    expect(view).toContain(LWQL_CURRENT_USER_FRAGMENT);
  });

  /** @scenario "The Postgres scoped schema carries a row-scoped copy of each project's key capability" */
  it("exposes the project id and the lower-hex sha256 of the key, never the key itself", () => {
    expect(view).toContain(`encode(sha256(convert_to("m"."lwqlKey", 'UTF8')), 'hex') AS "KeyHash"`);
    expect(view).toContain(`"m"."id" AS "TenantId"`);
    // Read twice per body (the hash, the empty-key filter), and the view carries two bodies.
    expect(view.match(/"m"\."lwqlKey"/g)).toHaveLength(4);
    expect(view).not.toMatch(/"m"\."lwqlKey" AS/);
    const projection = view.split("\nFROM")[0] ?? "";
    const exposed = [...projection.matchAll(/ AS "(\w+)"/g)].map((match) => match[1]);
    expect([...new Set(exposed)].toSorted((a, b) => (a ?? "").localeCompare(b ?? ""))).toEqual([
      "KeyHash",
      "TenantId",
    ]);
  });

  /** @scenario "The Postgres scoped schema carries a row-scoped copy of each project's key capability" */
  it("hashes exactly as the app's key map does, so the ClickHouse comparison matches", () => {
    const secret = "sk-lw-example";

    expect(LangWatchQLCapabilityService.create().tenantCapability({ secret })).toBe(
      createHash("sha256").update(secret).digest("hex"),
    );
  });

  /** @scenario "The Postgres scoped schema carries a row-scoped copy of each project's key capability" */
  it("is granted to the scoped reader group only after the scoped-view check", () => {
    expect(grant).toContain(`'${LWQL_PROJECT_KEYS_VIEW}'`);
    expect(grant).toContain("pg_get_viewdef(c.oid)");
    expect(grant).toContain("GRANT SELECT ON");
    const grants = [...grant.matchAll(/GRANT SELECT ON (\S+) TO (\S+?)'/g)];
    expect(grants.map((match) => [match[1], match[2]])).toEqual([
      [`"lwql_scoped"."${LWQL_PROJECT_KEYS_VIEW}"`, `"${LWQL_SCOPED_READER_GROUP}"`],
    ]);
  });
});
