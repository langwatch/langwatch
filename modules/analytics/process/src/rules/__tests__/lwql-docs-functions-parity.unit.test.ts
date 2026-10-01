/**
 * The query docs' Supported functions list is the validator's allowlist, name for name.
 * @see specs/lwql/query-errors.feature
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { LWQL_ALLOWED_FUNCTION_NAMES } from "../langwatch-ql-functions.rules.ts";

const DOCS_PATH = fileURLToPath(
  new URL("../../../../../../docs/api-reference/query/overview.mdx", import.meta.url),
);

const content = readFileSync(DOCS_PATH, "utf-8");

function documentedFunctionNames(): Set<string> {
  const afterHeading = content.split(/^## Supported functions$/m)[1] ?? "";
  const section = afterHeading.split(/^## /m)[0] ?? "";
  const names = new Set<string>();
  for (const line of section.split("\n")) {
    if (!line.trimStart().startsWith("-")) continue;
    for (const match of line.matchAll(/`([^`]+)`/g)) {
      if (match[1]) names.add(match[1]);
    }
  }
  return names;
}

describe("given the LangWatchQL docs page and the validator's function allowlist", () => {
  describe("when the Supported functions section is read", () => {
    /** @scenario "The docs list every allowed function name, kept equal to the validator's allowlist" */
    it("states the list is served by GET /api/v1/query/schema", () => {
      expect(content).toMatch(/^## Supported functions$/m);
      expect(content).toContain("GET /api/v1/query/schema");
    });

    /** @scenario "The docs list every allowed function name, kept equal to the validator's allowlist" */
    it("lists exactly the names the validator allows, no extras and none missing", () => {
      expect(documentedFunctionNames()).toEqual(new Set(LWQL_ALLOWED_FUNCTION_NAMES));
    });
  });
});
