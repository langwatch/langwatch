/**
 * 3-reactor smoke evidence script.
 *
 * Brings up ALL THREE governance reactors end-to-end:
 *   - gatewayBudgetSync.reactor → gateway_budget_ledger_events
 *   - governanceKpisSync.reactor → governance_kpis
 *   - governanceOcsfEventsSync.reactor → governance_ocsf_events
 *
 * Strategy: bypass the live LLM call (which adds Bifrost provider-resolution
 * complexity that's tangential to reactor evidence) and instead POST a
 * synthetic OTLP-shaped trace to /api/otel/v1/traces with the exact span
 * attributes the production gateway's customer-trace-bridge emits
 * (services/aigateway/adapters/gatewaytracer/attrs.go). The OTLP path is
 * the production gateway's path — REST collector doesn't accumulate generic
 * attributes into the fold state, so the reactors only fire on OTLP-fed
 * traces. This script proves the full pipeline (collector → fold →
 * reactors → ClickHouse) end-to-end with the same shape the production
 * gateway produces.
 *
 * Flow:
 *   1. Seed a fresh org + project + persona-4 admin user + VK + project budget
 *   2. POST a synthetic OTLP trace with langwatch.* gateway attrs
 *   3. Poll CH for evidence
 *   4. Print a JSON summary suitable for the PR description's
 *      §Smoke evidence section
 *
 * Usage (host-side):
 *   docker exec wise-mixing-zebra-app-1 sh -c \
 *     'cd /app && pnpm tsx scripts/dogfood/governance/smoke-3-reactors.ts'
 *
 * Exit code:
 *   0 — all 3 reactors landed at least one row tied to the synthetic trace
 *   1 — any reactor missing evidence after timeout
 */
import { randomBytes } from "crypto";
import { createClient } from "@clickhouse/client";
import { TeamUserRole } from "@prisma/client";

import { prisma } from "../../../src/server/db";
import {
  hashVirtualKeySecret,
  mintVirtualKeySecret,
} from "../../../src/server/gateway/virtualKey.crypto";
import { defaultVirtualKeyConfig } from "../../../src/server/gateway/virtualKey.config";

const APP_BASE_URL = process.env.LANGWATCH_BASE_URL ?? "http://localhost:5560";
const CLICKHOUSE_URL = process.env.CLICKHOUSE_URL ?? "http://default:langwatch@localhost:8123/langwatch";
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
  await prisma.gatewayBudget.create({
    data: {
      id: rid("budget_smoke"),
      organizationId: org.id,
      scopeType: "PROJECT",
      scopeId: project.id,
      projectScopedId: project.id,
      name: "Smoke project budget",
      window: "MONTH",
      limitUsd: "100.00",
      resetsAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      createdById: user.id,
    },
  });
  const secret = mintVirtualKeySecret();
  const hashed = hashVirtualKeySecret(secret);
  const displayPrefix = secret.slice(0, 13);
  const vk = await prisma.virtualKey.create({
    data: {
      id: rid("vk_smoke"),
      organizationId: org.id,
      name: "smoke-vk",
      status: "ACTIVE",
      hashedSecret: hashed,
      displayPrefix,
      principalUserId: user.id,
      config: defaultVirtualKeyConfig() as any,
      createdById: user.id,
      scopes: { create: [{ scopeType: "PROJECT", scopeId: project.id }] },
    },
  });
  return { org, team, project, user, vk };
}

interface SeededState {
  org: { id: string };
  team: { id: string };
  project: { id: string; apiKey: string };
  user: { id: string };
  vk: { id: string };
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
function attrBool(key: string, value: boolean) {
  return { key, value: { boolValue: value } };
}

async function postSyntheticOtlpTrace(seeded: SeededState): Promise<string> {
  // Build an OTLP/JSON payload. Resource = the project; one ResourceSpan with
  // one ScopeSpan containing one Span. Attributes mirror what the production
  // Go gateway emits via services/aigateway/adapters/gatewaytracer/.
  const traceId = hexId(16);
  const spanId = hexId(8);
  const startTimeMs = Date.now() - 1500;
  const endTimeMs = Date.now();
  const startTimeUnixNano = String(BigInt(startTimeMs) * 1_000_000n);
  const endTimeUnixNano = String(BigInt(endTimeMs) * 1_000_000n);

  const payload = {
    resourceSpans: [
      {
        resource: {
          attributes: [
            attrStr("service.name", "smoke-gateway"),
            attrStr("langwatch.organization_id", seeded.org.id),
            attrStr("langwatch.project_id", seeded.project.id),
            attrStr("langwatch.team_id", seeded.team.id),
            attrStr("langwatch.principal_id", seeded.user.id),
          ],
        },
        scopeSpans: [
          {
            scope: { name: "langwatch.gateway" },
            spans: [
              {
                traceId,
                spanId,
                name: "POST /v1/chat/completions",
                kind: 3, // SERVER
                startTimeUnixNano,
                endTimeUnixNano,
                attributes: [
                  // Gateway-origin marker — required by reactors
                  attrStr("langwatch.origin", "gateway"),
                  attrStr("langwatch.virtual_key_id", seeded.vk.id),
                  attrStr("langwatch.organization_id", seeded.org.id),
                  attrStr("langwatch.project_id", seeded.project.id),
                  attrStr("langwatch.team_id", seeded.team.id),
                  attrStr("langwatch.principal_id", seeded.user.id),
                  attrStr("langwatch.gateway_request_id", `req_${hexId(8)}`),
                  attrStr("langwatch.model", "openai/gpt-4o-mini"),
                  attrStr("langwatch.provider", "openai"),
                  attrStr("langwatch.model_source", "OPENAI_DIRECT"),
                  attrStr("langwatch.status", "success"),
                  attrBool("langwatch.streaming", false),
                  attrDouble("langwatch.cost_usd", 0.000048),
                  attrInt("langwatch.duration_ms", endTimeMs - startTimeMs),
                  // Gen-AI semantic conventions
                  attrStr("gen_ai.system", "openai"),
                  attrStr("gen_ai.request.model", "openai/gpt-4o-mini"),
                  attrStr("gen_ai.response.model", "gpt-4o-mini-2024-07-18"),
                  attrInt("gen_ai.usage.input_tokens", 12),
                  attrInt("gen_ai.usage.output_tokens", 4),
                ],
                status: { code: 1 }, // OK
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
    `[smoke] OTLP accepted trace ${traceId} (status ${res.status}): ${text.slice(0, 200)}`,
  );
  return traceId;
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
      name: "gateway_budget_ledger_events",
      query: `SELECT * FROM gateway_budget_ledger_events WHERE TenantId = '${projectId}' LIMIT 1`,
    },
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

async function postSyntheticIngestionSourceTrace(seeded: SeededState): Promise<string> {
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
                  attrStr("langwatch.governance.retention_class", "audit"),
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
  console.log("[smoke] seeding fresh org/project/user/VK + budget…");
  const seeded = await seed();
  console.log(
    `[smoke] seeded: org=${seeded.org.id} project=${seeded.project.id} vk=${seeded.vk.id}`,
  );
  console.log(`[smoke] posting synthetic OTLP gateway trace to /api/otel/v1/traces…`);
  const traceId = await postSyntheticOtlpTrace(seeded);
  console.log(`[smoke] posting synthetic OTLP ingestion-source trace…`);
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
      vkId: seeded.vk.id,
    },
    fired: {
      gatewayTraceId: traceId,
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
