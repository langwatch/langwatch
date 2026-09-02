/**
 * Image spend probe: proves an image call reaches the record, the budget and
 * the trace explorer.
 *
 * Images are priced by image tokens, a quantity the spend wire never carried
 * before: a generation bills output image tokens, an edit bills input image
 * tokens for the picture it is given as well. A quantity that is measured at
 * the gateway and dropped at the wire rates the request at zero, so the
 * probe reads the quantity back per request rather than trusting the total.
 *
 * The run, end to end against a locally running stack:
 *
 *   1. Refuse to touch a non-local database, and refuse to run at all when
 *      gateway_spend lacks the image quantity columns. The column check
 *      happens before anything is written, so a missing migration leaves no
 *      orphan key or budget behind.
 *   2. Issue a dedicated virtual key with its own budget (WARN, high limit),
 *      so the delta is attributable to this run and nothing else.
 *   3. POST /v1/images/generations, then POST /v1/images/edits with the PNG
 *      the first call returned. Both responses are checked for real PNG bytes
 *      and for image tokens in the usage block.
 *   4. Poll to a deadline for the spend rows, the ledger debits, the budget
 *      total and the trace spans. No fixed sleeps: the pipeline's latency is
 *      not a constant.
 *   5. Assert per-request image tokens and cost, a positive budget delta, a
 *      trace cost above zero for both calls, and that each trace carries its
 *      image span with the prompt on the input and no base64 on the output.
 *
 * The reads live in probeImageSpendReads.ts and the assertions in
 * probeImageSpendReport.ts; this file is the orchestrator.
 *
 * Prerequisite: `scripts/dogfood/images/seed-images-vk.ts` has run for this
 * user, so the org carries an OpenAI provider key and a default policy that
 * does not filter image model ids.
 *
 * Usage:
 *   pnpm tsx scripts/dogfood/images/probe-image-spend.ts --email you@example.com
 *
 * Options:
 *   --org <id or name>    required when the user belongs to several orgs
 *   --gateway <url>       default http://localhost:5563
 *   --model <id>          default gpt-image-2
 *   --quality <level>     default low
 *   --deadline-ms <ms>    default 60000
 *   --allow-remote-db     opt out of the local-database guard
 *
 * `--force-keys` belongs to the seeder, not here: this script never writes a
 * provider credential.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PersonalVirtualKeyService } from "@ee/governance/services/personalVirtualKey.service";
import { PersonalWorkspaceService } from "@ee/governance/services/personalWorkspace.service";
import { prisma } from "~/server/db";
import {
  assertImageQuantityColumns,
  IMAGE_QUANTITY_COLUMNS,
  type ProbeScope,
} from "./probeImageSpendReads";
import {
  assertOutcome,
  type Call,
  failureCount,
  log,
  printFailures,
} from "./probeImageSpendReport";

const LOCAL_DB_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const IMAGE_SIZE = "1024x1024";
const GENERATION_PROMPT =
  "a flat red circle centered on a plain white background, minimalist vector style";
const EDIT_PROMPT = "add a small blue square in the top left corner";

/**
 * The names the trace explorer shows for an image generation and an image
 * edit. The gateway names the customer span "gen_ai." plus the request type.
 */
const GENERATION_SPAN = "gen_ai.image_generation";
const EDIT_SPAN = "gen_ai.image_edit";

/** The first four bytes of every PNG file. */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "out");

interface Args {
  email: string;
  org: string;
  gateway: string;
  model: string;
  quality: string;
  deadlineMs: number;
  allowRemoteDb: boolean;
}

