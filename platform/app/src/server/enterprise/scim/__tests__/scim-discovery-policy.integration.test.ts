// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 *
 * @see specs/api-reference/scim-api-reference.feature
 *
 * The three SCIM discovery endpoints answer anyone, and the route registry has
 * to say so. They were declared `internalSecret("SCIM bearer token validated
 * in-handler")` alongside the provisioning routes, which is a claim about a
 * check no discovery handler makes: an identity provider reads the service
 * provider configuration while it is being set up, before a token exists, and
 * these handlers hand it over with no credential at all.
 *
 * A policy nobody enforces is worse than no policy, because every audit that
 * reads the registry to answer "what is open to the internet?" walks past it.
 * So this drives the real app with no credentials AND reads the policy back,
 * and only both together are the guarantee: either half on its own can be true
 * while the registry lies.
 */
import { describe, expect, it } from "vitest";
import { appContextBindingsFor } from "~/app/api/middleware/app-context";
import { getRoutePolicy } from "~/server/api/security";
import { createTestApp } from "~/server/app-layer/presets";
import { app } from "../routes";

const requestApp = createTestApp();

const DISCOVERY_PATHS = [
  "/api/scim/v2/ServiceProviderConfig",
  "/api/scim/v2/ResourceTypes",
  "/api/scim/v2/Schemas",
] as const;

describe("Feature: SCIM 2.0 is published in the API reference", () => {
  describe("given the SCIM discovery endpoints", () => {
    /** @scenario "SCIM discovery endpoints declare an honest public policy" */
    it.each(DISCOVERY_PATHS)(
      "answers %s without credentials, and declares itself public",
      async (path) => {
        const response = await app.request(
          path,
          undefined,
          appContextBindingsFor(requestApp),
        );

        expect(response.status).toBe(200);
        const body = (await response.json()) as { schemas: string[] };
        expect(body.schemas[0]).toMatch(/^urn:ietf:params:scim:/);

        const policy = getRoutePolicy("GET", path)?.policy;
        expect(policy, `${path} must declare an access policy`).toBeDefined();
        expect(policy?.kind).toBe("public");
        expect(policy?.kind === "public" ? policy.reason : "").toBe(
          "SCIM discovery metadata is served without a credential so identity providers can negotiate capabilities before a token exists",
        );
      },
    );

    it("keeps the provisioning routes declared internal in the registry", () => {
      // The counterpart the public declaration is only safe next to: opening
      // discovery says nothing about Users and Groups, and this is what keeps
      // a future edit from widening the policy to the whole family.
      const provisioning = getRoutePolicy("GET", "/api/scim/v2/Users")?.policy;

      expect(provisioning?.kind).toBe("internal");
    });

    it("refuses an anonymous call to a provisioning route", async () => {
      const response = await app.request(
        "/api/scim/v2/Users",
        undefined,
        appContextBindingsFor(requestApp),
      );

      expect(response.status).toBe(401);
      expect(response.headers.get("content-type")).toContain("application/scim+json");
    });
  });
});
