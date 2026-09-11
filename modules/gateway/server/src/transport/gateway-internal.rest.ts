/**
 * `/api/internal/gateway` — the control plane between the two halves of one
 * deployment: the Go AI Gateway's calls back into the application. Contract:
 * specs/ai-gateway/_shared/contract.md §4.
 *
 * Every route answers behind {@link gatewayInternalSignature}, the family's own
 * HMAC gate: the data plane signs METHOD, PATH, TIMESTAMP and a hash of the
 * body, and the gate runs under the family's paths ahead of any route, so a
 * route whose author forgets a check still ships authenticated. The routes
 * declare `publicRoute` for that reason and no other — no credential the
 * framework resolves reaches them, and the reason says which gate does.
 *
 * The paths are literal and carry no `/api/v1` twin: the gateway dials these
 * exact addresses, and a control plane between two halves of one deployment has
 * no dated contract to negotiate. Every body below — the error envelope the Go
 * client already parses, the 304 carrying its ETag, the 204 that ends a long
 * poll — is that client's contract, so each route writes its own bytes and
 * nothing here may be re-rendered into the house envelope.
 *
 * Each capability is OPTIONAL on the App: an absent one refuses its own route
 * (503) rather than failing to mount, or worse, silently allowing.
 */
import { publicRoute } from "@langwatch/api/access";
import {
  attributedUserBucketScopeId,
  bucketPeriodFloorMs,
  bucketScopeIdFor,
  gatewayInternalCodexRefreshSchema,
  gatewayInternalConfigParamsSchema,
  gatewayInternalGuardrailCheckSchema,
  gatewayInternalPatchSessionSchema,
  gatewayInternalReportUsageSchema,
  gatewayInternalReserveSessionSchema,
  gatewayInternalResolveKeySchema,
  gatewayInternalSessionParamsSchema,
  gatewayInternalSpendCommandBatchSchema,
  GATEWAY_INTERNAL_SPEND_COMMANDS,
  type GatewayBudget,
  type GatewayInternalSpendCommandName,
  type GatewayInternalSpendCommandRecord,
  type SpendUsage,
} from "@langwatch/gateway-contract";
import { defineRestRouter, MANAGEMENT_API_VERSION, type RestRawResult } from "@langwatch/api/rest";
import { createLogger } from "@langwatch/observability";
import type { ProjectApi } from "@langwatch/project-contract";
import { moduleApi } from "@langwatch/runtime-composition";
import { nowInstant, type Instant } from "@langwatch/time";
import { createHash, createHmac, timingSafeEqual } from "crypto";
import type { Context, MiddlewareHandler, Next } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import {
  VirtualKeyCryptoAdapter,
  VirtualKeyCryptoError,
} from "../adapters/virtual-key-crypto.adapter.ts";
import type { GatewayJwtAdapter } from "../adapters/jwt.gateway-token.adapter.ts";
import type {
  GatewayBudgetSpend,
  GatewayChangeEvents,
  GatewaySpendRating,
} from "../app/gateway.members.ts";
import type { GatewayInternalStore } from "../repositories/gateway-internal-store.repository.ts";
import {
  admitSpendWireSchema,
  confirmSpendWireSchema,
  failSpendWireSchema,
} from "../processes/gateway-spend-commands.process.ts";
import type { GatewayConfigMaterialiserService } from "../services/gateway-config-materialisation.service.ts";
import type { GatewayGuardrailEvaluationService } from "../services/gateway-guardrail-evaluation.service.ts";
import {
  GatewayRealtimeSessionService,
  type GatewayRealtimeSessionCollaborators,
} from "../services/gateway-realtime-session.service.ts";
import type { VirtualKeyService } from "../services/virtual-key.service.ts";

const realtimeSessionService = GatewayRealtimeSessionService.create();
const logger = createLogger("langwatch:gateway-internal");

const PRODUCES_JSON = "application/json";

/**
 * Why these routes declare no credential the framework resolves. The whole gate
 * is the family's own HMAC, applied under its paths before any route.
 */
const GATEWAY_INTERNAL_GATE =
  "the Go data plane signs every call with the deployment's own gateway secret, and gatewayInternalSignature verifies it under this family's paths before any route runs";

/** A named sender per command; undefined per name is a 503, not an assumed presence. */
export interface GatewaySpendCommandSender {
  sendBatch?: (payloads: unknown[]) => Promise<unknown>;
  send: (payload: unknown) => Promise<unknown>;
}

/** The spend pipeline this process registered, where it registered one. */
export type GatewayInternalSpendPipeline = Readonly<{
  commands: Record<string, GatewaySpendCommandSender | undefined>;
  rating: GatewaySpendRating;
}>;

/** How a 401 on a Codex-backed provider is recovered, where the process can. */
export type GatewayCodexRefresh = (input: { providerRowId: string }) => Promise<
  | { status: "refreshed"; accessToken: string; accountId: string }
  | { status: "not_connected" }
  | { status: "session_expired" }
>;

