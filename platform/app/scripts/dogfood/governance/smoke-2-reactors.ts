/**
 * 2-reactor smoke evidence script.
 *
 * Brings up BOTH governance reactors end-to-end:
 *   - governanceKpisSync.reactor → governance_kpis
 *   - governanceOcsfEventsSync.reactor → governance_ocsf_events
 *
 * Strategy: bypass the live LLM call (which adds Bifrost provider-resolution
 * complexity that's tangential to reactor evidence) and instead POST a
 * synthetic OTLP-shaped trace to /api/otel/v1/traces carrying the
 * ingestion-source markers both reactors gate on. The OTLP path is the
 * production path. The REST collector doesn't accumulate generic
 * attributes into the fold state, so the reactors only fire on OTLP-fed
 * traces. This script proves the full pipeline (collector → fold →
 * reactors → ClickHouse) end-to-end.
 *
 * Budget debits are deliberately absent: they do not ride a trace at all.
 * The gateway emits spend commands and the debits process manager writes
 * the ledger, which budgetEnforcement.integration.test.ts covers.
 *
 * Flow:
 *   1. Seed a fresh org + project + persona-4 admin user
 *   2. POST a synthetic OTLP ingestion-source trace
 *   3. Poll CH for evidence
 *   4. Print a JSON summary suitable for the PR description's
 *      §Smoke evidence section
 *
 * Usage (host-side):
 *   pnpm tsx scripts/dogfood/governance/smoke-2-reactors.ts
 *
 * Exit code:
 *   0: both reactors landed at least one row tied to the synthetic trace
 *   1: any reactor missing evidence after timeout
 */

import { createClient } from "@clickhouse/client";
import { randomBytes } from "crypto";
import { TeamUserRole } from "../../../src/generated/prisma/client";

import { prisma } from "../../../src/server/db";

const APP_BASE_URL = process.env.LANGWATCH_BASE_URL ?? "http://localhost:5560";
const CLICKHOUSE_URL =
  process.env.CLICKHOUSE_URL ??
  "http://default:langwatch@localhost:8123/langwatch";
const POLL_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 3_000;

