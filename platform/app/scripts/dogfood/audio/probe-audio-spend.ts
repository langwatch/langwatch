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
 *      gateway_spend lacks the quantity columns. The column check happens
 *      before anything is written, so a missing migration leaves no orphan
 *      key or budget behind.
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
 * The reads live in probeSpendReads.ts and the assertions in
 * probeSpendReport.ts; this file is the orchestrator.
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

import { prisma } from "~/server/db";
import { initializeDefaultApp } from "~/server/app-layer/presets";
import {
  assertQuantityColumns,
  type ProbeScope,
  REQUIRED_COLUMNS,
} from "./probeSpendReads";
import {
  assertOutcome,
  type Call,
  failureCount,
  log,
  printFailures,
  SPEECH_CALLS,
  SPEECH_CHARS,
} from "./probeSpendReport";

const SPEECH_MODEL = "openai/tts-1";
const CONTROL_MODEL = "openai/gpt-4o";
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
  // A non-numeric or missing value parses to NaN, and every deadline
  // comparison against NaN is false, so the poll loop would run forever
  // instead of failing.
  if (!Number.isFinite(deadlineSeconds) || deadlineSeconds <= 0) {
    throw new Error("--deadline must be a positive number of seconds");
  }
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

interface Tenant {
  userId: string;
  organizationId: string;
  projectId: string;
  teamId: string;
}

/**
 * The user's organization and personal workspace, read and ensured before
 * anything billable exists. The workspace is idempotent; the key and the
 * budget that follow are not, which is why the column check sits between.
 */
async function resolveTenant(args: Args): Promise<Tenant> {
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
  const providers = await prisma.modelProvider.count({
    where: { organizationId: picked.id, provider: "openai", enabled: true },
  });
  if (providers === 0) {
    throw new Error(
      "no enabled OpenAI provider on this org: run " +
        "scripts/dogfood/audio/seed-audio-vk.ts first",
    );
  }
  const workspace = await initializeDefaultApp({
    processRole: "web",
  }).organizations.ensurePersonalWorkspace(
    {
      organizationId: picked.id,
      displayName: null,
      displayEmail: args.email,
    },
    { id: user.id },
  );
  return {
    userId: user.id,
    organizationId: picked.id,
    projectId: workspace.project.id,
    teamId: workspace.team.id,
  };
}

interface Probe extends ProbeScope {
  vkSecret: string;
}

/** A virtual key and a budget of this run's own, so the delta is this run's. */
async function provision(args: Args, tenant: Tenant): Promise<Probe> {
  const issued = await initializeDefaultApp({
    processRole: "web",
  }).governance.personalVirtualKeyIssue({
    userId: tenant.userId,
    organizationId: tenant.organizationId,
    personalProjectId: tenant.projectId,
    personalTeamId: tenant.teamId,
    label: `audio-spend-probe-${Date.now()}`,
  });

  const budget = await prisma.gatewayBudget.create({
    data: {
      name: `audio-spend-probe-${Date.now()}`,
      organizationId: tenant.organizationId,
      scopeType: "VIRTUAL_KEY",
      scopeId: issued.id,
      window: "MONTH",
      limitUsd: "100",
      // WARN, not BLOCK: the probe measures what a call costs, and a cap
      // that refused one would measure the cap instead.
      onBreach: "WARN",
      createdById: tenant.userId,
      resetsAt: new Date(Date.now() + 30 * 86_400_000),
    },
  });

  log(`vk=${issued.id} budget=${budget.id} project=${tenant.projectId}`);
  return {
    vkSecret: issued.secret,
    vkId: issued.id,
    budgetId: budget.id,
    projectId: tenant.projectId,
    // Bounds every read to this run's window. Set after provisioning so the
    // predicate is as tight as the first call allows.
    startedAt: new Date(),
  };
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
    headers.get("X-LangWatch-Gateway-Request-Id") ?? headers.get("X-Request-Id") ?? "";
  const traceparent = headers.get("traceparent") ?? "";
  const traceId = headers.get("X-LangWatch-Trace-Id") ?? traceparent.split("-")[1] ?? "";
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assertLocalDatabase(args.allowRemoteDb);

  // Order matters: nothing billable is created until the columns are there.
  const tenant = await resolveTenant(args);
  await assertQuantityColumns(tenant.projectId);
  log(`gateway_spend carries all ${REQUIRED_COLUMNS.length} quantity columns`);

  const probe = await provision(args, tenant);
  const calls = await runCalls(probe, args.gateway);
  await assertOutcome(probe, calls, args.deadlineMs);

  if (failureCount() > 0) {
    printFailures();
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