/** Everything the internal control plane reaches that it does not own. */
export type GatewayInternalApp = Readonly<{
  /** The SAME virtual-key service every other gateway door reads. */
  virtualKeys: VirtualKeyService;
  /** The project directory a key's trace destination is resolved through. */
  projects: ProjectApi;
  /** Mints the short-lived credential the data plane presents onward. */
  jwt: GatewayJwtAdapter;
  /** The row reads no service on this package owns. */
  store: GatewayInternalStore;
  /** The durable revision feed the configuration long-poll walks. */
  changes: GatewayChangeEvents;
  /** Builds one key's warm-cache configuration bundle. */
  config: GatewayConfigMaterialiserService;
  /** Absent with no ClickHouse; the bucket read then reports zero spend, not an invented figure. */
  budgetSpend: GatewayBudgetSpend | undefined;
  /** Absent with no model-provider service composed; a 401 recovery then refuses by name. */
  refreshCodex: GatewayCodexRefresh | undefined;
  /** All-or-nothing; a guardrail that cannot verdict must refuse, never answer allow. */
  guardrails: GatewayGuardrailEvaluationService | undefined;
  /** Absent with no spend pipeline registered; /spend-commands then answers 503. */
  spend: GatewayInternalSpendPipeline | undefined;
  /** Absent with no spend confirmation path; a booked session would then never bill. */
  realtimeSessions: GatewayRealtimeSessionCollaborators | undefined;
}>;

export const GatewayInternalApi = moduleApi<GatewayInternalApp>("gateway");

// ── the family's own answers ────────────────────────────────────────────

/** One answer, in the shape `c.json(body, status)` used to write. */
function answer(body: unknown, status: ContentfulStatusCode = 200): RestRawResult {
  return {
    status,
    headers: { "content-type": PRODUCES_JSON },
    body: JSON.stringify(body),
  };
}

/** One refusal, in the envelope the Go client already parses. */
function refuse(
  status: ContentfulStatusCode,
  error: Readonly<{ type: string; code: string; message: string } & Record<string, unknown>>,
): RestRawResult {
  return answer({ error }, status);
}

/** 503 when no session store: the gateway must refuse the mint, not book an unbilled call. */
const realtimeSessionsUnavailable = (): RestRawResult =>
  refuse(503, {
    type: "unavailable",
    code: "realtime_sessions_unavailable",
    message: "this deployment composes no realtime voice session store",
  });

/** The body a route reads for itself, or `null` when the bytes were not JSON. */
function readJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ── the family's own door ───────────────────────────────────────────────

export const GATEWAY_SIGNATURE_WINDOW_SECONDS = 300;

/**
 * Build the canonical string the Go gateway signs:
 *   METHOD + "\n" + PATH + "\n" + TIMESTAMP + "\n" + hex(sha256(body))
 */
export function buildGatewayCanonicalString(input: {
  method: string;
  path: string;
  timestamp: string;
  body: string;
}): string {
  const bodyHash = createHash("sha256").update(input.body).digest("hex");

  return `${input.method}\n${input.path}\n${input.timestamp}\n${bodyHash}`;
}

/** hex(hmac_sha256(secret, canonical)) */
export function computeGatewaySignature(secret: string, canonical: string): string {
  return createHmac("sha256", secret).update(canonical).digest("hex");
}

function logAuthDecision(
  request: Request,
  code: string,
  status: number,
  detail?: Record<string, unknown>,
): void {
  logger.warn(
    {
      code,
      status,
      path: new URL(request.url).pathname,
      gatewayNodeId: request.headers.get("X-LangWatch-Gateway-Node") ?? null,
      ...detail,
    },
    `gateway-internal auth: ${code}`,
  );
}

/**
 * This family's whole gate. It travels with the declaration rather than with
 * the process that mounts it: the HMAC, its headers and its ±300s replay window
 * are what a deployed Go gateway sends, and a published control plane cannot
 * change what it demands because its installer moved.
 *
 * Checks headers, then signature (constant-time), then timestamp, in that
 * order — HMAC first avoids a timing channel. An unset secret answers 500
 * rather than letting `undefined === undefined` admit everyone.
 */
export function gatewayInternalSignature(secretOf: () => string | undefined): MiddlewareHandler {
  return async function verify(c: Context, next: Next) {
    const secret = secretOf();
    if (!secret) {
      logAuthDecision(c.req.raw, "gateway_internal_secret_missing", 500);

      return c.json(
        {
          error: {
            type: "internal_error",
            code: "gateway_internal_secret_missing",
            message: "Gateway internal authentication is not configured",
          },
        },
        500,
      );
    }

    const presentedSig = c.req.header("X-LangWatch-Gateway-Signature");
    const presentedTs = c.req.header("X-LangWatch-Gateway-Timestamp");
    if (!presentedSig || !presentedTs) {
      logAuthDecision(c.req.raw, "missing_signature", 401, {
        hasSignature: Boolean(presentedSig),
        hasTimestamp: Boolean(presentedTs),
      });

      return c.json(
        {
          error: {
            type: "permission_denied",
            code: "missing_signature",
            message: "X-LangWatch-Gateway-Signature and X-LangWatch-Gateway-Timestamp are required",
          },
        },
        401,
      );
    }

    const body = await c.req.raw.clone().text();
    const url = new URL(c.req.url);
    const canonical = buildGatewayCanonicalString({
      method: c.req.method,
      path: url.pathname,
      timestamp: presentedTs,
      body,
    });
    const expected = computeGatewaySignature(secret, canonical);

    const a = Buffer.from(expected);
    const b = Buffer.from(presentedSig);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      logAuthDecision(c.req.raw, "invalid_signature", 401);

      return c.json(
        {
          error: {
            type: "permission_denied",
            code: "invalid_signature",
            message: "signature mismatch",
          },
        },
        401,
      );
    }

    const ts = Number.parseInt(presentedTs, 10);
    if (!Number.isFinite(ts)) {
      logAuthDecision(c.req.raw, "invalid_timestamp", 401, { presentedTs });

      return c.json(
        {
          error: {
            type: "permission_denied",
            code: "invalid_timestamp",
            message: "X-LangWatch-Gateway-Timestamp must be unix seconds",
          },
        },
        401,
      );
    }

    const now = Math.floor(nowInstant().epochMilliseconds / 1000);
    if (Math.abs(now - ts) > GATEWAY_SIGNATURE_WINDOW_SECONDS) {
      logAuthDecision(c.req.raw, "timestamp_out_of_window", 401, { driftSeconds: now - ts });

      return c.json(
        {
          error: {
            type: "permission_denied",
            code: "timestamp_out_of_window",
            message: `timestamp drift > ${GATEWAY_SIGNATURE_WINDOW_SECONDS}s`,
          },
        },
        401,
      );
    }

    await next();

    return undefined;
  };
}

