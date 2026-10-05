/**
 * The OpenAPI document the experiment REST families publish, generated from their declarations.
 * Spec: specs/api-reference/experiments-rest-api.feature.
 * @vitest-environment node
 */
import type { RestIdentity } from "@langwatch/api/hosting";
import { buildOpenApiDocument } from "@langwatch/api/hosting";
import { RestHost, type RestTransportDeclaration } from "@langwatch/api/rest";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { experimentDspyStepsRest } from "../experiment-dspy-steps.rest.ts";
import { experimentInitRest } from "../experiment-init.rest.ts";
import {
  experimentV3LegacyRest,
  experimentWorkbenchRunLegacyRest,
} from "../experiment-v3-legacy.rest.ts";
import { experimentV3Rest } from "../experiment-v3.rest.ts";
import { experimentWorkbenchRunRest } from "../experiment-workbench-run.rest.ts";
import { experimentRest } from "../experiment.rest.ts";

const documentSchema = z.object({
  paths: z.record(
    z.string(),
    z.record(
      z.string(),
      z.looseObject({
        requestBody: z.unknown().optional(),
        responses: z.record(z.string(), z.unknown()).optional(),
      }),
    ),
  ),
});
type Document = z.infer<typeof documentSchema>;

/** The document names each route once, at the `/api/v1` twin of the bare path a caller may use. */
function publishedAt(path: string): string {
  return path.replace(/^\/api\//, "/api/v1/");
}

const refuse = () => {
  throw new Error("the test describes routes and answers no request");
};

const closed: RestIdentity = {
  authenticate: refuse,
  identify: refuse,
  identifyOptional: refuse,
  authorize: refuse,
};

const families = [
  experimentV3Rest,
  experimentRest,
  experimentInitRest,
  experimentDspyStepsRest,
  experimentWorkbenchRunRest,
  experimentV3LegacyRest,
  experimentWorkbenchRunLegacyRest,
].map((family) => family.router() as RestTransportDeclaration<unknown>);

/** The document, with every middleware fact the families name left unanswerable. */
async function generate(): Promise<Document> {
  const facts = new Map<string, { middleware: { name: string }; resolve: () => never }>();
  for (const family of families) {
    for (const route of family.routes) {
      for (const fact of route.middleware ?? []) {
        facts.set(fact.name, { middleware: fact, resolve: refuse });
      }
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
  for (const family of families) rest.mount(family, refuse);

  return documentSchema.parse(await buildOpenApiDocument(rest.app));
}

describe("given the experiment families mounted for description only", () => {
  let document: Document;

  beforeAll(async () => {
    document = await generate();
  });

  describe("when the generated OpenAPI document is read", () => {
    /** @scenario "Creating an experiment is documented" */
    it("declares init's request body and a 2xx response carrying a schema", () => {
      const init = document.paths[publishedAt("/api/experiment/init")]?.post;

      expect(init?.requestBody).toBeDefined();

      const successes = Object.entries(init?.responses ?? {}).filter(([status]) =>
        /^2\d\d$/.test(status),
      );
      expect(successes).not.toEqual([]);
      for (const [, response] of successes) {
        expect(JSON.stringify(response)).toContain('"schema"');
      }
    });

    /** @scenario "Every experiment endpoint is in the document" */
    it.each([
      ["post", "/api/experiment/init"],
      ["get", "/api/experiments"],
      ["post", "/api/experiments/{slug}/run"],
      ["get", "/api/experiments/runs"],
      ["get", "/api/experiments/runs/{runId}"],
      ["get", "/api/experiments/runs/{runId}/results"],
    ])("publishes %s %s", (method, path) => {
      expect(document.paths[publishedAt(path)]?.[method]).toBeDefined();
    });

    /** @scenario "The session-only execution endpoints stay unpublished" */
    it("leaves execute and abort out of the document", () => {
      for (const path of ["/api/experiments/execute", "/api/experiments/abort"]) {
        expect(document.paths[path]).toBeUndefined();
        expect(document.paths[publishedAt(path)]).toBeUndefined();
      }
    });
  });
});
