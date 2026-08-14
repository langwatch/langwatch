/**
 * Audio spend probe: proves a character-priced call reaches the budget.
 *
 * The defect this measures (langwatch/langwatch#6934): the gateway measured
 * the characters a speech request synthesized and the spend wire dropped
 * them, so the request rated at zero. Three tts-1 calls worth $0.18 moved a
 * production budget $0.0002.
 *
 * The run, end to end against a locally running stack:
 *
 *   1. Refuse to touch a non-local database, and refuse to run at all when
 *      gateway_spend lacks the quantity columns.
 *   2. Issue a dedicated virtual key with its own budget (WARN, high limit),
 *      so the delta is attributable to this run and nothing else.
 *   3. Three POST /v1/audio/speech calls at EXACTLY 4000 characters, plus
 *      one gpt-4o chat call as a control the fix does not touch.
 *   4. Poll to a deadline for the spend rows, the ledger debits and the
 *      trace cost. No fixed sleeps: the pipeline's latency is not a constant.
 *   5. Assert per-request characters and cost, the ledger's three success
 *      debits, the budget delta, and that the trace explorer and the budget
 *      state the same cost for the same request.
 *
 * Prerequisite: `scripts/dogfood/audio/seed-audio-vk.ts` has run for this
 * user, so the org carries an OpenAI provider key and a default policy that
 * does not filter audio model ids.
 *
 * Usage:
 *   pnpm tsx scripts/dogfood/audio/probe-audio-spend.ts --email you@example.com
 *
 * Options:
 *   --org <id or name>    required when the user belongs to several orgs
 *   --gateway <url>       default http://localhost:5563
 *   --deadline <seconds>  default 60
 *   --allow-remote-db     opt out of the local-database guard
 */

import { PersonalVirtualKeyService } from "@ee/governance/services/personalVirtualKey.service";
import { PersonalWorkspaceService } from "@ee/governance/services/personalWorkspace.service";
import { getClickHouseClientForProject } from "~/server/clickhouse/clickhouseClient";
import { prisma } from "~/server/db";
import { GatewayBudgetClickHouseRepository } from "~/server/gateway/budget.clickhouse.repository";

const SPEECH_MODEL = "openai/tts-1";
const CONTROL_MODEL = "openai/gpt-4o";
const SPEECH_CALLS = 3;
const SPEECH_CHARS = 4000;
/** 4000 characters at tts-1's $15 per million characters. */
const EXPECTED_COST_NANO_USD = 60_000_000;
const REQUIRED_COLUMNS = [
  "CharsInput",
  "AudioMS",
  "TokensCacheWrite1h",
  "TokensInputAudio",
  "TokensOutputAudio",
];
const LOCAL_DB_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

interface Args {
  email: string;
  org: string;
  gateway: string;
  deadlineMs: number;
  allowRemoteDb: boolean;
}

function parseArgs(argv: string[]): Args {
  let email = "";
  let org = "";
  let gateway = process.env.LW_GATEWAY_BASE_URL ?? "http://localhost:5563";
  let deadlineSeconds = 60;
  let allowRemoteDb = false;
  // biome-ignore lint/style/useForOf: flag parser advances the index (argv[++i]) to consume a value; for...of has no index to advance.
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--email") email = argv[++i] ?? "";
    if (argv[i] === "--org") org = argv[++i] ?? "";
    if (argv[i] === "--gateway") gateway = argv[++i] ?? gateway;
    if (argv[i] === "--deadline") deadlineSeconds = Number(argv[++i] ?? 60);
    if (argv[i] === "--allow-remote-db") allowRemoteDb = true;
  }
  if (!email) throw new Error("--email is required");
  return {
    email,
    org,
    gateway: gateway.replace(/\/$/, ""),
    deadlineMs: deadlineSeconds * 1000,
    allowRemoteDb,
  };
}

/**
 * This probe issues a virtual key and a budget, so it only runs against a
 * local database by default. Pointing it at staging or prod by accident
 * would plant credentials on a shared tenant.
 */