// ── §4.1 resolving a presented virtual key ──────────────────────────────

interface KeyAuthRejection {
  status: 401 | 403;
  type: string;
  code: string;
  message: string;
}

/**
 * Why the presented key does not parse, or null when it does. Anything that is
 * not a VirtualKeyCryptoError is a bug rather than a bad credential, so it
 * rethrows.
 */
function virtualKeyParseRejection(presented: string): KeyAuthRejection | null {
  try {
    VirtualKeyCryptoAdapter.parseSecret(presented);

    return null;
  } catch (err) {
    if (!(err instanceof VirtualKeyCryptoError)) throw err;

    return { status: 401, type: "invalid_api_key", code: err.code, message: err.message };
  }
}

/** Null if the key may serve; each rejection carries its own code so callers can branch on it. */
function virtualKeyStatusRejection({
  status,
  expiresAt,
}: {
  status: string;
  expiresAt: Instant | null;
}): KeyAuthRejection | null {
  if (status === "REVOKED") {
    return {
      status: 403,
      type: "virtual_key_revoked",
      code: "virtual_key_revoked",
      message: "virtual key has been revoked",
    };
  }
  if (status === "DISABLED") {
    return {
      status: 403,
      type: "virtual_key_disabled",
      code: "virtual_key_disabled",
      message: "virtual key is disabled; it can be re-enabled by an administrator",
    };
  }
  if (expiresAt && expiresAt.epochMilliseconds <= nowInstant().epochMilliseconds) {
    return {
      status: 403,
      type: "virtual_key_expired",
      code: "virtual_key_expired",
      message: "virtual key has expired; extend its expiration or mint a new one",
    };
  }

  return null;
}

// ── attributed-user bucket spend ────────────────────────────────────────

/**
 * Per-bucket spend for ATTRIBUTED_USER templates. Per-user cardinality is
 * unbounded, so the gateway resolves and caches the request's own bucket here,
 * not the whole template.
 */
async function bucketSpentMicroUsd(params: {
  store: GatewayInternalStore;
  budgetRepository: GatewayBudgetSpend;
  budget: GatewayBudget;
  bucketScopeId: string;
  periodFloorMs: number | undefined;
}): Promise<number> {
  const projectIds = await params.store.listProjectIdsForOrganization(params.budget.organizationId);
  if (projectIds.length === 0) return 0;

  const spends = await params.budgetRepository.getSpendForTargetsAcrossTenants(projectIds, [
    {
      budgetId: params.budget.id,
      scope: params.budget.scopeType,
      scopeId: params.bucketScopeId,
      window: params.budget.window,
      match: "exact",
      periodFloorMs: params.periodFloorMs,
    },
  ]);
  const spentUsd = Number.parseFloat(spends[0]?.spentUsd ?? "0") || 0;

  return Math.round(spentUsd * 1_000_000);
}

// ── spend command ingest (spend-command spine) ──────────────────────────

const SPEND_COMMAND_SCHEMAS = {
  admitSpend: admitSpendWireSchema,
  confirmSpend: confirmSpendWireSchema,
  failSpend: failSpendWireSchema,
} as const;

interface SpendCommandReject {
  code: string;
  message: string;
  issues?: unknown[];
}

/**
 * The single seam that prices an outcome. The wire carries quantities, never
 * money, so the server rates once here and every downstream reader copies the
 * figure, not a moving catalog.
 */
function pricedOutcomeData(
  data: Record<string, unknown>,
  rating: GatewaySpendRating,
): Record<string, unknown> {
  const outcome = data as unknown as {
    model: string;
    usage: SpendUsage;
    rate_version?: string;
  };
  const rated = rating.rate({
    model: outcome.model,
    usage: outcome.usage,
    rateVersion: outcome.rate_version,
  });

  return { ...data, cost_nano_usd: rated.costNanoUsd, rate_version: rated.rateVersion };
}

/**
 * The internal command data one wire record maps to, or why it cannot be
 * accepted. `project_id` on the wire is the internal `tenantId`; only admits
 * carry the pod identity the gap detector reads, and outcomes are priced on the
 * way through.
 */
function toSpendCommandData(
  record: GatewayInternalSpendCommandRecord,
  rating: GatewaySpendRating,
): { ok: true; data: Record<string, unknown> } | { ok: false; reject: SpendCommandReject } {
  const wire = record.payload;
  const projectId = wire.project_id;
  if (typeof projectId !== "string" || projectId.length === 0) {
    return {
      ok: false,
      reject: {
        code: "missing_project_id",
        message: "spend command record rejected: missing project_id",
      },
    };
  }

  const { project_id: _projectId, ...rest } = wire;
  const mapped: Record<string, unknown> =
    record.command === "admitSpend"
      ? { ...rest, tenantId: projectId, pod_id: record.pod_id, pod_seq: record.pod_seq }
      : { ...rest, tenantId: projectId };
  const validated = SPEND_COMMAND_SCHEMAS[record.command].safeParse(mapped);
  if (!validated.success) {
    return {
      ok: false,
      reject: {
        code: "invalid_payload",
        message: "spend command record rejected",
        issues: validated.error.issues.slice(0, 3),
      },
    };
  }

  const data = validated.data as Record<string, unknown>;

  return {
    ok: true,
    data: record.command === "admitSpend" ? data : pricedOutcomeData(data, rating),
  };
}

