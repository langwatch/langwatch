/**
 * The MCP server renders `GET /api/v1/query/reference` from a committed fixture; this pins that
 * fixture to what this module builds. Regenerate with `generate:query-reference-fixture`.
 * @see specs/analytics/query-reference.feature
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { MAX_LWQL_LENGTH, type LangWatchQLProtections } from "@langwatch/analytics-contract";
import { DEFAULT_LWQL_RESOURCE_LIMITS } from "@langwatch/analytics-contract/langwatch-ql-limits";
import { TRACE_FILTER_EXAMPLES } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { DEFAULT_LWQL_RESULT_LIMITS } from "../../services/langwatch-ql-executor.service.ts";
import { LangWatchQLSchemaService } from "../../services/langwatch-ql-schema.service.ts";
import { LWQL_VIEW_CATALOG } from "../lwql-view-catalog.rules.ts";
import { buildQueryReference } from "../query-reference.rules.ts";

const MCP_FIXTURE_PATH = fileURLToPath(
  new URL(
    "../../../../../../mcp/typescript/src/__tests__/fixtures/query-reference.json",
    import.meta.url,
  ),
);

const EVERYTHING: LangWatchQLProtections = {
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
  canSeeCosts: true,
};

const DATABASE = "analytics";

describe("the MCP server's committed reference fixture", () => {
  /** @scenario "The MCP server's committed reference fixture matches the platform" */
  it("equals the reference this module builds with no permission withheld", () => {
    const reference = buildQueryReference({
      protections: EVERYTHING,
      lwqlEnabled: true,
      database: DATABASE,
      schema: LangWatchQLSchemaService.create().describe({
        database: DATABASE,
        protections: EVERYTHING,
        views: LWQL_VIEW_CATALOG,
      }),
      limits: {
        maxStatementLength: MAX_LWQL_LENGTH,
        maxRowsReturned: DEFAULT_LWQL_RESULT_LIMITS.maxRows,
        maxResultBytes: DEFAULT_LWQL_RESULT_LIMITS.maxResultBytes,
        maxExecutionTimeSeconds: DEFAULT_LWQL_RESOURCE_LIMITS.maxExecutionTimeSeconds,
      },
      traceFilterExamples: TRACE_FILTER_EXAMPLES,
    });

    expect(`${JSON.stringify(reference, null, 2)}\n`).toBe(readFileSync(MCP_FIXTURE_PATH, "utf-8"));
  });
});
