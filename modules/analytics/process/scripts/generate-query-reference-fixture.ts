/** Regenerates the MCP server's committed query-reference fixture. */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { MAX_LWQL_LENGTH } from "@langwatch/analytics-contract";
import { DEFAULT_LWQL_RESOURCE_LIMITS } from "@langwatch/analytics-contract/langwatch-ql-limits";
import { TRACE_FILTER_EXAMPLES } from "@langwatch/trace-contract";

import { DEFAULT_LWQL_RESULT_LIMITS } from "../src/rules/langwatch-ql-result-limits.rules.ts";
import { cataloguePermissions } from "../src/rules/lwql-catalogue.rules.ts";
import { LWQL_CATALOG, LWQL_VIEW_CATALOG } from "../src/rules/lwql-view-catalog.rules.ts";
import { buildQueryReference } from "../src/rules/query-reference.rules.ts";
import { LangWatchQLSchemaService } from "../src/services/langwatch-ql-schema.service.ts";

/** An explicit output path (first argument) writes there instead, to compare with MCP's copy. */
const FIXTURE_PATH =
  process.argv[2] ??
  fileURLToPath(
    new URL(
      "../../../../mcp/typescript/src/__tests__/fixtures/query-reference.json",
      import.meta.url,
    ),
  );

/** The widest document: every gate held, so no example is dropped. */
const EVERYTHING = {
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
  canSeeCosts: true,
  catalogue: { permissions: cataloguePermissions({ catalog: LWQL_CATALOG }) },
};

const DATABASE = "analytics";

function main(): void {
  const reference = buildQueryReference({
    protections: EVERYTHING,
    lwqlEnabled: true,
    database: DATABASE,
    schema: LangWatchQLSchemaService.create().describe({
      database: DATABASE,
      protections: EVERYTHING,
      views: LWQL_VIEW_CATALOG,
      isInstantEvalsEnabled: false,
    }),
    limits: {
      maxStatementLength: MAX_LWQL_LENGTH,
      maxRowsReturned: DEFAULT_LWQL_RESULT_LIMITS.maxRows,
      maxResultBytes: DEFAULT_LWQL_RESULT_LIMITS.maxResultBytes,
      maxExecutionTimeSeconds: DEFAULT_LWQL_RESOURCE_LIMITS.maxExecutionTimeSeconds,
    },
    traceFilterExamples: TRACE_FILTER_EXAMPLES,
  });

  mkdirSync(dirname(FIXTURE_PATH), { recursive: true });
  writeFileSync(FIXTURE_PATH, `${JSON.stringify(reference, null, 2)}\n`);
  console.log(`wrote ${FIXTURE_PATH}`);
}

main();
