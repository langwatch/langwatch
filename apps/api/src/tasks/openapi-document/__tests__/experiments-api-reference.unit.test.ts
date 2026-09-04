/**
 * The experiments REST surface, as an integrator finds it.
 *
 * The document is generated here through `generateOpenApiDocument`, over the
 * same `createApiProcessRestFeatures` enumeration the process mounts, so an
 * endpoint that stops being mounted or stops carrying `describeRoute` fails
 * here rather than being described by a list this file also owns.
 *
 * The defect this guards against was a customer reading the API reference,
 * finding no way to create an experiment, and concluding the REST API could
 * not do it — while `POST /api/experiment/init`, the call every SDK makes
 * first, had been serving traffic the whole time.
 *
 * See specs/api-reference/experiments-rest-api.feature.
 */
import { readdirSync, readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import {
  generateOpenApiDocument,
  type GeneratedOpenApiDocument,
} from "../openapi-document.generator";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const EXPERIMENTS_PAGES = join(REPO_ROOT, "docs/api-reference/experiments");

/**
 * The round trip an integrator automating experiments has to make, at the
 * canonical address the document publishes: every family is described under
 * `/api/v1`, so the spec's `/api/experiment/init` is documented here.
 */
const OPERATIONS = [
  ["post", "/api/v1/experiment/init"],
  ["get", "/api/v1/experiments"],
  ["post", "/api/v1/experiments/{slug}/run"],
  ["get", "/api/v1/experiments/runs"],
  ["get", "/api/v1/experiments/runs/{runId}"],
  ["get", "/api/v1/experiments/runs/{runId}/results"],
] as const;

let generated: GeneratedOpenApiDocument;

beforeAll(async () => {
  const scratchDir = await mkdtemp(join(tmpdir(), "langwatch-experiments-openapi-"));
  generated = await generateOpenApiDocument({
    outputPath: join(scratchDir, "generated.json"),
  });
});

describe("given the experiments REST API", () => {
  describe("when the generated OpenAPI document is read", () => {
    /** @scenario "Every experiment endpoint is in the document" */
    it.each(OPERATIONS)("describes %s %s", (method, path) => {
      expect(generated.document.paths?.[path]?.[method]).toBeDefined();
    });

    /** @scenario "Creating an experiment is documented" */
    it("gives the create endpoint a request body and a success schema", () => {
      const create = generated.document.paths?.["/api/v1/experiment/init"]?.post as
        | {
            requestBody?: unknown;
            responses?: Record<string, { content?: Record<string, { schema?: unknown }> }>;
          }
        | undefined;

      expect(create?.requestBody).toBeDefined();

      const success = Object.entries(create?.responses ?? {}).filter(([status]) =>
        /^2\d\d$/.test(status),
      );
      expect(success.length).toBeGreaterThan(0);
      expect(
        success.some(([, response]) =>
          Object.values(response.content ?? {}).some((media) => media?.schema !== undefined),
        ),
      ).toBe(true);
    });

    describe("when an endpoint authenticates with a browser session", () => {
      /** @scenario "The session-only execution endpoints stay unpublished" */
      it("keeps it out of the document", () => {
        // Both are the workbench's own controls. `execute` in particular has a
        // body validator, which is enough metadata for the generator to publish
        // it by accident — it is held back explicitly, not by omission.
        for (const path of [
          "/api/experiments/execute",
          "/api/v1/experiments/execute",
          "/api/experiments/abort",
          "/api/v1/experiments/abort",
        ]) {
          expect(generated.document.paths?.[path]).toBeUndefined();
        }
      });
    });
  });

  describe("when the API reference pages are generated", () => {
    /** @scenario "Experiments have a reference section a reader can navigate to" */
    it("gives every experiment operation a page in the reference", () => {
      // Assert on the pages themselves rather than on the generator's prefix
      // list: the defect was a reader finding nothing to click, and a page is
      // what that reader finds.
      const referenced = new Set(
        readdirSync(EXPERIMENTS_PAGES)
          .filter((file) => file.endsWith(".mdx"))
          .flatMap((file) => {
            const page = readFileSync(join(EXPERIMENTS_PAGES, file), "utf8");
            return /^openapi:\s*"([^"]+)"/m.exec(page)?.[1] ?? [];
          }),
      );

      for (const [method, path] of OPERATIONS) {
        expect(referenced).toContain(`${method.toUpperCase()} ${path}`);
      }
    });

    it("no longer lists any experiment path as undocumented", () => {
      const source = readFileSync(
        join(REPO_ROOT, "docs/scripts/generate-api-reference-pages.ts"),
        "utf8",
      );
      const skipBlock = source.slice(
        source.indexOf("const SKIP_PATHS"),
        source.indexOf("const ENDPOINT_GROUPS"),
      );

      expect(skipBlock).not.toContain("/api/experiment");
    });
  });
});