function assertLocalDatabase(allowRemoteDb: boolean): void {
  if (allowRemoteDb) return;
  const raw = process.env.DATABASE_URL ?? "";
  let host = "";
  try {
    host = new URL(raw).hostname;
  } catch {
    throw new Error("DATABASE_URL is unset or unparseable, refusing to run");
  }
  if (!LOCAL_DB_HOSTS.has(host)) {
    throw new Error(
      `DATABASE_URL points at ${host}, not a local database. ` +
        "Re-run with --allow-remote-db if you really mean it.",
    );
  }
}

function log(line: string): void {
  process.stderr.write(`[probe-audio-spend] ${line}\n`);
}

async function clickhouse(projectId: string) {
  const client = await getClickHouseClientForProject(projectId);
  if (!client) throw new Error("no ClickHouse client available");
  return client;
}

/**
 * Abort before spending money if the migration has not landed: without the
 * columns the probe would measure the defect it is meant to disprove and
 * blame the code.
 */
async function assertQuantityColumns(projectId: string): Promise<void> {
  const client = await clickhouse(projectId);
  const result = await client.query({
    query: "DESCRIBE TABLE gateway_spend",
    format: "JSONEachRow",
  });
  const rows = (await result.json()) as Array<{ name: string }>;
  const present = new Set(rows.map((r) => r.name));
  const missing = REQUIRED_COLUMNS.filter((c) => !present.has(c));
  if (missing.length > 0) {
    throw new Error(
      `gateway_spend is missing ${missing.join(", ")}. Apply migration ` +
        "00078_gateway_spend_billable_quantities.sql before probing.",
    );
  }
  log(`gateway_spend carries all ${REQUIRED_COLUMNS.length} quantity columns`);
}

/** The user's organization, refusing to guess when there are several. */
async function resolveOrg(args: Args): Promise<{ userId: string; id: string }> {
  const user = await prisma.user.findFirst({ where: { email: args.email } });
  if (!user) throw new Error(`no user with email ${args.email}`);
  const orgs = await prisma.organization.findMany({
    where: { members: { some: { userId: user.id } } },
    select: { id: true, name: true },
  });
  if (orgs.length === 0) throw new Error(`${args.email} belongs to no org`);
  const picked = args.org
    ? orgs.find((o) => o.id === args.org || o.name === args.org)
    : orgs.length === 1
      ? orgs[0]
      : undefined;
  if (!picked) {
    throw new Error(
      `pass --org <id or name>, one of: ${orgs
        .map((o) => `${o.name} [${o.id}]`)
        .join(", ")}`,
    );
  }
  return { userId: user.id, id: picked.id };
}

interface Probe {
  vkSecret: string;
  vkId: string;
  budgetId: string;
  projectId: string;
}

/** A virtual key and a budget of this run's own, so the delta is this run's. */
async function provision(args: Args): Promise<Probe> {
  const { userId, id: organizationId } = await resolveOrg(args);
  const providers = await prisma.modelProvider.count({
    where: { organizationId, provider: "openai", enabled: true },
  });
  if (providers === 0) {
    throw new Error(
      "no enabled OpenAI provider on this org: run " +
        "scripts/dogfood/audio/seed-audio-vk.ts first",
    );
  }

  const workspace = await new PersonalWorkspaceService(prisma).ensure({
    userId,
    organizationId,
    displayName: null,
    displayEmail: args.email,
  });
  const issued = await PersonalVirtualKeyService.create(prisma, {
    gatewayBaseUrl: args.gateway,
  }).issue({
    userId,
    organizationId,
    personalProjectId: workspace.project.id,
    personalTeamId: workspace.team.id,
    label: `audio-spend-probe-${Date.now()}`,
  });

  const budget = await prisma.gatewayBudget.create({
    data: {
      name: `audio-spend-probe-${Date.now()}`,
      organizationId,
      scopeType: "VIRTUAL_KEY",
      scopeId: issued.id,
      window: "MONTH",
      limitUsd: "100",
      // WARN, not BLOCK: the probe measures what a call costs, and a cap
      // that refused one would measure the cap instead.
      onBreach: "WARN",
      createdById: userId,
      resetsAt: new Date(Date.now() + 30 * 86_400_000),
    },
  });

  log(`vk=${issued.id} budget=${budget.id} project=${workspace.project.id}`);
  return {
    vkSecret: issued.secret,
    vkId: issued.id,
    budgetId: budget.id,
    projectId: workspace.project.id,
  };
}

