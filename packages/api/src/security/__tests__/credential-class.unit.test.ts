/**
 * Which credential class each route publishes, and where it comes from.
 *
 * The class is derived from the app a route is mounted on rather than
 * declared per route, so these assert the derivation rather than a list: a
 * list would agree with itself forever while the apps moved underneath it.
 *
 * The other half of this question — whether the published API description
 * agrees with what the mounts enforce — is asserted against the committed
 * document, which belongs to the application rather than to this package.
 *
 * Spec: specs/security/api-endpoint-authorization.feature
 */
import { describe, expect, it } from "vitest";

import {
  anyAuthenticated,
  apiKeyPermission,
  credentialClassFor,
  type HandlerCredential,
  handlerManagedAuth,
  internalSecret,
  publicEndpoint,
  requires,
} from "../access-policy.js";
import {
  documentedPathOf,
  isHttpMethod,
  securityForCredentialClass,
} from "../openapi-security.js";

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
      expect(credentialClassFor({ scope: "service", policy: anyAuthenticated() })).toBe(
        "internal",
      );
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
          policy: internalSecret("the collector authenticates by shared secret"),
        }),
      ).toBe("internal");
    });
  });

  describe("given a handler-managed route on each app, for each credential", () => {
    const handlerManaged = (credential: HandlerCredential) =>
      handlerManagedAuth({
        reason: "the handler resolves the caller itself",
        permissions: [],
        credential,
      });

    // Every combination, because the derivation reads the credential for two
    // of the four values and the app scope for the other two, and a pair that
    // falls between them is exactly how a route ends up publishing a class
    // nothing enforces.
    it.each([
      { scope: "project", credential: "apiKey", expected: "project_api_key" },
      { scope: "project", credential: "both", expected: "project_api_key" },
      { scope: "project", credential: "session", expected: "session" },
      { scope: "project", credential: "internal", expected: "internal" },
      {
        scope: "organization",
        credential: "apiKey",
        expected: "organization_api_key",
      },
      {
        scope: "organization",
        credential: "both",
        expected: "organization_api_key",
      },
      { scope: "organization", credential: "session", expected: "session" },
      { scope: "organization", credential: "internal", expected: "internal" },
      { scope: "service", credential: "session", expected: "session" },
      { scope: "service", credential: "internal", expected: "internal" },
      // The receiver surface: the collector, the three OTLP signals,
      // annotations and the legacy trace and evaluation routes all sit on a
      // service app and resolve X-Auth-Token in the handler. Falling through
      // to the service app's own answer would call our most widely integrated
      // endpoints shared-secret routes.
      { scope: "service", credential: "apiKey", expected: "project_api_key" },
      { scope: "service", credential: "both", expected: "project_api_key" },
      { scope: "session", credential: "apiKey", expected: "project_api_key" },
      { scope: "session", credential: "both", expected: "project_api_key" },
    ] as const)(
      "a $scope app taking $credential publishes $expected",
      ({ scope, credential, expected }) => {
        expect(credentialClassFor({ scope, policy: handlerManaged(credential) })).toBe(
          expected,
        );
      },
    );
  });
});

describe("isHttpMethod", () => {
  describe("given the members a Path Item can hold", () => {
    it("names the eight operations and nothing else", () => {
      for (const method of [
        "get",
        "put",
        "post",
        "delete",
        "options",
        "head",
        "patch",
        "trace",
      ]) {
        expect(isHttpMethod(method)).toBe(true);
        expect(isHttpMethod(method.toUpperCase())).toBe(true);
      }
      // `servers` and `parameters` are arrays, so a walker that decides by
      // `typeof === "object"` treats them as operations and stamps `security`
      // onto them, which is a document that no longer validates.
      for (const member of ["servers", "parameters", "summary", "description", "$ref"]) {
        expect(isHttpMethod(member)).toBe(false);
      }
    });
  });
});

describe("documentedPathOf", () => {
  describe("given a route path Hono can register", () => {
    it("renames a plain parameter to the document's spelling", () => {
      expect(documentedPathOf("/api/prompts/:id")).toBe("/api/prompts/{id}");
      expect(documentedPathOf("/api/prompts/:id/versions/:versionId")).toBe(
        "/api/prompts/{id}/versions/{versionId}",
      );
    });

    it("drops the pattern a parameter is pinned to", () => {
      // The whole reason the eight prompt and evaluator operations went
      // unstamped: `{.+}` is matcher syntax, and carrying it through produced
      // a path no documented operation is keyed by.
      expect(documentedPathOf("/api/prompts/:id{.+}")).toBe("/api/prompts/{id}");
      expect(documentedPathOf("/api/prompts/:id{.+?}/versions")).toBe(
        "/api/prompts/{id}/versions",
      );
      expect(documentedPathOf("/api/prompts/:id{.+?}/versions/:versionId/restore")).toBe(
        "/api/prompts/{id}/versions/{versionId}/restore",
      );
      expect(documentedPathOf("/api/evaluators/:idOrSlug{.+}")).toBe(
        "/api/evaluators/{idOrSlug}",
      );
    });

    it("consumes a quantifier inside the pattern rather than stopping at it", () => {
      // A pattern may carry braces of its own. Stopping at the first `}` would
      // leave the remainder in the path and reintroduce the same mismatch.
      expect(documentedPathOf("/api/things/:code{[0-9]{3}}")).toBe("/api/things/{code}");
    });

    it("leaves a path without parameters alone", () => {
      expect(documentedPathOf("/api/gateway/v1/spend-summaries")).toBe(
        "/api/gateway/v1/spend-summaries",
      );
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
