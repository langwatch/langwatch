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

  describe("when the Authentication section is read", () => {
    const content = readDocs();

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

    /** @scenario "The query docs describe the any-key scope rule and how to narrow to one project" */
    it("states any key reaches every project it holds analytics:view on", () => {
      expect(content).toMatch(/analytics:view/);
      expect(content).toMatch(/organization/i);
    });

    /** @scenario "The query docs describe the any-key scope rule and how to narrow to one project" */
    it("states how to narrow to one project inside the statement", () => {
      expect(content).toMatch(/WHERE\s+TenantId\s*=/);
    });

    /** @scenario "The query docs describe the any-key scope rule and how to narrow to one project" */
    it("documents the MULTI_PROJECT_RESULT diagnostic", () => {
      expect(content).toContain("MULTI_PROJECT_RESULT");
    });

    it("no longer documents the retired X-Project-Id header or project_scope_required", () => {
      expect(content).not.toContain("X-Project-Id");
      expect(content).not.toContain("project_scope_required");
    });
  });

  describe("when the Supported functions section is read", () => {
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

  describe("when the response ceilings are documented", () => {
    const content = readDocs();

    /** @scenario "A statement with no LIMIT is capped at the row ceiling" */
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

    /** @scenario "A statement with no LIMIT is capped at the row ceiling" */
    it("states the default LIMIT is appended and how to page past it", () => {
      expect(content).toContain("LIMIT");
      expect(content).toContain("OFFSET");
      expect(content).toContain("ORDER BY");
    });

    /** @scenario "A LIMIT above the ceiling is refused before the query runs" */
    /** @scenario "A result past the byte ceiling is refused, never cut" */
    it("names the LIMIT_TOO_HIGH refusal and the byte hard error", () => {
      expect(content).toContain("LIMIT_TOO_HIGH");
      expect(content).toContain("lwql_result_too_large");
    });

    /** @scenario "Each UNION branch must carry its own LIMIT ceiling" */
    it("documents LIMIT_REQUIRED_PER_BRANCH for UNION queries", () => {
      expect(content).toContain("LIMIT_REQUIRED_PER_BRANCH");
      expect(content).toContain("UNION");
    });
  });
});