function rid(prefix: string) {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

function hexId(bytes: number) {
  return randomBytes(bytes).toString("hex");
}

async function seed() {
  const slug = `sergey-smoke-${Date.now()}`;
  const org = await prisma.organization.create({
    data: {
      id: rid("org_smoke"),
      name: "ACME Smoke Test",
      slug,
      phoneNumber: "+1-555-0100",
    },
  });
  const team = await prisma.team.create({
    data: {
      id: rid("team_smoke"),
      name: "Smoke Team",
      slug: `${slug}-team`,
      organizationId: org.id,
    },
  });
  const project = await prisma.project.create({
    data: {
      id: rid("proj_smoke"),
      name: "Smoke Project",
      slug: `${slug}-proj`,
      teamId: team.id,
      language: "en",
      framework: "openai",
      apiKey: `sk-smoke-${randomBytes(16).toString("hex")}`,
    },
  });
  const user = await prisma.user.create({
    data: {
      id: rid("user_smoke"),
      email: `sergey-smoke-${Date.now()}@test.local`,
      name: "Sergey Smoke",
      emailVerified: true,
    },
  });
  await prisma.organizationUser.create({
    data: { userId: user.id, organizationId: org.id, role: "ADMIN" },
  });
  await prisma.teamUser.create({
    data: { userId: user.id, teamId: team.id, role: TeamUserRole.ADMIN },
  });
  return { org, team, project, user };
}

interface SeededState {
  org: { id: string };
  team: { id: string };
  project: { id: string; apiKey: string };
  user: { id: string };
}

function attrStr(key: string, value: string) {
  return { key, value: { stringValue: value } };
}
function attrInt(key: string, value: number) {
  return { key, value: { intValue: value } };
}
function attrDouble(key: string, value: number) {
  return { key, value: { doubleValue: value } };
}

interface ReactorEvidence {
  table: string;
  rowCount: number;
  sample: unknown;
  landed: boolean;
}

async function pollClickHouse(projectId: string): Promise<ReactorEvidence[]> {
  // CH `TenantId` column is the trace-processing tenant id, which is the
  // PROJECT id (not the organization id). Earlier smoke runs polled by
  // org id and consistently returned 0 rows even though reactors had
  // written; that was the smoke-script bug, not a pipeline bug.
  const ch = createClient({ url: CLICKHOUSE_URL, database: "langwatch" });
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  const tables = [
    {
      name: "governance_kpis",
      query: `SELECT * FROM governance_kpis WHERE TenantId = '${projectId}' LIMIT 1`,
    },
    {
      name: "governance_ocsf_events",
      query: `SELECT * FROM governance_ocsf_events WHERE TenantId = '${projectId}' LIMIT 1`,
    },
  ];
  while (Date.now() < deadline) {
    const out: ReactorEvidence[] = [];
    let allLanded = true;
    for (const t of tables) {
      const res = await ch.query({ query: t.query, format: "JSON" });
      const data = (await res.json()) as { data: unknown[] };
      const landed = data.data.length > 0;
      out.push({
        table: t.name,
        rowCount: data.data.length,
        sample: data.data[0] ?? null,
        landed,
      });
      if (!landed) allLanded = false;
    }
    if (allLanded) {
      await ch.close();
      return out;
    }
    process.stdout.write(`.`);
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  const out: ReactorEvidence[] = [];
  for (const t of tables) {
    const res = await ch.query({ query: t.query, format: "JSON" });
    const data = (await res.json()) as { data: unknown[] };
    out.push({
      table: t.name,
      rowCount: data.data.length,
      sample: data.data[0] ?? null,
      landed: data.data.length > 0,
    });
  }
  await ch.close();
  return out;
}

async function postSyntheticIngestionSourceTrace(
  seeded: SeededState,
): Promise<string> {
  // Build an OTLP/JSON payload for an ingestion-source-shaped trace.
  // governanceKpisSync + governanceOcsfEventsSync gate on
  // langwatch.origin.kind=ingestion_source + langwatch.ingestion_source.id.
  // Without these markers they early-return — so the GATEWAY trace
  // shape doesn't fire those two reactors. We need a SECOND synthetic
  // trace shaped like an ingestion-source puller event.
  const traceId = hexId(16);
  const spanId = hexId(8);
  const startTimeMs = Date.now() - 800;
  const endTimeMs = Date.now();
  const startTimeUnixNano = String(BigInt(startTimeMs) * 1_000_000n);
  const endTimeUnixNano = String(BigInt(endTimeMs) * 1_000_000n);
  const ingestionSourceId = `ingsrc_smoke_${hexId(4)}`;

  const payload = {
    resourceSpans: [
      {
        resource: {
          attributes: [
            attrStr("service.name", "smoke-puller"),
            attrStr("langwatch.organization_id", seeded.org.id),
            attrStr("langwatch.project_id", seeded.project.id),
          ],
        },
        scopeSpans: [
          {
            scope: { name: "langwatch.governance.ingest" },
            spans: [
              {
                traceId,
                spanId,
                name: "ingestion.source.event",
                kind: 1, // INTERNAL
                startTimeUnixNano,
                endTimeUnixNano,
                attributes: [
                  // Governance ingestion-source markers required by the
                  // governanceKpisSync + governanceOcsfEventsSync reactors
                  attrStr("langwatch.origin.kind", "ingestion_source"),
                  attrStr("langwatch.ingestion_source.id", ingestionSourceId),
                  attrStr(
                    "langwatch.ingestion_source.organization_id",
                    seeded.org.id,
                  ),
                  attrStr(
                    "langwatch.ingestion_source.source_type",
                    "http_polling",
                  ),
                  attrStr("gen_ai.system", "openai"),
                  attrStr("gen_ai.request.model", "gpt-4o-mini"),
                  attrInt("gen_ai.usage.input_tokens", 25),
                  attrInt("gen_ai.usage.output_tokens", 8),
                  attrDouble("langwatch.cost_usd", 0.000095),
                ],
                status: { code: 1 },
              },
            ],
          },
        ],
      },
    ],
  };

  const url = `${APP_BASE_URL}/api/otel/v1/traces`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Auth-Token": seeded.project.apiKey,
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`OTLP returned ${res.status}: ${text.slice(0, 600)}`);
  }
  console.log(
    `[smoke] OTLP accepted ingestion-source trace ${traceId} (status ${res.status})`,
  );
  return traceId;
}

async function main() {
  console.log("[smoke] seeding fresh org/project/user…");
  const seeded = await seed();
  console.log(
    `[smoke] seeded: org=${seeded.org.id} project=${seeded.project.id}`,
  );
  console.log(
    `[smoke] posting synthetic OTLP ingestion-source trace to /api/otel/v1/traces…`,
  );
  const ingestionTraceId = await postSyntheticIngestionSourceTrace(seeded);
  console.log(
    `[smoke] polling ClickHouse for reactor evidence (timeout ${POLL_TIMEOUT_MS / 1000}s)…`,
  );
  const evidence = await pollClickHouse(seeded.project.id);
  console.log("\n");
  const summary = {
    seeded: {
      orgId: seeded.org.id,
      projectId: seeded.project.id,
    },
    fired: {
      ingestionSourceTraceId: ingestionTraceId,
    },
    reactors: evidence.map((e) => ({
      table: e.table,
      landed: e.landed,
      rowCount: e.rowCount,
      sampleKeys: e.sample ? Object.keys(e.sample as object) : [],
    })),
    overall: evidence.every((e) => e.landed) ? "ALL_LANDED" : "INCOMPLETE",
  };
  console.log(JSON.stringify(summary, null, 2));
  for (const e of evidence) {
    if (e.sample) {
      console.log(`\n--- ${e.table} sample row ---`);
      console.log(JSON.stringify(e.sample, null, 2));
    }
  }
  if (!evidence.every((e) => e.landed)) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[smoke] FAILED:", err);
  process.exit(1);
});
