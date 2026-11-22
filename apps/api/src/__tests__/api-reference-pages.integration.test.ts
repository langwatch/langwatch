/**
 * The API reference pages the docs publish for the generated OpenAPI document.
 * @vitest-environment node
 * @see specs/api-reference/experiments-rest-api.feature
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { generateOpenApiDocument } from "../openapi-document.ts";

type Json = Record<string, unknown>;

const DOCS = join(import.meta.dirname, "../../../../docs");
const METHODS = ["get", "post", "put", "patch", "delete"] as const;

/** The `METHOD /path` the page's front matter documents, or null for a page with none. */
function documentedBy(page: string): string | null {
  const source = readFileSync(join(DOCS, `${page}.mdx`), "utf8");
  return /^openapi:\s*"([^"]+)"/m.exec(source)?.[1] ?? null;
}

/** The pages of the navigation group of that name whose pages live under the reference. */
function referencePagesOf(group: string): string[] {
  const navigation = JSON.parse(readFileSync(join(DOCS, "docs.json"), "utf8")) as unknown;
  const found: string[][] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (typeof node !== "object" || node === null) return;
    const record = node as Json;
    if (record.group === group && Array.isArray(record.pages)) {
      const pages = record.pages.filter((page): page is string => typeof page === "string");
      if (pages.some((page) => page.startsWith("api-reference/"))) found.push(pages);
    }
    Object.values(record).forEach(visit);
  };
  visit(navigation);

  return found.flat();
}

describe("the API reference generated from the OpenAPI document", () => {
  let operations: string[];

  beforeAll(async () => {
    const document = (await generateOpenApiDocument()) as { paths: Record<string, Json> };
    operations = Object.entries(document.paths).flatMap(([path, item]) =>
      path.startsWith("/api/v1/experiment")
        ? METHODS.filter((method) => item[method] !== undefined).map(
            (method) => `${method.toUpperCase()} ${path}`,
          )
        : [],
    );
  }, 240_000);

  describe("given the experiment endpoints the document publishes", () => {
    /** @scenario "Experiments have a reference section a reader can navigate to" */
    it("lists a page in the Experiments group for every one of them", () => {
      const pages = referencePagesOf("Experiments");
      const documented = new Set(pages.map(documentedBy));

      expect(operations).not.toEqual([]);
      expect(operations.filter((operation) => !documented.has(operation))).toEqual([]);
      for (const page of pages) {
        if (page.endsWith("/overview")) continue;
        expect(documentedBy(page), page).toMatch(/^[A-Z]+ \/api\/v1\/(experiment|dspy)/);
      }
    });
  });
});
