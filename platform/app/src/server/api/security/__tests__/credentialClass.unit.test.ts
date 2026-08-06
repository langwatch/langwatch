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
} from "../index";

const SPEC_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../app/api/openapiLangWatch.json",
);

/** The surfaces published to external integrators. */
const PUBLIC_PREFIXES = ["/api/gateway/v1", "/api/webhooks/v1"];

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

describe("the published API description", () => {
  describe("given an operation on a public REST surface", () => {
    /** @scenario "Every published operation states its own credential requirement" */
    it("names the credential class rather than inheriting the document default", () => {
      const document = JSON.parse(readFileSync(SPEC_PATH, "utf8")) as {
        paths: Record<string, Record<string, { security?: unknown }>>;
      };

      const inheriting: string[] = [];
      const byScheme = new Map<string, number>();
      for (const [path, item] of Object.entries(document.paths)) {
        if (!PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix)))
          continue;
        for (const [method, operation] of Object.entries(item)) {
          if (!operation || typeof operation !== "object") continue;
          if (!Array.isArray(operation.security)) {
            inheriting.push(`${method.toUpperCase()} ${path}`);
            continue;
          }
          for (const requirement of operation.security) {
            for (const scheme of Object.keys(
              requirement as Record<string, unknown>,
            )) {
              byScheme.set(scheme, (byScheme.get(scheme) ?? 0) + 1);
            }
          }
        }
      }

      expect(inheriting).toEqual([]);
      // Both families are present, which is the whole point: the document
      // used to answer project_api_key for every operation, including the
      // organization-scoped ones a project key can never reach.
      expect(byScheme.get("project_api_key")).toBeGreaterThan(0);
      expect(byScheme.get("admin_api_key")).toBeGreaterThan(0);
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
