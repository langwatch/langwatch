/**
 * The OpenAPI document the deprecated /api/suites alias publishes, generated from its declaration.
 * @see specs/api-reference/suites-legacy-alias.feature
 * @vitest-environment node
 */
import type { RestIdentity } from "@langwatch/api/hosting";
import { buildOpenApiDocument } from "@langwatch/api/hosting";
import { RestHost, type RestTransportDeclaration } from "@langwatch/api/rest";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { createSuitesAliasRest } from "../suites-alias.rest.ts";

const documentSchema = z.object({
  paths: z.record(
    z.string(),
    z.record(
      z.string(),
      z.looseObject({ deprecated: z.boolean().optional(), description: z.string().optional() }),
    ),
  ),
});
type Document = z.infer<typeof documentSchema>;

const refuse = () => {
  throw new Error("the test describes routes and answers no request");
};

const closed: RestIdentity = {
  authenticate: refuse,
  identify: refuse,
  identifyOptional: refuse,
  authorize: refuse,
};

async function generate(): Promise<Document> {
  const family = createSuitesAliasRest().router() as RestTransportDeclaration<unknown>;
  const facts = new Map<string, { middleware: { name: string }; resolve: () => never }>();
  for (const route of family.routes) {
    for (const fact of route.middleware ?? []) {
      facts.set(fact.name, { middleware: fact, resolve: refuse });
    }
  }

  const rest = RestHost.create({
    identities: {
      project: closed,
      organization: closed,
      api_key: closed,
      scim_token: closed,
      instance_admin: closed,
      browser: closed,
    },
    bearers: () => closed,
    audit: { record: async () => {} },
    idempotency: refuse,
    rateLimiter: { check: refuse },
    facts: [...facts.values()] as never,
    entitlements: { holds: refuse },
  });
  rest.mount(family, refuse);

  return documentSchema.parse(await buildOpenApiDocument(rest.app));
}

describe("given the suites alias mounted for description only", () => {
  let document: Document;

  beforeAll(async () => {
    document = await generate();
  });

  describe("when the generated OpenAPI document is read", () => {
    /** @scenario "The suites operations are marked deprecated in the document" */
    it("marks every /api/suites operation deprecated and names the run plans and test suites families", () => {
      const operations = Object.entries(document.paths)
        .filter(([path]) => /^\/api\/(v1\/)?suites(\/|$)/.test(path))
        .flatMap(([path, methods]) =>
          Object.entries(methods).map(([method, operation]) => ({ path, method, operation })),
        );

      expect(operations.length).toBeGreaterThan(0);
      for (const { operation } of operations) {
        expect(operation.deprecated).toBe(true);
        expect(operation.description).toContain("/api/v1/run-plans");
        expect(operation.description).toContain("/api/v1/test-suites");
      }
    });
  });
});