interface Call {
  label: string;
  gatewayRequestId: string;
  traceId: string;
  httpStatus: number;
}

/**
 * The request's identity as the gateway states it on the response.
 *
 * The audio routes do not set X-LangWatch-Trace-Id; they carry W3C
 * `traceparent`, whose second field is the trace id. Both routes always set
 * X-LangWatch-Gateway-Request-Id, which is the spend record's own key, so
 * correlation keys off that and treats the trace id as the extra join into
 * the trace explorer.
 */
function callIdentity(headers: Headers): {
  gatewayRequestId: string;
  traceId: string;
} {
  const gatewayRequestId =
    headers.get("X-LangWatch-Gateway-Request-Id") ??
    headers.get("X-Request-Id") ??
    "";
  const traceparent = headers.get("traceparent") ?? "";
  const traceId =
    headers.get("X-LangWatch-Trace-Id") ?? traceparent.split("-")[1] ?? "";
  return { gatewayRequestId, traceId };
}

async function callGateway(
  probe: Probe,
  gateway: string,
  request: { path: string; label: string; body: unknown },
): Promise<Call> {
  const response = await fetch(`${gateway}${request.path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${probe.vkSecret}`,
    },
    body: JSON.stringify(request.body),
  });
  if (!response.ok) {
    throw new Error(
      `${request.label} failed: HTTP ${response.status} ${await response.text()}`,
    );
  }
  await response.arrayBuffer();
  const { gatewayRequestId, traceId } = callIdentity(response.headers);
  if (!gatewayRequestId) {
    throw new Error(`${request.label}: no gateway request id header`);
  }
  log(`${request.label} ok, request ${gatewayRequestId} trace ${traceId}`);
  return {
    label: request.label,
    gatewayRequestId,
    traceId,
    httpStatus: response.status,
  };
}

/** Exactly 4000 characters, so the expected cost is one exact integer. */
function speechInput(): string {
  const text = "The quick brown fox jumps over the lazy dog. ".repeat(200);
  return text.slice(0, SPEECH_CHARS);
}

async function runCalls(probe: Probe, gateway: string): Promise<Call[]> {
  const calls: Call[] = [];
  const input = speechInput();
  if (input.length !== SPEECH_CHARS) {
    throw new Error(`speech input is ${input.length} chars, want 4000`);
  }
  for (let i = 1; i <= SPEECH_CALLS; i++) {
    calls.push(
      await callGateway(probe, gateway, {
        path: "/v1/audio/speech",
        label: `speech-${i}`,
        body: { model: SPEECH_MODEL, input, voice: "alloy" },
      }),
    );
  }
  calls.push(
    await callGateway(probe, gateway, {
      path: "/v1/chat/completions",
      label: "control",
      body: {
        model: CONTROL_MODEL,
        messages: [{ role: "user", content: "Reply with the word ok." }],
        max_tokens: 5,
      },
    }),
  );
  return calls;
}

interface SpendRow {
  GatewayRequestId: string;
  TraceId: string;
  Model: string;
  Status: string;
  CharsInput: string;
  TokensInput: string;
  TokensOutput: string;
  CostNanoUSD: string;
}

