/**
 * @vitest-environment node
 * The operator lookup's page sits in the operator tree and asks only its own queries.
 * Spec: specs/identity/platform-ops-identity-lookup.feature
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf-8");

const LOOKUP_SOURCES = {
  view: read("../ui/sections/identity-lookup-view.tsx"),
  drawer: read("../ui/sections/identity-lookup-drawer.tsx"),
};

describe("given the operator lookup and the organization identity surface", () => {
  describe("when the two are compared", () => {
    /** @scenario "The operator lookup shares no page, address or query with the organization surface" */
    it("declares its page in the operator tree behind the operator permission", () => {
      const declaration = read("../../../ops.web.ts");

      expect(declaration).toMatch(/"pages\/ops\/identity-lookup": \{\s*requires: "ops:manage",/);
      expect(declaration).not.toMatch(/"pages\/settings\/[^"]*identity-lookup"/);
    });

    /** @scenario "The operator lookup shares no page, address or query with the organization surface" */
    it("asks only its own identityLookup queries and imports nothing from the organization", () => {
      for (const [name, source] of Object.entries(LOOKUP_SOURCES)) {
        const namespaces = [...source.matchAll(/\bapi\.(\w+)\./g)].map((match) => match[1]);

        expect(namespaces.length, `${name} reads nothing through api`).toBeGreaterThan(0);
        expect(new Set(namespaces), `${name} asks another namespace`).toEqual(
          new Set(["identityLookup"]),
        );
        expect(source).not.toMatch(
          /from "@langwatch\/(organization|enterprise-sso|enterprise-scim)/,
        );
      }
    });
  });
});
