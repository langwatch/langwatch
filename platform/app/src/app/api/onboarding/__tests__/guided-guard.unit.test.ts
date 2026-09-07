/**
 * The guided onboarding REST routes exist for one caller: Langy, reporting a
 * path as done from inside its own session with the conversation's key. That
 * key never holds the `langy` family and holds only the reads of the auth
 * scope families, so the guard on each route has to be one the delegation
 * policy grants, or the route is unreachable by the very thing it serves.
 *
 * @see specs/features/onboarding/guided-onboarding-variant.feature
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Permission } from "~/server/api/rbac";
import { classifyForLangy } from "~/server/app-layer/langy/langyPermissionPolicy";

const ROUTE_FILE = path.resolve(__dirname, "../[[...route]]/app.ts");

function declaredGuards(): Permission[] {
  const source = readFileSync(ROUTE_FILE, "utf8");
  return [...source.matchAll(/guard\("([a-zA-Z]+:[a-z]+)"\)/g)].map(
    (match) => match[1] as Permission,
  );
}

describe("Feature: guided onboarding variant", () => {
  describe("given Langy reports a path as done with the conversation's key", () => {
    describe("when the guided state and completion routes declare their guards", () => {
      /** @scenario the REST routes are guarded by a permission Langy's own key can hold */
      it("declares only permissions the platform delegates to a Langy session key", () => {
        const guards = declaredGuards();
        expect(guards.length).toBe(2);
        for (const permission of guards) {
          expect({ permission, ...classifyForLangy(permission) }).toMatchObject(
            { permission, disposition: "granted" },
          );
        }
      });
    });
  });
});