async function readSpendRows(probe: Probe): Promise<SpendRow[]> {
  const client = await clickhouse(probe.projectId);
  const result = await client.query({
    query: `
      SELECT GatewayRequestId, TraceId, Model, Status,
             toString(CharsInput) AS CharsInput,
             toString(TokensInput) AS TokensInput,
             toString(TokensOutput) AS TokensOutput,
             toString(CostNanoUSD) AS CostNanoUSD
      FROM gateway_spend FINAL
      WHERE TenantId = {tenantId:String}
        AND VirtualKeyId = {vkId:String}
        AND Status IN ('confirmed', 'failed')
    `,
    query_params: { tenantId: probe.projectId, vkId: probe.vkId },
    format: "JSONEachRow",
  });
  return (await result.json()) as SpendRow[];
}

async function readLedgerDebits(
  probe: Probe,
): Promise<Array<{ Status: string; AmountNanoUSD: string }>> {
  const client = await clickhouse(probe.projectId);
  const result = await client.query({
    query: `
      SELECT Status, toString(AmountNanoUSD) AS AmountNanoUSD
      FROM gateway_budget_ledger_events FINAL
      WHERE TenantId = {tenantId:String} AND BudgetId = {budgetId:String}
    `,
    query_params: { tenantId: probe.projectId, budgetId: probe.budgetId },
    format: "JSONEachRow",
  });
  return (await result.json()) as Array<{
    Status: string;
    AmountNanoUSD: string;
  }>;
}

async function readBudgetSpendNanoUsd(probe: Probe): Promise<number> {
  const repo = new GatewayBudgetClickHouseRepository(clickhouse);
  const budget = await prisma.gatewayBudget.findUniqueOrThrow({
    where: { id: probe.budgetId },
  });
  const [spend] = await repo.getSpendForBudgetsAcrossTenants(
    [probe.projectId],
    [budget],
  );
  return spend?.spentNanoUsd ?? 0;
}

async function readTraceCostUsd(
  probe: Probe,
  traceId: string,
): Promise<number | null> {
  const client = await clickhouse(probe.projectId);
  const result = await client.query({
    query: `
      SELECT toString(TotalCost) AS TotalCost
      FROM trace_summaries FINAL
      WHERE TenantId = {tenantId:String} AND TraceId = {traceId:String}
      LIMIT 1
    `,
    query_params: { tenantId: probe.projectId, traceId },
    format: "JSONEachRow",
  });
  const rows = (await result.json()) as Array<{ TotalCost: string | null }>;
  const raw = rows[0]?.TotalCost;
  return raw == null || raw === "\\N" ? null : Number(raw);
}

/** Poll until the predicate holds or the deadline passes. No fixed sleeps:
 *  the pipeline's latency is a range, not a constant. */
