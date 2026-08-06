/**
 * @vitest-environment node
 *
 * Which credential class each route publishes, and where it comes from.
 *
 * The class is derived from the app a route is mounted on rather than
 * declared per route, so these assert the derivation rather than a list: a
 * list would agree with itself forever while the apps moved underneath it.
 *
 * Spec: specs/security/api-endpoint-authorization.feature
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  anyAuthenticated,
  apiKeyPermission,
  credentialClassFor,
  handlerManagedAuth,
  internalSecret,
  publicEndpoint,
  requires,
  securityForCredentialClass,
} from "../index";

const SPEC_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../app/api/openapiLangWatch.json",
);

/**
 * The surfaces published to external integrators, and the credential family
 * each one belongs to.
 *
 * Written out rather than derived from the route registry, which would need
 * every Hono app imported and would then agree with the generator by
 * construction. The point of asserting against the committed document is to
 * catch it drifting from the code that produced it, so the expectation has to
 * come from somewhere else: the mount. Spend and webhooks are organization
 * apps, the rest of the gateway surface is a project app.
 */
const PUBLIC_SURFACES = [
  { prefix: "/api/webhooks/v1", scheme: "admin_api_key" },
  { prefix: "/api/gateway/v1/spend-summaries", scheme: "admin_api_key" },
  { prefix: "/api/gateway/v1/spend-events", scheme: "admin_api_key" },
  { prefix: "/api/gateway/v1/end-users", scheme: "admin_api_key" },
  { prefix: "/api/gateway/v1", scheme: "project_api_key" },
] as const;

/** The first surface whose prefix the path starts with; order is longest-first. */
const surfaceFor = (path: string) =>
  PUBLIC_SURFACES.find((surface) => path.startsWith(surface.prefix));

describe("credentialClassFor", () => {
  describe("given routes mounted on each kind of app", () => {
    /** @scenario "A route publishes the credential class it actually enforces" */
    it("follows the app the route is mounted on", () => {
      expect(
        credentialClassFor({
          scope: "project",
          policy: apiKeyPermission("gatewayBudgets:view"),
        }),
      ).toBe("project_api_key");
      expect(
        credentialClassFor({
          scope: "organization",
          policy: requires("gatewaySpend:view"),
        }),
      ).toBe("organization_api_key");
      expect(
        credentialClassFor({ scope: "service", policy: anyAuthenticated() }),
      ).toBe("internal");
    });

    it("says session when the handler authenticates a browser session", () => {
      expect(
        credentialClassFor({
          scope: "project",
          policy: handlerManagedAuth({
            reason: "reads the browser session itself",
            permissions: [],
            credential: "session",
          }),
        }),
      ).toBe("session");
    });

    it("says none for a route that is open on purpose", () => {
      expect(
        credentialClassFor({
          scope: "service",
          policy: publicEndpoint("a health probe carries no tenant data"),
        }),
      ).toBe("none");
    });

    it("says internal for a shared-secret route, whatever app it sits on", () => {
      expect(
        credentialClassFor({
          scope: "project",
          policy: internalSecret(
            "the collector authenticates by shared secret",
          ),
        }),
      ).toBe("internal");
    });
  });
});

describe("securityForCredentialClass", () => {
  describe("given a credential class an API client can present", () => {
    it("names the scheme for that key family", () => {
      expect(
        securityForCredentialClass({
          operationKey: "GET /api/gateway/v1/budgets",
          credentialClass: "project_api_key",
        }),
      ).toEqual([{ project_api_key: [] }]);
      expect(
        securityForCredentialClass({
          operationKey: "GET /api/gateway/v1/spend-summaries",
          credentialClass: "organization_api_key",
        }),
      ).toEqual([{ admin_api_key: [] }]);
    });

    it("publishes no requirement for a route that is open on purpose", () => {
      expect(
        securityForCredentialClass({
          operationKey: "GET /api/health",
          credentialClass: "none",
        }),
      ).toEqual([]);
    });
  });

  describe("given a credential class no API client can present", () => {
    /** @scenario "An operation no API client can authenticate is never published" */
    it("refuses to publish the operation, and names it", () => {
      for (const credentialClass of ["session", "internal"] as const) {
        expect(() =>
          securityForCredentialClass({
            operationKey: "POST /api/gateway/v1/example",
            credentialClass,
          }),
        ).toThrow(/POST \/api\/gateway\/v1\/example/);
      }
      // An empty requirement is OpenAPI for "no credential needed", so
      // publishing one here would tell every generated client to call these
      // unauthenticated.
      expect(() =>
        securityForCredentialClass({
          operationKey: "POST /api/gateway/v1/example",
          credentialClass: "session",
        }),
      ).toThrow(/no security scheme an API client can satisfy/);
    });
  });
});

describe("the published API description", () => {
  describe("given an operation on a public REST surface", () => {
    /** @scenario "Every published operation states its own credential requirement" */
    it("names the credential class rather than inheriting the document default", () => {
      const document = JSON.parse(readFileSync(SPEC_PATH, "utf8")) as {
        paths: Record<string, Record<string, { security?: unknown }>>;
      };

      // Every operation is checked against the family its mount puts it in,
      // rather than counted. A count passes while an organization endpoint
      // publishes the project key, as long as some other operation still
      // publishes the organization one, and that operation is precisely the
      // one an integrator would then fail on.
      const wrong: string[] = [];
      const seenSchemes = new Set<string>();
      let checked = 0;
      for (const [path, item] of Object.entries(document.paths)) {
        const surface = surfaceFor(path);
        if (!surface) continue;
        for (const [method, operation] of Object.entries(item)) {
          if (!operation || typeof operation !== "object") continue;
          checked += 1;
          const expected = [{ [surface.scheme]: [] }];
          if (
            JSON.stringify(operation.security ?? null) !==
            JSON.stringify(expected)
          ) {
            wrong.push(
              `${method.toUpperCase()} ${path} published ${JSON.stringify(
                operation.security ?? null,
              )}, expected ${JSON.stringify(expected)}`,
            );
            continue;
          }
          seenSchemes.add(surface.scheme);
        }
      }

      expect(wrong).toEqual([]);
      expect(checked).toBeGreaterThan(0);
      // Both families are present, which is the whole point: the document
      // used to answer project_api_key for every operation, including the
      // organization-scoped ones a project key can never reach.
      expect([...seenSchemes].sort()).toEqual([
        "admin_api_key",
        "project_api_key",
      ]);
    });

    it("gives the spend and webhook routes the organization key", () => {
      const document = JSON.parse(readFileSync(SPEC_PATH, "utf8")) as {
        paths: Record<string, Record<string, { security?: unknown }>>;
      };

      // The four routes the last dogfood ran a project key at, plus the
      // webhook collection it registers against.
      for (const path of [
        "/api/gateway/v1/spend-summaries",
        "/api/gateway/v1/spend-events",
        "/api/webhooks/v1/endpoints",
      ]) {
        expect(document.paths[path]?.get?.security).toEqual([
          { admin_api_key: [] },
        ]);
      }
    });
  });
});