/**
 * The wire fields that identify a rejected record, so the log line can be
 * reconciled against the gateway's own. Read defensively: a record is only
 * rejected because its payload did not hold up.
 */
function rejectedRecordIdentity(
  record: GatewayInternalSpendCommandRecord,
): Record<string, string | null> {
  const wireString = (key: string): string | null => {
    const value = record.payload[key];

    return typeof value === "string" && value.length > 0 ? value : null;
  };

  return { gatewayRequestId: wireString("gateway_request_id"), tenantId: wireString("project_id") };
}

/**
 * Group the batch by command, reporting unacceptable records by index. Every
 * reject path logs: a silent per-record drop looks like a healthy 200 from the
 * emitter's side and loses billing records.
 */
function groupSpendCommands(
  records: GatewayInternalSpendCommandRecord[],
  rating: GatewaySpendRating,
): {
  perCommand: Record<GatewayInternalSpendCommandName, Array<Record<string, unknown>>>;
  rejected: Array<{ index: number; code: string }>;
} {
  const perCommand: Record<GatewayInternalSpendCommandName, Array<Record<string, unknown>>> = {
    admitSpend: [],
    confirmSpend: [],
    failSpend: [],
  };
  const rejected: Array<{ index: number; code: string }> = [];

  records.forEach((record, index) => {
    const mapped = toSpendCommandData(record, rating);
    if (!mapped.ok) {
      rejected.push({ index, code: mapped.reject.code });
      // Error, not warn: the drainer reads a 200 and acks the segment, so this
      // line is the only trace the record ever existed. It names the request
      // because "a record was rejected" cannot be reconciled against anything.
      logger.error(
        {
          command: record.command,
          index,
          code: mapped.reject.code,
          ...rejectedRecordIdentity(record),
          ...(mapped.reject.issues ? { issues: mapped.reject.issues } : {}),
        },
        mapped.reject.message,
      );

      return;
    }
    perCommand[record.command].push(mapped.data);
  });

  return { perCommand, rejected };
}

/**
 * How stale `lastUsedAt` has to be before a drain batch advances it. Admin
 * oversight reads the column on minute scale, so writing it per request would
 * buy nothing.
 */
const VIRTUAL_KEY_TOUCH_THROTTLE_MS = 60_000;

/** The key row an admission is attributed against. */
type AttributionVirtualKey = {
  id: string;
  organizationId: string;
  principalUserId: string | null;
  lastUsedAt: Instant | null;
};

/**
 * The ids an attributed record was validated with. Required on an admission, so
 * those reads are total; an outcome from a build that predates
 * attribution-on-outcome carries empty strings instead.
 */
function attributedIdentity(command: Record<string, unknown>): {
  gatewayRequestId: string;
  virtualKeyId: string;
  projectId: string;
  organizationId: string;
} {
  return {
    gatewayRequestId: String(command.gateway_request_id ?? ""),
    virtualKeyId: String(command.virtual_key_id ?? ""),
    projectId: String(command.tenantId ?? ""),
    organizationId: String(command.organization_id ?? ""),
  };
}

/** Best effort: oversight, not enforcement, so a failure must not retry already-billed records. */
async function touchAdmittedVirtualKeys(
  store: GatewayInternalStore,
  virtualKeys: AttributionVirtualKey[],
  now: Instant,
): Promise<void> {
  const staleIds = virtualKeys
    .filter(
      (vk) =>
        !vk.lastUsedAt ||
        now.epochMilliseconds - vk.lastUsedAt.epochMilliseconds > VIRTUAL_KEY_TOUCH_THROTTLE_MS,
    )
    .map((vk) => vk.id);
  if (staleIds.length === 0) return;

  // The failure is swallowed by the adapter and logged there, for the reason
  // its own docblock gives: this column is oversight, and failing a batch of
  // billing records over it would cost the drainer a retry of records that
  // already appended.
  await store.touchVirtualKeysLastUsed({ virtualKeyIds: staleIds, now });
}

/**
 * Joins every admission to attribution the gateway cannot see, via two batched
 * reads. A missing key/team degrades to empty attribution and is logged for
 * reconciliation; a Prisma failure 500s so the drainer retries — nothing
 * resolvable is ever silently dropped.
 */
function reportAttributionGaps({
  identity,
  key,
  teamId,
}: {
  identity: ReturnType<typeof attributedIdentity>;
  key: AttributionVirtualKey | undefined;
  teamId: string;
}): void {
  if (!key) {
    logger.error(
      identity,
      "spend admission names a virtual key that no longer exists: principal and group budgets will not see this request",
    );
  } else if (key.organizationId !== identity.organizationId) {
    logger.error(
      { ...identity, keyOrganizationId: key.organizationId },
      "spend admission names a virtual key from another organization",
    );
  }
  if (!teamId) {
    logger.error(
      identity,
      "spend admission names a project with no team: team budgets will not see this request",
    );
  }
}

