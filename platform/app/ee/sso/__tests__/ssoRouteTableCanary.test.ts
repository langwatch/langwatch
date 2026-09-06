// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * See specs/licensing/sso-license-gating.feature — "A new federating route
 * cannot appear without being classified".
 *
 * `isGatedSsoPath` refuses a hand-maintained set of federation-shaped paths.
 * That set is correct for the better-auth version pinned today, and the rest
 * of `ssoPathGate.test.ts` proves it. What that cannot prove is that the set
 * still covers the route table after an upgrade: a plugin or version bump
 * that mounts a new way to federate a login would pass straight through the
 * DENY branch, reopening the unlicensed-SSO hole with every other test still
 * green.
 *
 * So this asks the library itself what it mounts, and requires every route to
 * carry a reviewed classification. An added, renamed or removed route fails
 * here by name, which is the moment a human has to decide whether it
 * federates.
 *
 * This is the canary over the PREDICATE. Its twin, over the enforcement
 * backstop the `before` hook became (ADR-117 §4), lives at
 * `src/server/better-auth/__tests__/ssoRouteTableCanary.test.ts` and reads the
 * same table from `support/betterAuthRouteTable.ts`.
 *
 * Deliberately a `.test.ts` (unit bucket) despite constructing a real
 * better-auth instance: it is hermetic — memory adapter, no DB, no network —
 * so it must not pay for the integration globalSetup.
 */

import { describe, expect, it } from "vitest";
import { isGatedSsoPath } from "../ssoPathGate";
import {
  concreteUrl,
  ROUTE_CLASSIFICATION,
  registeredRoutes,
} from "./support/betterAuthRouteTable";

describe("better-auth route table (ADR-027 gate coverage canary)", () => {
  describe("given the routes better-auth actually mounts", () => {
    /** @scenario A new federating route cannot appear without being classified */
    it("classifies every one of them as federating or local", () => {
      const mounted = registeredRoutes().map((route) => route.path);
      const classified = Object.keys(ROUTE_CLASSIFICATION);

      const unclassified = mounted.filter((p) => !classified.includes(p));
      const stale = classified.filter((p) => !mounted.includes(p));

      // Named rather than counted: the failure message has to say which route
      // appeared, because deciding whether it federates is the whole point.
      expect({ unclassified, stale }).toEqual({ unclassified: [], stale: [] });
    });
  });

  describe("when the gate is asked about each mounted route", () => {
    it("refuses exactly the federating ones", () => {
      const verdicts = registeredRoutes().map((route) => ({
        path: route.path,
        gated: isGatedSsoPath(concreteUrl(route.path)),
      }));

      const expected = verdicts.map((v) => ({
        path: v.path,
        gated: ROUTE_CLASSIFICATION[v.path] === "federating",
      }));

      expect(verdicts).toEqual(expected);
    });

    it("reaches the same verdict for the trailing-slash form the router accepts", () => {
      for (const route of registeredRoutes()) {
        expect({
          path: route.path,
          gated: isGatedSsoPath(
            concreteUrl(route.path, { trailingSlash: true }),
          ),
        }).toEqual({
          path: route.path,
          gated: ROUTE_CLASSIFICATION[route.path] === "federating",
        });
      }
    });
  });
});
