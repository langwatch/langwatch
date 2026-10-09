#!/usr/bin/env tsx
/**
 * Regenerates the MCP server's committed query-reference fixture.
 *
 * The MCP server renders `GET /api/v1/query/reference` into markdown for an
 * agent, and its tests need a payload to render. Hand-writing one would make it
 * a second description of the reference — the exact drift the reference exists
 * to end — so it is generated from `describeQueryReference` and pinned by
 * `server/analytics/query-reference/__tests__/query-reference.unit.test.ts`,
 * which fails when the committed file and the builder disagree.
 *
 * Built with every permission held, so the fixture exercises the widest
 * document: the narrow cases are covered by the builder's own unit tests, and a
 * fixture missing the gated examples would let the renderer drop them silently.
 *
 * Usage:
 *   pnpm generate:query-reference-fixture
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_LWQL_DATABASE } from "../src/server/analytics/lwql/lwql.service";
import { describeQueryReference } from "../src/server/analytics/query-reference";
import type { Protections } from "../src/server/traces/protections";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const FIXTURE_PATH = resolve(
  REPO_ROOT,
  "mcp/typescript/src/__tests__/fixtures/query-reference.json",
);

const EVERYTHING = {
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
  canSeeCosts: true,
} as Protections;

const reference = describeQueryReference({
  protections: EVERYTHING,
  lwqlEnabled: true,
  database: DEFAULT_LWQL_DATABASE,
});

mkdirSync(dirname(FIXTURE_PATH), { recursive: true });
writeFileSync(FIXTURE_PATH, `${JSON.stringify(reference, null, 2)}\n`, "utf-8");
console.log(`Wrote ${FIXTURE_PATH}`);
