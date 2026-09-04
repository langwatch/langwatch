/**
 * The deprecated `/api/suites` family, as an integrator finds it in the
 * published description.
 *
 * The wire says the family moved on every response; the document has to say it
 * too, because a reader generating a client from the description never sees a
 * response header. Generated here through `generateOpenApiDocument` over the
 * same enumeration the process mounts, so an operation that stops carrying the
 * mark fails here rather than against a list this file also owns.
 *
 * @see specs/api-reference/suites-legacy-alias.feature
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import {
  generateOpenApiDocument,
  type GeneratedOpenApiDocument,
} from "../openapi-document.generator";

/** Every operation the family publishes, at the address the document uses. */
const OPERATIONS = [
  ["get", "/api/v1/suites"],
  ["post", "/api/v1/suites"],
  ["get", "/api/v1/suites/{id}"],
  ["patch", "/api/v1/suites/{id}"],
  ["delete", "/api/v1/suites/{id}"],
  ["post", "/api/v1/suites/{id}/duplicate"],
  ["post", "/api/v1/suites/{id}/run"],
] as const;

let generated: GeneratedOpenApiDocument;

beforeAll(async () => {
  const scratchDir = await mkdtemp(join(tmpdir(), "langwatch-suites-alias-openapi-"));
  generated = await generateOpenApiDocument({
    outputPath: join(scratchDir, "generated.json"),
  });
});

describe("given the suites alias", () => {
  describe("when the generated OpenAPI document is read", () => {
    /** @scenario "The suites operations are marked deprecated in the document" */
    it.each(OPERATIONS)("marks %s %s deprecated and names its successors", (method, path) => {
      const operation = generated.document.paths?.[path]?.[method] as
        | { deprecated?: boolean; description?: string }
        | undefined;

      expect(operation?.deprecated).toBe(true);
      expect(operation?.description).toContain("/api/v1/run-plans");
      expect(operation?.description).toContain("/api/v1/test-suites");
    });
  });
});
