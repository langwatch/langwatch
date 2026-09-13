/**
 * `docs/api-reference/query/overview.mdx`, pinned against the query door's
 * real contract (issue #8085, AC6/AC9/AC10).
 *
 * Path resolution follows the same convention as
 * `~/app/api/traces/[[...route]]/__tests__/update-metadata.unit.test.ts`:
 * `__dirname` resolved up to the repo root, then into `docs/`.
 *
 * @see specs/analytics/lwql-query-door-self-describing.feature
 * @see /docs/api-reference/query/overview.mdx
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_LWQL_RESULT_LIMITS } from "~/server/analytics/lwql";
import { LWQL_ALLOWED_FUNCTION_NAMES } from "~/server/analytics/lwql/validation/functions";

// src/app/api/query/__tests__ -> platform/app (5 levels) -> repo root (2 levels)
const DOCS_PATH = path.resolve(
  __dirname,
  "../../../../../../..",
  "docs/api-reference/query/overview.mdx",
);

function readDocs(): string {
  return fs.readFileSync(DOCS_PATH, "utf-8");
}

describe("docs/api-reference/query/overview.mdx", () => {
  it("exists at the expected path", () => {
    expect(fs.existsSync(DOCS_PATH), DOCS_PATH).toBe(true);
  });

  describe("the Authentication section", () => {
    const content = readDocs();

    /** @scenario "The query docs describe every credential form and the project header rule" */
    it("documents X-Auth-Token", () => {
      expect(content).toContain("X-Auth-Token");
    });

    it("documents Authorization: Bearer", () => {
      expect(content).toMatch(/Authorization:\s*Bearer/);
    });

    it("documents Authorization: Basic base64(projectId:token)", () => {
      expect(content).toMatch(/Authorization:\s*Basic/);
      expect(content).toMatch(/base64\(projectId:token\)/);
    });

    it("documents the X-Project-Id header", () => {
      expect(content).toContain("X-Project-Id");
    });

    it("states that an organization key must send X-Project-Id or Basic auth with a project id", () => {
      expect(content).toMatch(/organization (?:API )?key/i);
      expect(content).toMatch(/X-Project-Id/);
    });

    it("states that a project key ignores the X-Project-Id header", () => {
      expect(content).toMatch(/project key/i);
      expect(content).toMatch(/ignores?/i);
    });
  });

  describe("the error table", () => {
    /** @scenario "The query docs describe every credential form and the project header rule" */
    it("lists project_scope_required", () => {
      expect(readDocs()).toContain("project_scope_required");
    });
  });

  describe("the Supported functions section", () => {
    const content = readDocs();

    /**
     * The backtick-delimited names on the section's BULLET lines only — never
     * the intro paragraph, whose backticks name `functions`,
     * `FUNCTION_NOT_ALLOWED` and the schema endpoint. Parsing the whole file
     * with `toContain` would pass vacuously for short names like `and`, `or`,
     * `in` and `if`, which appear in ordinary prose; a set built from the list
     * itself asserts set-equality — no extras, none missing.
     */
    const documentedFunctionNames = (): Set<string> => {
      const afterHeading = content.split(/^## Supported functions$/m)[1] ?? "";
      const section = afterHeading.split(/^## /m)[0] ?? "";
      const names = new Set<string>();
      for (const line of section.split("\n")) {
        if (!line.trimStart().startsWith("-")) continue;
        for (const match of line.matchAll(/`([^`]+)`/g)) {
          names.add(match[1]!);
        }
      }
      return names;
    };

    /** @scenario "The docs list every allowed function name, kept equal to the validator's allowlist" */
    it("states the list is served by GET /api/v1/query/schema", () => {
      expect(content).toMatch(/Supported functions/i);
      expect(content).toContain("GET /api/v1/query/schema");
    });

    /** @scenario "The docs list every allowed function name, kept equal to the validator's allowlist" */
    it("lists exactly the names the validator allows — no extras, none missing", () => {
      expect(documentedFunctionNames()).toEqual(
        new Set(LWQL_ALLOWED_FUNCTION_NAMES),
      );
    });
  });

  describe("the response ceilings", () => {
    const content = readDocs();

    /** @scenario "The query docs and OpenAPI description state the response ceilings" */
    it("states the row cap derived from DEFAULT_LWQL_RESULT_LIMITS", () => {
      expect(content).toContain(
        `${DEFAULT_LWQL_RESULT_LIMITS.maxRows.toLocaleString("en-US")} rows`,
      );
    });

    it("states the byte cap derived from DEFAULT_LWQL_RESULT_LIMITS", () => {
      expect(content).toContain(
        `${DEFAULT_LWQL_RESULT_LIMITS.maxResultBytes.toLocaleString("en-US")} bytes`,
      );
    });

    it("describes the top-level truncated field", () => {
      expect(content).toContain("truncated");
    });

    it("describes the RESULT_TRUNCATED diagnostic and its meta.maxRows", () => {
      expect(content).toContain("RESULT_TRUNCATED");
      expect(content).toContain("maxRows");
    });
  });
});
