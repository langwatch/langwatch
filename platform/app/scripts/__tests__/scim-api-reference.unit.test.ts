/**
 * @vitest-environment node
 *
 * @see specs/api-reference/scim-api-reference.feature
 *
 * SCIM as an identity administrator finds it in the API reference.
 *
 * The routes have served identity providers for as long as SCIM has shipped,
 * and the reference said nothing about them: the coverage gate carried
 * `/api/scim/v2` as its one written gap. So the assertions here are about the
 * real route file and the real committed document, not a fixture. Reading the
 * registrations out of the source is what makes a sixteenth route fail this
 * test on the day it is added rather than the day a customer asks where it is
 * documented.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { UNPUBLISHED } from "../openapi-route-exclusions";
import {
  apiBasePathsOf,
  collectRouteRegistrations,
  honoPathToTemplate,
  joinRoutePath,
} from "../lib/hono-route-table";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LANGWATCH_ROOT = resolve(__dirname, "../..");

const SCIM_PREFIX = "/api/scim/v2";

/** The three endpoints RFC 7644 puts outside authentication. */
const DISCOVERY_OPERATIONS = [
  "GET /api/scim/v2/ServiceProviderConfig",
  "GET /api/scim/v2/ResourceTypes",
  "GET /api/scim/v2/Schemas",
];

interface Operation {
  operationId?: string;
  security?: Record<string, string[]>[];
  responses?: Record<string, unknown>;
}

const document = JSON.parse(
  readFileSync(
    join(LANGWATCH_ROOT, "src/app/api/openapiLangWatch.json"),
    "utf8",
  ),
) as {
  paths: Record<string, Record<string, Operation>>;
  components: { securitySchemes: Record<string, unknown> };
};

/**
 * Every route the SCIM app registers, spelled the way the document spells a
 * path: `METHOD /api/scim/v2/Users/{id}`.
 */
const registeredOperations = (): {
  key: string;
  method: string;
  path: string;
  described: boolean;
}[] => {
  const source = readFileSync(
    join(LANGWATCH_ROOT, "ee/scim/routes.ts"),
    "utf8",
  );
  const basePath = apiBasePathsOf(source)[0];
  if (basePath !== SCIM_PREFIX) {
    throw new Error(
      `ee/scim/routes.ts declares basePath ${basePath ?? "none"}; this test ` +
        `reads its registrations relative to ${SCIM_PREFIX}`,
    );
  }

  return collectRouteRegistrations(source).map((registration) => {
    const path = honoPathToTemplate(
      joinRoutePath({ basePath, routePath: registration.path }),
    );
    return {
      key: `${registration.method.toUpperCase()} ${path}`,
      method: registration.method,
      path,
      described: registration.described,
    };
  });
};

const OPERATIONS = registeredOperations();

const operationIn = (method: string, path: string): Operation | undefined =>
  document.paths[path]?.[method];

describe("the SCIM 2.0 REST API", () => {
  describe("given the generated OpenAPI document", () => {
    /** @scenario "Every SCIM route is documented in the API reference" */
    it("publishes every route the SCIM app registers", () => {
      // Discovery, six User operations and six Group operations. The count is
      // asserted so a route added without a describeRoute cannot pass by
      // simply not being enumerated on both sides of the comparison.
      expect(OPERATIONS).toHaveLength(15);

      const missing = OPERATIONS.filter(
        ({ method, path }) => operationIn(method, path) === undefined,
      ).map(({ key }) => key);

      expect(
        missing,
        `These SCIM routes are registered but absent from the document. ` +
          `Describe them in ee/scim/openapi.ts, attach describeRoute in ` +
          `ee/scim/routes.ts, and regenerate:\n${missing.join("\n")}`,
      ).toEqual([]);
    });

    it("annotates every SCIM route in the source, which is what lets the generator see it", () => {
      const undescribed = OPERATIONS.filter(({ described }) => !described).map(
        ({ key }) => key,
      );
      expect(undescribed).toEqual([]);
    });

    it("names every operation rather than letting the generator derive one", () => {
      // A derived id is built from the method and the URL segments, so it
      // starts with the verb and spells out the path shape. Those become the
      // Python SDK's function names, which is why each is chosen by hand.
      for (const { method, path, key } of OPERATIONS) {
        const operationId = operationIn(method, path)?.operationId;
        expect(operationId, `${key} has no operationId`).toBeDefined();
        expect(operationId, `${key} looks derived from its URL`).toMatch(
          /^scim[A-Z]/,
        );
      }

      const ids = OPERATIONS.map(
        ({ method, path }) => operationIn(method, path)?.operationId,
      );
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("declares the SCIM bearer credential on every provisioning operation", () => {
      expect(document.components.securitySchemes.scim_bearer).toBeDefined();

      const provisioning = OPERATIONS.filter(
        ({ key }) => !DISCOVERY_OPERATIONS.includes(key),
      );
      expect(provisioning).toHaveLength(12);

      for (const { method, path, key } of provisioning) {
        expect(operationIn(method, path)?.security, key).toEqual([
          { scim_bearer: [] },
        ]);
      }
    });

    it("declares no credential on the discovery operations", () => {
      // Not silence: the document carries a root-level security requirement,
      // so an operation that declares nothing inherits the project API key and
      // publishes a credential these three endpoints neither want nor check.
      for (const key of DISCOVERY_OPERATIONS) {
        const [method, path] = key.split(" ");
        expect(
          operationIn(method!.toLowerCase(), path!)?.security,
          key,
        ).toEqual([]);
      }
    });

    it("documents the refusals an identity provider has to handle", () => {
      const provisioning = OPERATIONS.filter(
        ({ key }) => !DISCOVERY_OPERATIONS.includes(key),
      );

      for (const { method, path, key } of provisioning) {
        const responses = operationIn(method, path)?.responses ?? {};
        expect(Object.keys(responses), key).toEqual(
          expect.arrayContaining(["401", "403"]),
        );
      }
    });

    it("resolves every security scheme any operation names", () => {
      // Whole-document, because adding the SCIM bearer is what made a third
      // scheme possible and the failure is silent either way: an operation
      // naming a scheme the document never declares renders as an endpoint
      // nobody can authenticate, and a client generator resolving
      // `#/components/securitySchemes/...` finds nothing there.
      const declared = new Set(
        Object.keys(document.components.securitySchemes),
      );

      const named = new Set(
        Object.values(document.paths).flatMap((item) =>
          Object.values(item).flatMap((operation) =>
            (operation.security ?? []).flatMap((requirement) =>
              Object.keys(requirement),
            ),
          ),
        ),
      );

      const dangling = [...named].filter((scheme) => !declared.has(scheme));
      expect(
        dangling,
        `These security schemes are required by an operation but never ` +
          `declared. Add them through the family's spec options, the way ` +
          `SCIM_SPEC_OPTIONS declares scim_bearer:\n${dangling.join("\n")}`,
      ).toEqual([]);
    });
  });

  describe("given the route-coverage gate", () => {
    it("no longer lists any SCIM path as deliberately unpublished", () => {
      const entries = UNPUBLISHED.filter((exclusion) =>
        exclusion.match.includes(SCIM_PREFIX),
      );
      expect(entries).toEqual([]);
    });
  });
});