async function enrichAttributedCommands({
  store,
  admits,
  outcomes,
}: {
  store: GatewayInternalStore;
  admits: Array<Record<string, unknown>>;
  outcomes: Array<Record<string, unknown>>;
}): Promise<void> {
  // An outcome from a build predating attribution-on-outcome names no key, so
  // there is nothing to join against — those requests keep the admit-time join
  // in the consuming process managers (outcome_carries_attribution tells them to
  // do exactly that), so skipping here is the correct no-op. Silent by design:
  // one line per record through a fleet roll says nothing actionable.
  const attributableOutcomes = outcomes.filter(
    (outcome) => String(outcome.virtual_key_id ?? "") !== "",
  );
  const commands = [...admits, ...attributableOutcomes];
  if (commands.length === 0) return;

  const identities = commands.map(attributedIdentity);
  const [virtualKeys, projects] = await Promise.all([
    store.findVirtualKeysForAttribution([...new Set(identities.map((i) => i.virtualKeyId))]),
    store.findProjectTeams([...new Set(identities.map((i) => i.projectId))]),
  ]);
  const keyById = new Map(virtualKeys.map((vk) => [vk.id, vk]));
  const teamIdByProject = new Map(projects.map((p) => [p.id, p.teamId]));

  commands.forEach((command, index) => {
    const identity = identities[index]!;
    const key = keyById.get(identity.virtualKeyId);
    const teamId = teamIdByProject.get(identity.projectId) ?? "";
    // Only the admission reports these. An outcome names the same key and the
    // same project, so reporting both would say everything twice.
    if (index < admits.length) {
      reportAttributionGaps({ identity, key, teamId });
    }
    command.principal_user_id = key?.principalUserId ?? "";
    command.team_id = teamId;
  });

  // Admission is what marks a key used. An outcome is the same request arriving
  // a second time, so touching on both would double the writes to say the same
  // thing.
  const admittedKeyIds = new Set(identities.slice(0, admits.length).map((i) => i.virtualKeyId));
  await touchAdmittedVirtualKeys(
    store,
    virtualKeys.filter((vk) => admittedKeyIds.has(vk.id)),
    nowInstant(),
  );
}

/**
 * Hand each command's group to the pipeline, preferring the batched sender where
 * the command exposes one. Answers the command whose sender is missing, which is
 * a registration bug the caller reports as a 503.
 */
async function sendSpendCommands(
  commands: Record<string, GatewaySpendCommandSender | undefined>,
  perCommand: Record<GatewayInternalSpendCommandName, Array<Record<string, unknown>>>,
): Promise<GatewayInternalSpendCommandName | null> {
  for (const name of GATEWAY_INTERNAL_SPEND_COMMANDS) {
    const batch = perCommand[name];
    if (batch.length === 0) continue;

    const sender = commands[name];
    if (!sender) return name;

    if (sender.sendBatch) {
      await sender.sendBatch(batch);
      continue;
    }
    for (const payloadItem of batch) {
      await sender.send(payloadItem);
    }
  }

  return null;
}

// ── the eleven addresses, exactly as the data plane dials them ───────────

