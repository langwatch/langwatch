/**
 * SCIM 2.0 as an identity administrator finds it in the API reference. The routes served
 * identity providers for as long as SCIM has shipped while the reference said nothing
 * about them.
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { UNSERVED_AT_BASELINE } from "../openapi-document.checker";
import {
  generateOpenApiDocument,
  type GeneratedOpenApiDocument,
} from "../openapi-document.generator";

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

let generated: GeneratedOpenApiDocument;
let operations: { key: string; method: string; path: string }[];

beforeAll(async () => {
  const scratchDir = await mkdtemp(join(tmpdir(), "langwatch-scim-openapi-"));
  generated = await generateOpenApiDocument({
    outputPath: join(scratchDir, "generated.json"),
  });

  operations = generated.servedRoutes
    .filter((route) => route.includes(SCIM_PREFIX) && !route.includes("*"))
    .map((route) => {
      const [method, path] = route.split(" ");
      return {
        key: `${method!.toUpperCase()} ${path!}`,
        method: method!.toLowerCase(),
        path: path!,
      };
    })
    .sort((left, right) => left.key.localeCompare(right.key));
});

const operationIn = (method: string, path: string): Operation | undefined =>
  generated.document.paths?.[path]?.[method] as Operation | undefined;

describe("given the SCIM 2.0 REST API", () => {
  describe("when the generated OpenAPI document is read", () => {
    /** @scenario "Every SCIM route is documented in the API reference" */
    it("documents every registered route with a chosen id, an honest credential, and no exclusion", () => {
      // Discovery, six User operations and six Group operations. The count is
      // asserted so a route registered without a describeRoute cannot pass by
      // simply not being enumerated on both sides of the comparison.
      expect(operations).toHaveLength(15);

      const missing = operations
        .filter(({ method, path }) => operationIn(method, path) === undefined)
        .map(({ key }) => key);
      expect(
        missing,
        `SCIM routes registered but absent from the document:\n${missing.join("\n")}`,
      ).toEqual([]);

      // A derived id is built from the method and the URL segments. Those
      // become the generated SDKs' function names, which is why each is chosen.
      for (const { method, path, key } of operations) {
        const operationId = operationIn(method, path)?.operationId;
        expect(operationId, `${key} has no operationId`).toBeDefined();
        expect(operationId, `${key} looks derived from its URL`).toMatch(/^scim[A-Z]/);
      }
      const ids = operations.map(({ method, path }) => operationIn(method, path)?.operationId);
      expect(new Set(ids).size).toBe(ids.length);

      const schemes = (
        generated.document.components as { securitySchemes?: Record<string, unknown> } | undefined
      )?.securitySchemes;
      expect(schemes?.scim_bearer).toBeDefined();

      const provisioning = operations.filter(({ key }) => !DISCOVERY_OPERATIONS.includes(key));
      expect(provisioning).toHaveLength(12);
      for (const { method, path, key } of provisioning) {
        expect(operationIn(method, path)?.security, key).toEqual([{ scim_bearer: [] }]);
      }

      // Not silence: the document carries a root-level security requirement,
      // so a discovery operation declaring nothing would inherit the project
      // API key and publish a credential it neither wants nor checks.
      for (const key of DISCOVERY_OPERATIONS) {
        const [method, path] = key.split(" ");
        expect(operationIn(method!.toLowerCase(), path!)?.security, key).toEqual([]);
      }

      expect(UNSERVED_AT_BASELINE.filter((entry) => entry.includes(SCIM_PREFIX))).toEqual([]);
      expect(
        generated.unpublishable.filter(({ operation }) => operation.includes(SCIM_PREFIX)),
      ).toEqual([]);
    });

    it("documents the refusals an identity provider has to handle", () => {
      const provisioning = operations.filter(({ key }) => !DISCOVERY_OPERATIONS.includes(key));

      for (const { method, path, key } of provisioning) {
        const responses = operationIn(method, path)?.responses ?? {};
        expect(Object.keys(responses), key).toEqual(expect.arrayContaining(["401", "403"]));
      }
    });

    it("resolves every security scheme any operation names", () => {
      // Whole-document, because adding the SCIM bearer is what made a third
      // scheme possible and the failure is silent either way: an operation
      // naming a scheme the document never declares renders as an endpoint
      // nobody can authenticate.
      const declared = new Set(
        Object.keys(
          (generated.document.components as { securitySchemes?: Record<string, unknown> })
            ?.securitySchemes ?? {},
        ),
      );

      const named = new Set(
        Object.values(generated.document.paths ?? {}).flatMap((item) =>
          Object.values(item).flatMap((operation) =>
            ((operation as Operation).security ?? []).flatMap((requirement) =>
              Object.keys(requirement),
            ),
          ),
        ),
      );

      expect([...named].filter((scheme) => !declared.has(scheme))).toEqual([]);
    });
  });
});