async function until<T>(
  what: string,
  deadlineMs: number,
  read: () => Promise<T>,
  done: (value: T) => boolean,
): Promise<T> {
  const stopAt = Date.now() + deadlineMs;
  let last = await read();
  while (!done(last)) {
    if (Date.now() > stopAt) {
      throw new Error(
        `timed out after ${deadlineMs}ms waiting for ${what}; last read: ` +
          JSON.stringify(last),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    last = await read();
  }
  log(`${what}: satisfied`);
  return last;
}

const failures: string[] = [];

function check(name: string, ok: boolean, detail: string): void {
  if (!ok) failures.push(`${name}: ${detail}`);
  process.stdout.write(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}\n`);
}

function printTable(rows: SpendRow[]): void {
  const header = [
    "REQUEST",
    "MODEL",
    "STATUS",
    "CHARS",
    "TOK IN",
    "TOK OUT",
    "COST nanoUSD",
  ];
  const body = rows.map((r) => [
    r.GatewayRequestId.slice(-12),
    r.Model,
    r.Status,
    r.CharsInput,
    r.TokensInput,
    r.TokensOutput,
    r.CostNanoUSD,
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...body.map((row) => row[i]!.length)),
  );
  const line = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i]!)).join("  ");
  process.stdout.write(`\n${line(header)}\n`);
  process.stdout.write(`${widths.map((w) => "-".repeat(w)).join("  ")}\n`);
  for (const row of body) process.stdout.write(`${line(row)}\n`);
  process.stdout.write("\n");
}

async function assertOutcome(probe: Probe, calls: Call[], deadlineMs: number) {
  const speechCalls = calls.filter((c) => c.label.startsWith("speech"));
  const speechRequestIds = new Set(speechCalls.map((c) => c.gatewayRequestId));

  const rows = await until(
    "four priced spend rows",
    deadlineMs,
    () => readSpendRows(probe),
    (r) => r.length >= calls.length,
  );
  printTable(rows);

  const speechRows = rows.filter((r) =>
    speechRequestIds.has(r.GatewayRequestId),
  );
  check(
    "three speech rows recorded",
    speechRows.length === SPEECH_CALLS,
    `${speechRows.length} of ${SPEECH_CALLS}`,
  );
  for (const row of speechRows) {
    check(
      `characters reached the record (${row.GatewayRequestId.slice(-12)})`,
      row.CharsInput === String(SPEECH_CHARS),
      `CharsInput=${row.CharsInput}`,
    );
    check(
      `speech call priced (${row.GatewayRequestId.slice(-12)})`,
      row.CostNanoUSD === String(EXPECTED_COST_NANO_USD),
      `CostNanoUSD=${row.CostNanoUSD}, want ${EXPECTED_COST_NANO_USD}`,
    );
  }

  const controlRow = rows.find(
    (r) => !speechRequestIds.has(r.GatewayRequestId),
  );
  const controlNano = Number(controlRow?.CostNanoUSD ?? 0);
  check(
    "control call still prices",
    controlNano > 0,
    `CostNanoUSD=${controlNano}`,
  );

  const debits = await until(
    "the ledger's debits",
    deadlineMs,
    () => readLedgerDebits(probe),
    (d) => d.length >= calls.length,
  );
  const successDebits = debits.filter((d) => d.Status === "success");
  check(
    "three speech debits landed as success",
    successDebits.filter(
      (d) => d.AmountNanoUSD === String(EXPECTED_COST_NANO_USD),
    ).length === SPEECH_CALLS,
    `${successDebits.length} success debits total`,
  );

  const expectedDelta = SPEECH_CALLS * EXPECTED_COST_NANO_USD + controlNano;
  const spent = await until(
    "the budget to reach the expected delta",
    deadlineMs,
    () => readBudgetSpendNanoUsd(probe),
    (s) => Math.abs(s - expectedDelta) <= expectedDelta * 0.01,
  );
  check(
    "budget moved by the calls' cost",
    Math.abs(spent - expectedDelta) <= expectedDelta * 0.01,
    `spent=${spent}, expected=${expectedDelta} (within 1%)`,
  );

  // The trace id comes off the response, not the spend row: the row's
  // TraceId column is empty on these routes today, so joining through it
  // would silently skip the check that the two cost paths now agree.
  const firstSpeech = speechCalls[0];
  const firstSpeechRow = rows.find(
    (r) => r.GatewayRequestId === firstSpeech?.gatewayRequestId,
  );
  if (firstSpeech?.traceId && firstSpeechRow) {
    const traceCost = await until(
      "the trace explorer's cost for the speech call",
      deadlineMs,
      () => readTraceCostUsd(probe, firstSpeech.traceId),
      (c) => c !== null,
    );
    const billedUsd = Number(firstSpeechRow.CostNanoUSD) / 1e9;
    check(
      "trace cost equals the billed cost",
      Math.abs((traceCost ?? 0) - billedUsd) < 1e-9,
      `trace=${traceCost}, billed=${billedUsd}`,
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assertLocalDatabase(args.allowRemoteDb);
  const probe = await provision(args);
  await assertQuantityColumns(probe.projectId);
  const calls = await runCalls(probe, args.gateway);
  await assertOutcome(probe, calls, args.deadlineMs);

  if (failures.length > 0) {
    process.stdout.write(`\n${failures.length} check(s) failed:\n`);
    for (const f of failures) process.stdout.write(`  - ${f}\n`);
    throw new Error("probe failed");
  }
  process.stdout.write("\nAll checks passed.\n");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