export const gatewayInternalRest = defineRestRouter(GatewayInternalApi)
  .withNamespace("gateway-internal")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })

  // §4.7: probe for /health. Riding the signed channel is the point — a 200 here
  // also proves the shared HMAC secret matches, not just that the pod is up.
  .get("/api/internal/gateway/health", "gatewayInternalHealth")
  .withAccess(publicRoute({ reason: GATEWAY_INTERNAL_GATE }))
  .withRawResponse({ produces: PRODUCES_JSON })
  .withDocs({ hide: true })
  .handle(() => answer({ status: "ok" }))

  // §4.1 — resolve a raw virtual key to a signed JWT and its current revision.
  .post("/api/internal/gateway/resolve-key", "gatewayInternalResolveKey")
  .withRawBody("text", { mediaType: PRODUCES_JSON })
  .withAccess(publicRoute({ reason: GATEWAY_INTERNAL_GATE }))
  .withRawResponse({ produces: PRODUCES_JSON })
  .withDocs({ hide: true })
  .handle(async ({ app, raw, request }) => {
    const presented = gatewayInternalResolveKeySchema.safeParse(readJson(raw) ?? {});
    if (!presented.success) {
      return refuse(400, {
        type: "bad_request",
        code: "missing_key_presented",
        message: "key_presented is required",
      });
    }

    const parseRejection = virtualKeyParseRejection(presented.data.key_presented);
    if (parseRejection) {
      logAuthDecision(request, parseRejection.code, parseRejection.status);

      return refuse(parseRejection.status, parseRejection);
    }

    const vk = await app.virtualKeys.tryGetBySecretInternal(presented.data.key_presented);
    if (!vk) {
      logAuthDecision(request, "virtual_key_not_found", 401);

      return refuse(401, {
        type: "invalid_api_key",
        code: "virtual_key_not_found",
        message: "unknown virtual key",
      });
    }

    const statusRejection = virtualKeyStatusRejection({
      status: vk.status,
      expiresAt: vk.expiresAt,
    });
    if (statusRejection) {
      logAuthDecision(request, statusRejection.code, statusRejection.status, { vkId: vk.id });

      return refuse(statusRejection.status, statusRejection);
    }

    // Where this key's traces land, read off the key. Null for a key written
    // before the destination was stored in an organization with no governance
    // project to fall back to; the gateway then skips span export rather than
    // failing the auth handshake.
    const traceProject = vk.traceProjectId
      ? await app.projects.findTraceDestination(vk.traceProjectId)
      : null;

    // notAfter ends the token at the key's expiration date when that arrives
    // before the ordinary 15 minute TTL, and travels on as the vk_expires_at
    // claim. Without it the gateway holds a token that outlives the key, and its
    // auth cache keeps serving that key while the control plane is unreachable.
    const { jwt } = app.jwt.sign({
      vk_id: vk.id,
      project_id: traceProject?.id ?? null,
      team_id: traceProject?.teamId ?? null,
      org_id: vk.organizationId,
      principal_id: vk.principalUserId,
      revision: vk.revision.toString(),
      notAfter: vk.expiresAt,
    });

    // Fire-and-forget last-used bump. Failures here must not deny the request.
    void app.virtualKeys.touchUsage(vk.id).catch(() => void 0);

    return answer({
      jwt,
      revision: vk.revision.toString(),
      key_id: vk.id,
      display_prefix: vk.displayPrefix,
    });
  })

  .post("/api/internal/gateway/codex/refresh", "gatewayInternalCodexRefresh")
  .withRawBody("text", { mediaType: PRODUCES_JSON })
  .withAccess(publicRoute({ reason: GATEWAY_INTERNAL_GATE }))
  .withRawResponse({ produces: PRODUCES_JSON })
  .withDocs({ hide: true })
  .handle(async ({ app, raw }) => {
    const parsed = gatewayInternalCodexRefreshSchema.safeParse(readJson(raw));
    if (!parsed.success) {
      return refuse(400, {
        type: "bad_request",
        code: "missing_provider_row_id",
        message: "provider_row_id is required",
      });
    }

    const refreshCodex = app.refreshCodex;
    if (!refreshCodex) {
      // Refused by name rather than reported as a dead session: telling a
      // customer to sign in to Codex again would send them round a loop that
      // cannot end, because this deployment composes no provider service to
      // refresh against.
      return refuse(503, {
        type: "unavailable",
        code: "codex_refresh_unavailable",
        message: "this deployment composes no model provider service to refresh a Codex session",
      });
    }

    const result = await refreshCodex({ providerRowId: parsed.data.provider_row_id });
    if (result.status === "not_connected") {
      return refuse(404, {
        type: "codex_not_connected",
        code: "codex_not_connected",
        message: "no connected Codex account on this provider",
      });
    }
    if (result.status === "session_expired") {
      logger.warn(
        { providerRowId: parsed.data.provider_row_id },
        "codex session expired; user must sign in again",
      );

      return refuse(401, {
        type: "codex_session_expired",
        code: "codex_session_expired",
        message: "OpenAI session expired; sign in to Codex again",
      });
    }

    return answer({ access_token: result.accessToken, account_id: result.accountId });
  })

  .get("/api/internal/gateway/config/:vk_id", "gatewayInternalConfig")
  .withParams(gatewayInternalConfigParamsSchema)
  .withAccess(publicRoute({ reason: GATEWAY_INTERNAL_GATE }))
  .withRawResponse({ produces: PRODUCES_JSON })
  .withDocs({ hide: true })
  .handle(async ({ app, input, request }) => {
    const vk = await app.store.tryFindVirtualKeyForConfig(input.vk_id);
    if (!vk) {
      return refuse(404, {
        type: "invalid_api_key",
        code: "virtual_key_not_found",
        message: "unknown virtual key",
      });
    }

    const materialiser = app.config;
    const ifNoneMatch = request.headers.get("If-None-Match");
    const currentETag = await materialiser.versionToken(vk);
    if (ifNoneMatch && ifNoneMatch === currentETag) {
      return new Response(null, {
        status: 304,
        headers: { ETag: currentETag, "Cache-Control": "no-store" },
      });
    }

    // EC4 — the CH repo lets the materialiser stamp current-period spend
    // (sumMerge from the rollup) onto each applicable budget, so the gateway's
    // existing Precheck path sees fresh state on every re-materialise after a
    // BUDGET_UPDATED eviction — without this the wire output reads the stale
    // spentUsd PG column no writer updates.
    const payload = await materialiser.materialise(vk);

    return {
      status: 200,
      headers: {
        "content-type": PRODUCES_JSON,
        ETag: currentETag,
        "Cache-Control": "no-store",
      },
      body: JSON.stringify(payload),
    } as const;
  })

  .get("/api/internal/gateway/changes", "gatewayInternalChanges")
  .withAccess(publicRoute({ reason: GATEWAY_INTERNAL_GATE }))
  .withRawResponse({ produces: PRODUCES_JSON })
  .withDocs({ hide: true })
  .handle(async ({ app, request }) => {
    const query = new URL(request.url).searchParams;
    const orgId = query.get("organization_id");
    if (!orgId) {
      return refuse(400, {
        type: "bad_request",
        code: "missing_organization_id",
        message: "organization_id query param is required",
      });
    }

    let since: bigint;
    try {
      since = BigInt(query.get("since") ?? "0");
    } catch {
      return refuse(400, {
        type: "bad_request",
        code: "invalid_since",
        message: "since must be an integer",
      });
    }

    const timeoutSeconds = Math.max(
      1,
      Math.min(25, Number.parseInt(query.get("timeout_s") ?? "10", 10) || 10),
    );
    const changes = app.changes;
    const deadline = nowInstant().epochMilliseconds + timeoutSeconds * 1000;

    while (nowInstant().epochMilliseconds < deadline) {
      const { events, currentRevision } = await changes.since(orgId, since, 500);
      if (events.length > 0) {
        return answer({
          current_revision: currentRevision.toString(),
          changes: events.map((e) => ({
            kind: e.kind,
            virtual_key_id: e.virtualKeyId,
            budget_id: e.budgetId,
            model_provider_id: e.modelProviderId,
            project_id: e.projectId,
            revision: e.revision.toString(),
          })),
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    const current = await changes.currentRevision(orgId);

    return new Response(null, {
      status: 204,
      headers: { "X-LangWatch-Revision": current.toString() },
    });
  })

  .post("/api/internal/gateway/guardrail/check", "gatewayInternalGuardrailCheck")
  .withRawBody("text", { mediaType: PRODUCES_JSON })
  .withAccess(publicRoute({ reason: GATEWAY_INTERNAL_GATE }))
  .withRawResponse({ produces: PRODUCES_JSON })
  .withDocs({ hide: true })
  .handle(async ({ app, raw }) => {
    const body = readJson(raw);
    if (body === null) {
      return refuse(400, {
        type: "bad_request",
        code: "invalid_json",
        message: "guardrail/check requires a JSON body",
      });
    }

    const parsed = gatewayInternalGuardrailCheckSchema.safeParse(body);
    if (!parsed.success) {
      return refuse(400, {
        type: "bad_request",
        code: "validation_error",
        message: parsed.error.message,
      });
    }

    const guardrails = app.guardrails;
    if (!guardrails) {
      // Refused, never allowed. A guardrail whose evaluator cannot produce a
      // verdict falls to its own failure mode rather than passing, and the same
      // rule holds one level up: a deployment with no evaluator runtime says so
      // instead of waving every request through an active protection.
      return refuse(503, {
        type: "unavailable",
        code: "guardrail_evaluation_unavailable",
        message: "this deployment composes no evaluator runtime to check a guardrail with",
      });
    }

    const verdict = await guardrails.check({
      projectId: parsed.data.project_id,
      guardrailIds: parsed.data.guardrail_ids,
      direction: parsed.data.direction,
      content: parsed.data.content,
    });
    if (verdict.decision !== "allow") {
      logger.info(
        {
          vkId: parsed.data.vk_id,
          projectId: parsed.data.project_id,
          direction: parsed.data.direction,
          decision: verdict.decision,
          policiesTriggered: verdict.policies_triggered,
        },
        "guardrail check did not allow the request",
      );
    }

    return answer(verdict);
  })

  .get("/api/internal/gateway/budget-bucket-spend", "gatewayInternalBudgetBucketSpend")
  .withAccess(publicRoute({ reason: GATEWAY_INTERNAL_GATE }))
  .withRawResponse({ produces: PRODUCES_JSON })
  .withDocs({ hide: true })
  .handle(async ({ app, request }) => {
    const query = new URL(request.url).searchParams;
    const budgetId = query.get("budget_id") ?? "";
    const endUserId = query.get("end_user_id") ?? "";
    if (!budgetId || !endUserId) {
      return refuse(400, {
        type: "bad_request",
        code: "missing_parameter",
        message: "budget_id and end_user_id are required",
      });
    }

    const store = app.store;
    const budget = await store.tryFindBudget(budgetId);
    if (!budget || budget.archivedAt || budget.scopeType !== "ATTRIBUTED_USER") {
      return refuse(404, {
        type: "not_found",
        code: "budget_not_found",
        message: "unknown attributed-user budget",
      });
    }

    const budgetRepository = app.budgetSpend;
    if (!budgetRepository) {
      // Without the ledger there is no bucket figure; report zero spend so
      // enforcement stays permissive rather than inventing a number.
      return answer({ spent_micro_usd: 0, bucket: null });
    }

    const bucketScopeId = bucketScopeIdFor(
      budget,
      attributedUserBucketScopeId(budget.scopeId, endUserId),
    );
    const boundary = await store.tryFindBucketBoundary({ budgetId: budget.id, bucketScopeId });
    const spentMicroUsd = await bucketSpentMicroUsd({
      store,
      budgetRepository,
      budget,
      bucketScopeId,
      periodFloorMs: bucketPeriodFloorMs(budget, boundary?.periodStartedAt),
    });

    return answer({ spent_micro_usd: spentMicroUsd, bucket: bucketScopeId });
  })

  .post("/api/internal/gateway/spend-commands", "gatewayInternalSpendCommands")
  .withRawBody("text", { mediaType: PRODUCES_JSON })
  .withAccess(publicRoute({ reason: GATEWAY_INTERNAL_GATE }))
  .withRawResponse({ produces: PRODUCES_JSON })
  .withDocs({ hide: true })
  .handle(async ({ app, raw }) => {
    const parsed = gatewayInternalSpendCommandBatchSchema.safeParse(readJson(raw));
    if (!parsed.success) {
      return refuse(400, {
        type: "bad_request",
        code: "invalid_batch",
        message: "records[] of {command, payload, pod_id, pod_seq} required",
      });
    }

    const pipeline = app.spend;
    if (!pipeline) {
      return refuse(503, {
        type: "unavailable",
        code: "spend_pipeline_disabled",
        message: "gateway spend pipeline is not registered (ClickHouse disabled)",
      });
    }

    const { perCommand, rejected } = groupSpendCommands(parsed.data.records, pipeline.rating);

    await enrichAttributedCommands({
      store: app.store,
      admits: perCommand.admitSpend,
      outcomes: [...perCommand.confirmSpend, ...perCommand.failSpend],
    });

    const unregistered = await sendSpendCommands(pipeline.commands, perCommand);
    if (unregistered) {
      return refuse(503, {
        type: "unavailable",
        code: "spend_command_missing",
        message: `command ${unregistered} is not registered`,
      });
    }

    return answer({ accepted: parsed.data.records.length - rejected.length, rejected });
  })

  // ── realtime voice sessions (ADR-097) ─────────────────────────────────
  .post("/api/internal/gateway/realtime-sessions", "gatewayInternalReserveRealtimeSession")
  .withRawBody("text", { mediaType: PRODUCES_JSON })
  .withAccess(publicRoute({ reason: GATEWAY_INTERNAL_GATE }))
  .withRawResponse({ produces: PRODUCES_JSON })
  .withDocs({ hide: true })
  .handle(async ({ app, raw }) => {
    const parsed = gatewayInternalReserveSessionSchema.safeParse(readJson(raw));
    if (!parsed.success) {
      return refuse(400, {
        type: "bad_request",
        code: "invalid_reservation",
        message: "a session reservation names the session, its tenancy, its key and its vendor",
      });
    }

    const body = parsed.data;
    const realtimeSessions = app.realtimeSessions;
    if (!realtimeSessions) return realtimeSessionsUnavailable();

    const result = await realtimeSessionService.reserveRealtimeSession({
      collaborators: realtimeSessions,
      sessionId: body.session_id,
      projectId: body.project_id,
      organizationId: body.organization_id,
      virtualKeyId: body.virtual_key_id,
      modelProviderId: body.model_provider_id,
      vendor: body.vendor,
      agentId: body.agent_id,
      model: body.model,
      traceId: body.trace_id,
      requestedModel: body.requested_model,
    });
    if (!result.ok) {
      return refuse(429, {
        type: "rate_limited",
        code: "realtime_session_limit",
        message:
          "this virtual key already holds the most realtime voice sessions it may keep open at once",
        open: result.open,
        limit: result.limit,
      });
    }

    return answer({ session_id: body.session_id, status: "OPEN" });
  })

  .patch(
    "/api/internal/gateway/realtime-sessions/:session_id",
    "gatewayInternalPatchRealtimeSession",
  )
  .withParams(gatewayInternalSessionParamsSchema)
  .withRawBody("text", { mediaType: PRODUCES_JSON })
  .withAccess(publicRoute({ reason: GATEWAY_INTERNAL_GATE }))
  .withRawResponse({ produces: PRODUCES_JSON })
  .withDocs({ hide: true })
  .handle(async ({ app, input, raw }) => {
    const parsed = gatewayInternalPatchSessionSchema.safeParse(readJson(raw));
    if (!parsed.success) {
      return refuse(400, {
        type: "bad_request",
        code: "invalid_session_patch",
        message: "project_id is required, with a vendor_conversation_id or a terminal status",
      });
    }

    const sessionId = input.session_id;
    const body = parsed.data;
    const realtimeSessions = app.realtimeSessions;
    if (!realtimeSessions) return realtimeSessionsUnavailable();

    let applied = false;
    if (body.vendor_conversation_id) {
      applied = await realtimeSessionService.correlateRealtimeSession({
        collaborators: realtimeSessions,
        sessionId,
        projectId: body.project_id,
        vendorConversationId: body.vendor_conversation_id,
      });
    }
    if (body.status) {
      applied =
        (await realtimeSessionService.releaseRealtimeSession({
          collaborators: realtimeSessions,
          sessionId,
          projectId: body.project_id,
          status: body.status,
          reason: body.reason ?? "released by the gateway",
        })) || applied;
    }
    if (!applied) {
      return refuse(404, {
        type: "not_found",
        code: "realtime_session_not_found",
        message: "no session with that id belongs to this project",
      });
    }

    return answer({ session_id: sessionId, updated: true });
  })

  .post(
    "/api/internal/gateway/realtime-sessions/:session_id/usage",
    "gatewayInternalReportRealtimeSessionUsage",
  )
  .withParams(gatewayInternalSessionParamsSchema)
  .withRawBody("text", { mediaType: PRODUCES_JSON })
  .withAccess(publicRoute({ reason: GATEWAY_INTERNAL_GATE }))
  .withRawResponse({ produces: PRODUCES_JSON })
  .withDocs({ hide: true })
  .handle(async ({ app, input, raw }) => {
    const parsed = gatewayInternalReportUsageSchema.safeParse(readJson(raw));
    if (!parsed.success) {
      return refuse(400, {
        type: "bad_request",
        code: "invalid_usage_report",
        message:
          "project_id, virtual_key_id and a usage object of integer quantities are required",
      });
    }

    const sessionId = input.session_id;
    const realtimeSessions = app.realtimeSessions;
    if (!realtimeSessions) return realtimeSessionsUnavailable();

    const outcome = await realtimeSessionService.reportRealtimeSessionUsage({
      collaborators: realtimeSessions,
      sessionId,
      projectId: parsed.data.project_id,
      virtualKeyId: parsed.data.virtual_key_id,
      usage: parsed.data.usage,
    });
    if (outcome === "not_found") {
      return refuse(404, {
        type: "not_found",
        code: "realtime_session_not_found",
        message: "no session with that id belongs to this project",
      });
    }

    return answer({ session_id: sessionId, status: "CLOSED" });
  })

  // §9 — startup bootstrap: a paginated stream of non-revoked virtual-key JWTs
  // for a cold-start gateway with the control plane offline. Enterprise opt-in
  // (LW_GATEWAY_BOOTSTRAP_PULL); the address answers 501 until it is built, so a
  // gateway that dials it learns that rather than 404ing on an unknown route.
  .get("/api/internal/gateway/bootstrap", "gatewayInternalBootstrap")
  .withAccess(publicRoute({ reason: GATEWAY_INTERNAL_GATE }))
  .withRawResponse({ produces: PRODUCES_JSON })
  .withDocs({ hide: true })
  .handle(() =>
    refuse(501, {
      type: "internal_error",
      code: "not_implemented",
      message:
        "Stub. Contract-shaped response lands once VirtualKey/Budget service layer is wired. See specs/ai-gateway/_shared/contract.md §4.",
    }),
  )

  .build();
