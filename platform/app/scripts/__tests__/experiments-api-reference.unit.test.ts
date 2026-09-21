/**
 * @vitest-environment node
 *
 * The experiments REST surface, as an integrator finds it.
 *
 * This reads the committed document and the docs page generator rather than a
 * fixture, because the defect it guards against lives in exactly that pair. A
 * customer evaluating LangWatch read the API reference, found no way to create
 * an experiment, and concluded the REST API could not do it — while
 * `POST /api/experiment/init`, the call every SDK makes first, had been serving
 * traffic the whole time. Nothing was broken; it had simply never been
 * annotated, never been imported by the spec generator, and so never reached a
 * page.
 *
 * A unit test over a synthetic document could not have caught that, and cannot
 * catch it coming back. These assertions are deliberately about the real files.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LANGWATCH_ROOT = resolve(__dirname, "../..");
const REPO_ROOT = resolve(LANGWATCH_ROOT, "../..");

const document = JSON.parse(
  readFileSync(
    join(LANGWATCH_ROOT, "src/app/api/openapiLangWatch.json"),
    "utf8",
  ),
) as {
  paths: Record<
    string,
    Record<
      string,
      {
        requestBody?: unknown;
        responses?: Record<
          string,
          { content?: Record<string, { schema?: unknown }> }
        >;
      }
    >
  >;
};

const pageGeneratorSource = readFileSync(
  join(REPO_ROOT, "docs/scripts/generate-api-reference-pages.ts"),
  "utf8",
);

/** The round trip an integrator automating experiments has to make. */
const OPERATIONS = [
  ["post", "/api/experiment/init"],
  ["get", "/api/experiments"],
  ["post", "/api/experiments/{slug}/run"],
  ["get", "/api/experiments/runs"],
  ["get", "/api/experiments/runs/{runId}"],
  ["get", "/api/experiments/runs/{runId}/results"],
] as const;

describe("the experiments REST API", () => {
  describe("given the generated OpenAPI document", () => {
    /** @scenario "Every experiment endpoint is in the document" */
    it.each(OPERATIONS)("describes %s %s", (method, path) => {
      expect(document.paths[path]?.[method]).toBeDefined();
    });

    /** @scenario "Creating an experiment is documented" */
    it("gives the create endpoint a request body and a success schema", () => {
      const create = document.paths["/api/experiment/init"]?.post;

      expect(create?.requestBody).toBeDefined();

      const success = Object.entries(create?.responses ?? {}).filter(
        ([status]) => /^2\d\d$/.test(status),
      );
      expect(success.length).toBeGreaterThan(0);
      expect(
        success.some(([, response]) =>
          Object.values(response.content ?? {}).some(
            (media) => media?.schema !== undefined,
          ),
        ),
      ).toBe(true);
    });

    describe("when an endpoint authenticates with a browser session", () => {
      /** @scenario "The session-only execution endpoints stay unpublished" */
      it("keeps it out of the document", () => {
        // Both are the workbench's own controls. `execute` in particular has a
        // body validator, which is enough metadata for the generator to publish
        // it by accident — it is held back explicitly, not by omission.
        expect(document.paths["/api/experiments/execute"]).toBeUndefined();
        expect(document.paths["/api/experiments/abort"]).toBeUndefined();
      });
    });
  });

  describe("given the API reference page generator", () => {
    /** @scenario "Experiments have a reference section a reader can navigate to" */
    it("gives every experiment operation a page in the reference", () => {
      // Assert on the pages themselves rather than on the generator's prefix
      // list: the defect was a reader finding nothing to click, and a page is
      // what that reader finds. A source-substring check would also have gone
      // red the moment the group legitimately took on another prefix.
      const referenced = new Set(
        readdirSync(join(REPO_ROOT, "docs/api-reference/experiments"))
          .filter((file) => file.endsWith(".mdx"))
          .flatMap((file) => {
            const page = readFileSync(
              join(REPO_ROOT, "docs/api-reference/experiments", file),
              "utf8",
            );
            return /^openapi:\s*"([^"]+)"/m.exec(page)?.[1] ?? [];
          }),
      );

      for (const [method, path] of OPERATIONS) {
        expect(referenced).toContain(`${method.toUpperCase()} ${path}`);
      }
    });

    it("no longer lists any experiment path as undocumented", () => {
      const skipBlock = pageGeneratorSource.slice(
        pageGeneratorSource.indexOf("const SKIP_PATHS"),
        pageGeneratorSource.indexOf("const ENDPOINT_GROUPS"),
      );

      expect(skipBlock).not.toContain("/api/experiment");
    });
  });
});