function parseArgs(argv: string[]): Args {
  let email = "";
  let org = "";
  let gateway = process.env.LW_GATEWAY_BASE_URL ?? "http://localhost:5563";
  let model = "gpt-image-2";
  let quality = "low";
  let deadlineMs = 60_000;
  let allowRemoteDb = false;
  // biome-ignore lint/style/useForOf: flag parser advances the index (argv[++i]) to consume a value; for...of has no index to advance.
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--email") email = argv[++i] ?? "";
    if (argv[i] === "--org") org = argv[++i] ?? "";
    if (argv[i] === "--gateway") gateway = argv[++i] ?? gateway;
    if (argv[i] === "--model") model = argv[++i] ?? model;
    if (argv[i] === "--quality") quality = argv[++i] ?? quality;
    if (argv[i] === "--deadline-ms") deadlineMs = Number(argv[++i] ?? 60_000);
    if (argv[i] === "--allow-remote-db") allowRemoteDb = true;
  }
  if (!email) throw new Error("--email is required");
  // A non-numeric or missing value parses to NaN, and every deadline
  // comparison against NaN is false, so the poll loop would run forever
  // instead of failing.
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) {
    throw new Error("--deadline-ms must be a positive number of milliseconds");
  }
  return {
    email,
    org,
    gateway: gateway.replace(/\/$/, ""),
    model,
    quality,
    deadlineMs,
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
 * budget that follow are not, which is why the schema check sits between.
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
        "scripts/dogfood/images/seed-images-vk.ts first",
    );
  }
  const workspace = await new PersonalWorkspaceService(prisma).ensure({
    userId: user.id,
    organizationId: picked.id,
    displayName: null,
    displayEmail: args.email,
  });
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
  const issued = await PersonalVirtualKeyService.create(prisma, {
    gatewayBaseUrl: args.gateway,
  }).issue({
    userId: tenant.userId,
    organizationId: tenant.organizationId,
    personalProjectId: tenant.projectId,
    personalTeamId: tenant.teamId,
    label: `image-spend-probe-${Date.now()}`,
  });

  const budget = await prisma.gatewayBudget.create({
    data: {
      name: `image-spend-probe-${Date.now()}`,
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
 * The image routes carry W3C `traceparent`, whose second field is the trace
 * id, and always set X-LangWatch-Gateway-Request-Id, which is the spend
 * record's own key. Correlation keys off the request id and treats the trace
 * id as the extra join into the trace explorer.
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

interface ImageUsage {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { image_tokens?: number };
  output_tokens_details?: { image_tokens?: number };
}

interface ImageResponse {
  data?: Array<{ b64_json?: string }>;
  usage?: ImageUsage;
}

/** The first image of the response, decoded and checked for PNG bytes. */
function decodePng(label: string, body: ImageResponse): Buffer {
  const b64 = body.data?.[0]?.b64_json;
  if (!b64) throw new Error(`${label}: response carried no data[0].b64_json`);
  const bytes = Buffer.from(b64, "base64");
  if (!bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
    throw new Error(
      `${label}: image does not start with the PNG magic, first bytes ` +
        bytes.subarray(0, 4).toString("hex"),
    );
  }
  return bytes;
}

/**
 * Image tokens as the response states them. `output_tokens_details.
 * image_tokens` is the exact figure; `output_tokens` is the fallback for a
 * provider response that does not break the total down.
 */
function outputImageTokens(usage: ImageUsage | undefined): number {
  return (
    usage?.output_tokens_details?.image_tokens ?? usage?.output_tokens ?? 0
  );
}

function inputImageTokens(usage: ImageUsage | undefined): number {
  return usage?.input_tokens_details?.image_tokens ?? 0;
}

async function readResponse(
  label: string,
  response: Response,
): Promise<{ body: ImageResponse; call: Omit<Call, "prompt" | "spanName"> }> {
  if (!response.ok) {
    throw new Error(
      `${label} failed: HTTP ${response.status} ${await response.text()}`,
    );
  }
  const body = (await response.json()) as ImageResponse;
  const { gatewayRequestId, traceId } = callIdentity(response.headers);
  if (!gatewayRequestId) {
    throw new Error(`${label}: no gateway request id header`);
  }
  log(`${label} ok, request ${gatewayRequestId} trace ${traceId}`);
  return {
    body,
    call: { label, gatewayRequestId, traceId, httpStatus: response.status },
  };
}

async function generateImage(
  probe: Probe,
  args: Args,
): Promise<{ call: Call; png: Buffer }> {
  const response = await fetch(`${args.gateway}/v1/images/generations`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${probe.vkSecret}`,
    },
    body: JSON.stringify({
      model: args.model,
      prompt: GENERATION_PROMPT,
      n: 1,
      size: IMAGE_SIZE,
      quality: args.quality,
    }),
  });
  const { body, call } = await readResponse("generation", response);
  const png = decodePng("generation", body);
  const tokens = outputImageTokens(body.usage);
  if (tokens <= 0) {
    throw new Error(
      `generation: usage carries no output image tokens, got ${JSON.stringify(
        body.usage ?? null,
      )}`,
    );
  }
  log(`generation: ${png.length} PNG bytes, ${tokens} output image tokens`);
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path.join(OUT_DIR, "generation.png"), png);
  return {
    call: { ...call, prompt: GENERATION_PROMPT, spanName: GENERATION_SPAN },
    png,
  };
}

async function editImage(
  probe: Probe,
  args: Args,
  source: Buffer,
): Promise<Call> {
  const form = new FormData();
  // The array field name is what the images edit route expects for the set
  // of source images, even when only one is sent.
  form.append(
    "image[]",
    new Blob([new Uint8Array(source)], { type: "image/png" }),
    "generation.png",
  );
  form.append("model", args.model);
  form.append("prompt", EDIT_PROMPT);
  form.append("size", IMAGE_SIZE);
  form.append("quality", args.quality);
  form.append("n", "1");

  const response = await fetch(`${args.gateway}/v1/images/edits`, {
    method: "POST",
    // No content-type header: fetch sets the multipart boundary itself.
    headers: { authorization: `Bearer ${probe.vkSecret}` },
    body: form,
  });
  const { body, call } = await readResponse("edit", response);
  const png = decodePng("edit", body);
  const inTokens = inputImageTokens(body.usage);
  const outTokens = outputImageTokens(body.usage);
  if (inTokens <= 0) {
    throw new Error(
      `edit: usage carries no input image tokens, got ${JSON.stringify(
        body.usage ?? null,
      )}`,
    );
  }
  if (outTokens <= 0) {
    throw new Error(
      `edit: usage carries no output image tokens, got ${JSON.stringify(
        body.usage ?? null,
      )}`,
    );
  }
  log(
    `edit: ${png.length} PNG bytes, ${inTokens} input and ${outTokens} output image tokens`,
  );
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path.join(OUT_DIR, "edit.png"), png);
  return { ...call, prompt: EDIT_PROMPT, spanName: EDIT_SPAN };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assertLocalDatabase(args.allowRemoteDb);

  // Order matters: nothing billable is created until the columns are there.
  const tenant = await resolveTenant(args);
  await assertImageQuantityColumns(tenant.projectId);
  log(
    `gateway_spend carries all ${IMAGE_QUANTITY_COLUMNS.length} image quantity columns`,
  );

  const probe = await provision(args, tenant);
  const { call: generation, png } = await generateImage(probe, args);
  const edit = await editImage(probe, args, png);
  await assertOutcome(probe, [generation, edit], args.deadlineMs);

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
