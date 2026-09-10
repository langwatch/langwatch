/**
 * Contract: specs/ai-gateway/_shared/contract.md §4. Internal routes for the Go AI Gateway
 * only, HMAC-protected. Each port is OPTIONAL: an absent one refuses its route (503)
 * rather than failing to mount, or worse, silently allowing.
 */

// biome-ignore-all lint/suspicious/noEmptyBlockStatements: empty blocks here are deliberate no-ops.

import { type Instant, nowInstant } from "@langwatch/time";
import { internalSecret } from "@langwatch/api";
import {
  type AppRestSecurity,
  MANAGEMENT_API_VERSION,
  type MountableRestApp,
} from "@langwatch/api/rest";
import { createLogger } from "@langwatch/observability";
import type { ProjectApi } from "@langwatch/project-contract";
import { createHash, createHmac, timingSafeEqual } from "crypto";
import type { Context, Next } from "hono";
import { z } from "zod";

import {
  attributedUserBucketScopeId,
  bucketScopeIdFor,
  bucketPeriodFloorMs,
} from "@langwatch/gateway-contract";
import {
  VirtualKeyCryptoAdapter,
  VirtualKeyCryptoError,
} from "../../adapters/virtual-key-crypto.adapter.ts";
import type { GatewayJwtAdapter } from "../../adapters/jwt.gateway-token.adapter.ts";
import type { GatewayBudgetSpend } from "../../app/gateway.infrastructure.ts";
import type { GatewayChangeEvents } from "../../app/gateway.infrastructure.ts";
import type { GatewayInternalStore } from "../../ports/gateway-internal-store.port.ts";
import type { GatewaySpendRating } from "../../app/gateway.infrastructure.ts";
import {
  admitSpendWireSchema,
  confirmSpendWireSchema,
  failSpendWireSchema,
  type SpendUsage,
  spendUsageSchema,
} from "../../processes/gateway-spend-commands.process.ts";
import type { GatewayConfigMaterialiserService } from "../../services/gateway-config-materialisation.service.ts";
import {
  GatewayGuardrailEvaluationService,
  GUARDRAIL_WIRE_DIRECTIONS,
} from "../../services/gateway-guardrail-evaluation.service.ts";
import {
  GatewayRealtimeSessionService,
  type GatewayRealtimeSessionCollaborators,
} from "../../services/gateway-realtime-session.service.ts";
import type { VirtualKeyService } from "../../services/virtual-key.service.ts";
import type { GatewayBudget } from "@langwatch/gateway-contract";

const realtimeSessionService = GatewayRealtimeSessionService.create();
const logger = createLogger("langwatch:gateway-internal");

/** A named sender per command; undefined per name is a 503, not an assumed presence. */
export interface GatewaySpendCommandSender {
  sendBatch?: (payloads: unknown[]) => Promise<unknown>;
  send: (payload: unknown) => Promise<unknown>;
}

/** Everything the internal control plane reaches that it does not own. */
export type GatewayInternalRestPorts = Readonly<{
  /** Lazy: configured after the family builds; unset must answer 500, never fall open. */
  internalSecret: () => string | undefined;
  /** The SAME virtual-key service every other gateway door reads. */
  virtualKeys: () => VirtualKeyService;
  /** The project directory a key's trace destination is resolved through. */
  projects: () => ProjectApi;
  /** Mints the short-lived credential the data plane presents onward. */
  jwt: () => GatewayJwtAdapter;
  /** The row reads no service on this package owns. */
  store: () => GatewayInternalStore;
  /** The durable revision feed the configuration long-poll walks. */
  changes: () => GatewayChangeEvents;
  /** Builds one key's warm-cache configuration bundle. */
  config: () => GatewayConfigMaterialiserService;
  /** Absent with no ClickHouse; the bucket read then reports zero spend, not an invented figure. */
  budgetSpend: () => GatewayBudgetSpend | undefined;
  /** Absent with no model-provider service composed; a 401 recovery then refuses by name. */
  refreshCodex?:
    | ((input: {
        providerRowId: string;
      }) => Promise<
        | { status: "refreshed"; accessToken: string; accountId: string }
        | { status: "not_connected" }
        | { status: "session_expired" }
      >)
    | undefined;
  /** All-or-nothing; a guardrail that can't verdict must refuse, never answer allow. */
  guardrails?: (() => GatewayGuardrailEvaluationService) | undefined;
  /** Absent with no spend pipeline registered; /spend-commands then answers 503. */
  spend?:
    | (() =>
        | {
            commands: Record<string, GatewaySpendCommandSender | undefined>;
            rating: GatewaySpendRating;
          }
        | undefined)
    | undefined;
  /** Absent with no spend confirmation path; a booked session would then never bill. */
  realtimeSessions?: (() => GatewayRealtimeSessionCollaborators) | undefined;
}>;

// Contract 4.6. Wire vocabulary, deliberately not the Prisma enum: a storage-value
// mismatch here fails every real call and falls back to allowing the request.
const guardrailCheckRequestSchema = z.object({
  vk_id: z.string().min(1),
  project_id: z.string().min(1),
  gateway_request_id: z.string().optional(),
  direction: z.enum(GUARDRAIL_WIRE_DIRECTIONS),
  guardrail_ids: z.array(z.string()).default([]),
  content: z
    .object({
      messages: z.unknown().optional(),
      output: z.unknown().optional(),
      chunk: z.unknown().optional(),
      tools: z.unknown().optional(),
      mcps: z.unknown().optional(),
    })
    .optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const codexRefreshRequestSchema = z.object({
  provider_row_id: z.string().min(1),
});

const gatewayPolicy = () =>
  internalSecret(
    "gateway HMAC signature verified by the verifySecret chain (verifyGatewaySignature)",
  );

/** 503 when no session store: the gateway must refuse the mint, not book an unbilled call. */
const realtimeSessionsUnavailable = {
  error: {
    type: "unavailable",
    code: "realtime_sessions_unavailable",
    message: "this deployment composes no realtime voice session store",
  },
} as const;

// ── auth middleware ─────────────────────────────────────────────────────

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

/**
 * Verifies gateway HMAC with replay protection (±300s). Checks headers, then signature
 * (constant-time), then timestamp, in that order — HMAC first avoids a timing channel.
 */
function logAuthDecision(
  c: Context,
  code: string,
  status: number,
  detail?: Record<string, unknown>,
): void {
  logger.warn(
    {
      code,
      status,
      path: new URL(c.req.url).pathname,
      gatewayNodeId: c.req.header("X-LangWatch-Gateway-Node") ?? null,
      ...detail,
    },
    `gateway-internal auth: ${code}`,
  );
}

function verifyGatewaySignature(secretOf: () => string | undefined) {
  return async function verify(c: Context, next: Next) {
    const secret = secretOf();
    if (!secret) {
      logAuthDecision(c, "gateway_internal_secret_missing", 500);
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
      logAuthDecision(c, "missing_signature", 401, {
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
      logAuthDecision(c, "invalid_signature", 401);
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
      logAuthDecision(c, "invalid_timestamp", 401, { presentedTs });
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
      logAuthDecision(c, "timestamp_out_of_window", 401, {
        driftSeconds: now - ts,
      });
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

// ── helpers ─────────────────────────────────────────────────────────────

function notImplemented(c: Context) {
  return c.json(
    {
      error: {
        type: "internal_error",
        code: "not_implemented",
        message:
          "Stub. Contract-shaped response lands once VirtualKey/Budget service layer is wired. See specs/ai-gateway/_shared/contract.md §4.",
      },
    },
    501,
  );
}

// ── routes ──────────────────────────────────────────────────────────────

// §4.1 — resolve a raw virtual key to a signed JWT + current revision.
interface KeyAuthRejection {
  status: 401 | 403;
  type: string;
  code: string;
  message: string;
}

function rejectionBody(rejection: KeyAuthRejection) {
  return {
    error: {
      type: rejection.type,
      code: rejection.code,
      message: rejection.message,
    },
  };
}

/** Why the presented key does not parse, or null when it does. Anything
 *  that is not a VirtualKeyCryptoError is a bug rather than a bad
 *  credential, so it rethrows. */
function virtualKeyParseRejection(presented: string): KeyAuthRejection | null {
  try {
    VirtualKeyCryptoAdapter.parseSecret(presented);
    return null;
  } catch (err) {
    if (!(err instanceof VirtualKeyCryptoError)) throw err;
    return {
      status: 401,
      type: "invalid_api_key",
      code: err.code,
      message: err.message,
    };
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

// §4.5: /budget/debit is removed. Cost recording rides the spend commands
// posted below — the debits process manager joins each admission to its
// outcome and writes gateway_budget_ledger_events once per applicable
// budget (single source of truth, no PG dual-write). See migration
// 00017_create_gateway_budget_ledger.sql.

// §9 — startup bootstrap: paginated stream of non-revoked VK JWTs for a cold-start
// gateway with the control plane offline. Enterprise opt-in (LW_GATEWAY_BOOTSTRAP_PULL).

// ── attributed-user bucket spend ────────────────────────────────────────

/**
 * Per-bucket spend for ATTRIBUTED_USER templates. Per-user cardinality is unbounded, so
 * the gateway resolves and caches the request's own bucket here, not the whole template.
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

const spendCommandWireSchema = z.object({
  command: z.enum(["admitSpend", "confirmSpend", "failSpend"]),
  /** The spine-spec event payload; project_id on the wire maps to the
   *  internal tenantId. Validated per command type below. */
  payload: z.record(z.string(), z.unknown()),
  pod_id: z.string().max(128).default(""),
  pod_seq: z.number().int().min(0).default(0),
});

const spendCommandBatchSchema = z.object({
  records: z.array(spendCommandWireSchema).min(1).max(500),
});

type SpendCommandName = z.infer<typeof spendCommandWireSchema>["command"];
type SpendCommandRecord = z.infer<typeof spendCommandWireSchema>;

const SPEND_COMMAND_NAMES = ["admitSpend", "confirmSpend", "failSpend"] as const;

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
 * The single seam that prices an outcome. The wire carries quantities, never money, so the
 * server rates once here and every downstream reader copies the figure, not a moving catalog.
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
  return {
    ...data,
    cost_nano_usd: rated.costNanoUsd,
    rate_version: rated.rateVersion,
  };
}

/** The internal command data one wire record maps to, or why it cannot be
 *  accepted. `project_id` on the wire is the internal `tenantId`; only
 *  admits carry the pod identity the gap detector reads, and outcomes are
 *  priced on the way through. */
function toSpendCommandData(
  record: SpendCommandRecord,
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
      ? {
          ...rest,
          tenantId: projectId,
          pod_id: record.pod_id,
          pod_seq: record.pod_seq,
        }
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

/** The wire fields that identify a rejected record, so the log line can be
 *  reconciled against the gateway's own. Read defensively: a record is only
 *  rejected because its payload did not hold up. */
function rejectedRecordIdentity(record: SpendCommandRecord): Record<string, string | null> {
  const wireString = (key: string): string | null => {
    const value = record.payload[key];
    return typeof value === "string" && value.length > 0 ? value : null;
  };
  return {
    gatewayRequestId: wireString("gateway_request_id"),
    tenantId: wireString("project_id"),
  };
}

/** Group the batch by command, reporting unacceptable records by index.
 *  Every reject path logs: a silent per-record drop looks like a healthy
 *  200 from the emitter's side and loses billing records. */
function groupSpendCommands(
  records: SpendCommandRecord[],
  rating: GatewaySpendRating,
): {
  perCommand: Record<SpendCommandName, Array<Record<string, unknown>>>;
  rejected: Array<{ index: number; code: string }>;
} {
  const perCommand: Record<SpendCommandName, Array<Record<string, unknown>>> = {
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

/** How stale `lastUsedAt` has to be before a drain batch advances it.
 *  Admin oversight reads the column on minute scale, so writing it per
 *  request would buy nothing. */
const VIRTUAL_KEY_TOUCH_THROTTLE_MS = 60_000;

/** The key row an admission is attributed against. */
type AttributionVirtualKey = {
  id: string;
  organizationId: string;
  principalUserId: string | null;
  lastUsedAt: Instant | null;
};

/** The ids an attributed record was validated with. Required on an
 *  admission, so those reads are total; an outcome from a build that
 *  predates attribution-on-outcome carries empty strings instead. */
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
 * Joins every admission to attribution the gateway can't see, via two batched reads.
 * A missing key/team degrades to empty attribution and is logged for reconciliation; a
 * Prisma failure 500s so the drainer retries — nothing resolvable is ever silently dropped.
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
  // An outcome from a build predating attribution-on-outcome names no key,
  // so there's nothing to join against — those requests keep the admit-time
  // join in the consuming process managers (outcome_carries_attribution tells
  // them to do exactly that), so skipping here is the correct no-op. Silent
  // by design: one line per record through a fleet roll says nothing actionable.
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
    // Only the admission reports these. An outcome names the same key and
    // the same project, so reporting both would say everything twice.
    if (index < admits.length) {
      reportAttributionGaps({ identity, key, teamId });
    }
    command.principal_user_id = key?.principalUserId ?? "";
    command.team_id = teamId;
  });

  // Admission is what marks a key used. An outcome is the same request
  // arriving a second time, so touching on both would double the writes to
  // say the same thing.
  const admittedKeyIds = new Set(identities.slice(0, admits.length).map((i) => i.virtualKeyId));
  await touchAdmittedVirtualKeys(
    store,
    virtualKeys.filter((vk) => admittedKeyIds.has(vk.id)),
    nowInstant(),
  );
}

/** Hand each command's group to the pipeline, preferring the batched
 *  sender where the command exposes one. Answers the command whose sender
 *  is missing, which is a registration bug the caller reports as a 503. */
async function sendSpendCommands(
  commands: unknown,
  perCommand: Record<SpendCommandName, Array<Record<string, unknown>>>,
): Promise<SpendCommandName | null> {
  const senders = commands as Record<string, GatewaySpendCommandSender | undefined>;
  for (const name of SPEND_COMMAND_NAMES) {
    const batch = perCommand[name];
    if (batch.length === 0) continue;
    const sender = senders[name];
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

// ── realtime voice sessions (ADR-097) ───────────────────────────────────

const reserveRealtimeSessionSchema = z.object({
  session_id: z.string().min(1).max(256),
  project_id: z.string().min(1).max(256),
  organization_id: z.string().min(1).max(256),
  virtual_key_id: z.string().min(1).max(256),
  model_provider_id: z.string().min(1).max(256),
  // The trace the mint's own span belongs to. Optional so a gateway that
  // predates this field, or a request with no trace context, still books.
  trace_id: z.string().max(128).optional(),
  requested_model: z.string().max(512).optional(),
  vendor: z.enum(["openai", "elevenlabs"]),
  agent_id: z.string().max(256).optional(),
  model: z.string().min(1).max(512),
});

// Both fields are optional on their own; this refinement stops a project_id-only body
// from parsing, applying nothing, and answering 404 as though the session were missing.
const patchRealtimeSessionSchema = z
  .object({
    project_id: z.string().min(1).max(256),
    vendor_conversation_id: z.string().min(1).max(256).optional(),
    status: z.enum(["FAILED", "EXPIRED"]).optional(),
    reason: z.string().max(256).optional(),
  })
  .refine((body) => Boolean(body.vendor_conversation_id ?? body.status), {
    message: "a vendor_conversation_id or a terminal status is required",
  });

const reportRealtimeUsageSchema = z.object({
  project_id: z.string().min(1).max(256),
  // Required, not optional. Several virtual keys can point at one project, so
  // the project alone does not say whose session this is; the spend record
  // belongs to the key that was admitted.
  virtual_key_id: z.string().min(1).max(256),
  usage: spendUsageSchema,
});

// verifySecret applies the HMAC check per route in the builder chain, not app-wide,
// so each route's access policy stays declared where the route is.
export function createGatewayInternalRestApp(options: {
  security: AppRestSecurity;
  ports: GatewayInternalRestPorts;
}): MountableRestApp {
  const { security, ports } = options;
  const { service, policy } = security.createServiceVersionedApp({
    name: "gateway-internal",
    basePath: "/api/internal/gateway",
    // The Go data plane dials these exact paths; a control plane between two
    // halves of one deployment has no dated contract to negotiate.
    staticGeneration: "v1",
    errorEnvelope: "legacy",
    verifySecret: verifyGatewaySignature(ports.internalSecret),
  });

  /** Every answer here is the data plane's own contract, written by the handler. */
  const GATEWAY_INTERNAL_ANSWER =
    "the Go data plane reads this family's own bodies and statuses: the error envelope " +
    "it already parses, a 304 carrying its ETag, and the 204 that ends a long poll";

  // §4.7: probe for /health. Riding the signed channel is the point — a 200 here
  // also proves the shared HMAC secret matches, not just that the pod is up.
  return service
    .registerRoute(
      "get",
      "/health",
      MANAGEMENT_API_VERSION,
      (c) => {
        return c.json({ status: "ok" });
      },
      (b) => policy(gatewayPolicy())(b).withRawResponse(GATEWAY_INTERNAL_ANSWER),
    )
    .registerRoute(
      "post",
      "/resolve-key",
      MANAGEMENT_API_VERSION,
      async (c) => {
        const body = (await c.req.json().catch(() => ({}))) as {
          key_presented?: string;
          gateway_node_id?: string;
        };
        const presented = body.key_presented;
        if (!presented || typeof presented !== "string") {
          return c.json(
            {
              error: {
                type: "bad_request",
                code: "missing_key_presented",
                message: "key_presented is required",
              },
            },
            400,
          );
        }

        const parseRejection = virtualKeyParseRejection(presented);
        if (parseRejection) {
          logAuthDecision(c, parseRejection.code, parseRejection.status);
          return c.json(rejectionBody(parseRejection), parseRejection.status);
        }

        const virtualKeysService = ports.virtualKeys();
        const vk = await virtualKeysService.tryGetBySecretInternal(presented);
        if (!vk) {
          logAuthDecision(c, "virtual_key_not_found", 401);
          return c.json(
            {
              error: {
                type: "invalid_api_key",
                code: "virtual_key_not_found",
                message: "unknown virtual key",
              },
            },
            401,
          );
        }
        const statusRejection = virtualKeyStatusRejection({
          status: vk.status,
          expiresAt: vk.expiresAt,
        });
        if (statusRejection) {
          logAuthDecision(c, statusRejection.code, statusRejection.status, {
            vkId: vk.id,
          });
          return c.json(rejectionBody(statusRejection), statusRejection.status);
        }

        // Where this key's traces land, read off the key. Null for a key written
        // before the destination was stored in an organization with no governance
        // project to fall back to; the gateway then skips span export rather than
        // failing the auth handshake.
        const traceProject = vk.traceProjectId
          ? await ports.projects().findTraceDestination(vk.traceProjectId)
          : null;

        // notAfter ends the token at the key's expiration date when that arrives
        // before the ordinary 15 minute TTL, and travels on as the vk_expires_at
        // claim. Without it the gateway holds a token that outlives the key, and its
        // auth cache keeps serving that key while the control plane is unreachable.
        const { jwt } = ports.jwt().sign({
          vk_id: vk.id,
          project_id: traceProject?.id ?? null,
          team_id: traceProject?.teamId ?? null,
          org_id: vk.organizationId,
          principal_id: vk.principalUserId,
          revision: vk.revision.toString(),
          notAfter: vk.expiresAt,
        });

        // Fire-and-forget last-used bump. Failures here must not deny the request.
        void virtualKeysService.touchUsage(vk.id).catch(() => {});

        return c.json({
          jwt,
          revision: vk.revision.toString(),
          key_id: vk.id,
          display_prefix: vk.displayPrefix,
        });
      },
      (b) => policy(gatewayPolicy())(b).withRawResponse(GATEWAY_INTERNAL_ANSWER),
    )
    .registerRoute(
      "post",
      "/codex/refresh",
      MANAGEMENT_API_VERSION,
      async (c) => {
        const parsed = codexRefreshRequestSchema.safeParse(await c.req.json().catch(() => null));
        if (!parsed.success) {
          return c.json(
            {
              error: {
                type: "bad_request",
                code: "missing_provider_row_id",
                message: "provider_row_id is required",
              },
            },
            400,
          );
        }
        const refreshCodex = ports.refreshCodex;
        if (!refreshCodex) {
          // Refused by name rather than reported as a dead session: telling a
          // customer to sign in to Codex again would send them round a loop that
          // cannot end, because this deployment composes no provider service to
          // refresh against.
          return c.json(
            {
              error: {
                type: "unavailable",
                code: "codex_refresh_unavailable",
                message:
                  "this deployment composes no model provider service to refresh a Codex session",
              },
            },
            503,
          );
        }
        const result = await refreshCodex({ providerRowId: parsed.data.provider_row_id });
        if (result.status === "not_connected") {
          return c.json(
            {
              error: {
                type: "codex_not_connected",
                code: "codex_not_connected",
                message: "no connected Codex account on this provider",
              },
            },
            404,
          );
        }
        if (result.status === "session_expired") {
          logger.warn(
            { providerRowId: parsed.data.provider_row_id },
            "codex session expired; user must sign in again",
          );
          return c.json(
            {
              error: {
                type: "codex_session_expired",
                code: "codex_session_expired",
                message: "OpenAI session expired; sign in to Codex again",
              },
            },
            401,
          );
        }
        return c.json({
          access_token: result.accessToken,
          account_id: result.accountId,
        });
      },
      (b) => policy(gatewayPolicy())(b).withRawResponse(GATEWAY_INTERNAL_ANSWER),
    )
    .registerRoute(
      "get",
      "/config/:vk_id",
      MANAGEMENT_API_VERSION,
      async (c, input: { vk_id: string }) => {
        const vkId = input.vk_id;
        const vk = await ports.store().tryFindVirtualKeyForConfig(vkId);
        if (!vk) {
          return c.json(
            {
              error: {
                type: "invalid_api_key",
                code: "virtual_key_not_found",
                message: "unknown virtual key",
              },
            },
            404,
          );
        }

        const materialiser = ports.config();

        const ifNoneMatch = c.req.header("If-None-Match");
        const currentETag = await materialiser.versionToken(vk);
        if (ifNoneMatch && ifNoneMatch === currentETag) {
          return c.body(null, 304, {
            ETag: currentETag,
            "Cache-Control": "no-store",
          });
        }

        // EC4 — the CH repo lets the materialiser stamp current-period spend
        // (sumMerge from the rollup) onto each applicable budget, so the
        // gateway's existing Precheck path sees fresh state on every
        // re-materialise after a BUDGET_UPDATED eviction — without this the
        // wire output reads the stale spentUsd PG column no writer updates.
        const payload = await materialiser.materialise(vk);
        return c.json(payload, 200, {
          ETag: currentETag,
          "Cache-Control": "no-store",
        });
      },
      (b) =>
        policy(gatewayPolicy())(b)
          .withParams(z.object({ vk_id: z.string().min(1) }))
          .withRawResponse(GATEWAY_INTERNAL_ANSWER),
    )
    .registerRoute(
      "get",
      "/changes",
      MANAGEMENT_API_VERSION,
      async (c) => {
        const sinceParam = c.req.query("since") ?? "0";
        const orgId = c.req.query("organization_id");
        if (!orgId) {
          return c.json(
            {
              error: {
                type: "bad_request",
                code: "missing_organization_id",
                message: "organization_id query param is required",
              },
            },
            400,
          );
        }

        let since: bigint;
        try {
          since = BigInt(sinceParam);
        } catch {
          return c.json(
            {
              error: {
                type: "bad_request",
                code: "invalid_since",
                message: "since must be an integer",
              },
            },
            400,
          );
        }

        const timeoutSeconds = Math.max(
          1,
          Math.min(25, Number.parseInt(c.req.query("timeout_s") ?? "10", 10) || 10),
        );
        const repo = ports.changes();
        const deadline = nowInstant().epochMilliseconds + timeoutSeconds * 1000;

        while (nowInstant().epochMilliseconds < deadline) {
          const { events, currentRevision } = await repo.since(orgId, since, 500);
          if (events.length > 0) {
            return c.json(
              {
                current_revision: currentRevision.toString(),
                changes: events.map((e) => ({
                  kind: e.kind,
                  virtual_key_id: e.virtualKeyId,
                  budget_id: e.budgetId,
                  model_provider_id: e.modelProviderId,
                  project_id: e.projectId,
                  revision: e.revision.toString(),
                })),
              },
              200,
            );
          }
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }

        const current = await repo.currentRevision(orgId);
        return c.body(null, 204, {
          "X-LangWatch-Revision": current.toString(),
        });
      },
      (b) => policy(gatewayPolicy())(b).withRawResponse(GATEWAY_INTERNAL_ANSWER),
    )
    .registerRoute(
      "post",
      "/guardrail/check",
      MANAGEMENT_API_VERSION,
      async (c) => {
        let body: unknown;
        try {
          body = await c.req.json();
        } catch {
          return c.json(
            {
              error: {
                type: "bad_request",
                code: "invalid_json",
                message: "guardrail/check requires a JSON body",
              },
            },
            400,
          );
        }
        const parsed = guardrailCheckRequestSchema.safeParse(body);
        if (!parsed.success) {
          return c.json(
            {
              error: {
                type: "bad_request",
                code: "validation_error",
                message: parsed.error.message,
              },
            },
            400,
          );
        }
        const guardrails = ports.guardrails?.();
        if (!guardrails) {
          // Refused, never allowed. A guardrail whose evaluator cannot produce a
          // verdict falls to its own failure mode rather than passing, and the same
          // rule holds one level up: a deployment with no evaluator runtime says so
          // instead of waving every request through an active protection.
          return c.json(
            {
              error: {
                type: "unavailable",
                code: "guardrail_evaluation_unavailable",
                message: "this deployment composes no evaluator runtime to check a guardrail with",
              },
            },
            503,
          );
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
        return c.json(verdict);
      },
      (b) => policy(gatewayPolicy())(b).withRawResponse(GATEWAY_INTERNAL_ANSWER),
    )
    .registerRoute(
      "get",
      "/budget-bucket-spend",
      MANAGEMENT_API_VERSION,
      async (c) => {
        const budgetId = c.req.query("budget_id") ?? "";
        const endUserId = c.req.query("end_user_id") ?? "";
        if (!budgetId || !endUserId) {
          return c.json(
            {
              error: {
                type: "bad_request",
                code: "missing_parameter",
                message: "budget_id and end_user_id are required",
              },
            },
            400,
          );
        }
        const store = ports.store();
        const budget = await store.tryFindBudget(budgetId);
        if (!budget || budget.archivedAt || budget.scopeType !== "ATTRIBUTED_USER") {
          return c.json(
            {
              error: {
                type: "not_found",
                code: "budget_not_found",
                message: "unknown attributed-user budget",
              },
            },
            404,
          );
        }
        const budgetRepository = ports.budgetSpend();
        if (!budgetRepository) {
          // Without the ledger there is no bucket figure; report zero spend so
          // enforcement stays permissive rather than inventing a number.
          return c.json({ spent_micro_usd: 0, bucket: null });
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
        return c.json({ spent_micro_usd: spentMicroUsd, bucket: bucketScopeId });
      },
      (b) => policy(gatewayPolicy())(b).withRawResponse(GATEWAY_INTERNAL_ANSWER),
    )
    .registerRoute(
      "post",
      "/spend-commands",
      MANAGEMENT_API_VERSION,
      async (c) => {
        const parsed = spendCommandBatchSchema.safeParse(await c.req.json().catch(() => null));
        if (!parsed.success) {
          return c.json(
            {
              error: {
                type: "bad_request",
                code: "invalid_batch",
                message: "records[] of {command, payload, pod_id, pod_seq} required",
              },
            },
            400,
          );
        }

        const pipeline = ports.spend?.();
        if (!pipeline) {
          return c.json(
            {
              error: {
                type: "unavailable",
                code: "spend_pipeline_disabled",
                message: "gateway spend pipeline is not registered (ClickHouse disabled)",
              },
            },
            503,
          );
        }

        const { perCommand, rejected } = groupSpendCommands(parsed.data.records, pipeline.rating);

        await enrichAttributedCommands({
          store: ports.store(),
          admits: perCommand.admitSpend,
          outcomes: [...perCommand.confirmSpend, ...perCommand.failSpend],
        });

        const unregistered = await sendSpendCommands(pipeline.commands, perCommand);
        if (unregistered) {
          return c.json(
            {
              error: {
                type: "unavailable",
                code: "spend_command_missing",
                message: `command ${unregistered} is not registered`,
              },
            },
            503,
          );
        }

        return c.json({
          accepted: parsed.data.records.length - rejected.length,
          rejected,
        });
      },
      (b) => policy(gatewayPolicy())(b).withRawResponse(GATEWAY_INTERNAL_ANSWER),
    )
    .registerRoute(
      "post",
      "/realtime-sessions",
      MANAGEMENT_API_VERSION,
      async (c) => {
        const parsed = reserveRealtimeSessionSchema.safeParse(await c.req.json().catch(() => null));
        if (!parsed.success) {
          return c.json(
            {
              error: {
                type: "bad_request",
                code: "invalid_reservation",
                message:
                  "a session reservation names the session, its tenancy, its key and its vendor",
              },
            },
            400,
          );
        }
        const body = parsed.data;
        const realtimeSessions = ports.realtimeSessions?.();
        if (!realtimeSessions) {
          return c.json(realtimeSessionsUnavailable, 503);
        }
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
          return c.json(
            {
              error: {
                type: "rate_limited",
                code: "realtime_session_limit",
                message:
                  "this virtual key already holds the most realtime voice sessions it may keep open at once",
                open: result.open,
                limit: result.limit,
              },
            },
            429,
          );
        }
        return c.json({ session_id: body.session_id, status: "OPEN" });
      },
      (b) => policy(gatewayPolicy())(b).withRawResponse(GATEWAY_INTERNAL_ANSWER),
    )
    .registerRoute(
      "patch",
      "/realtime-sessions/:session_id",
      MANAGEMENT_API_VERSION,
      async (c, input: { session_id: string }) => {
        const parsed = patchRealtimeSessionSchema.safeParse(await c.req.json().catch(() => null));
        if (!parsed.success) {
          return c.json(
            {
              error: {
                type: "bad_request",
                code: "invalid_session_patch",
                message:
                  "project_id is required, with a vendor_conversation_id or a terminal status",
              },
            },
            400,
          );
        }
        const sessionId = input.session_id;
        const body = parsed.data;
        const realtimeSessions = ports.realtimeSessions?.();
        if (!realtimeSessions) {
          return c.json(realtimeSessionsUnavailable, 503);
        }
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
          return c.json(
            {
              error: {
                type: "not_found",
                code: "realtime_session_not_found",
                message: "no session with that id belongs to this project",
              },
            },
            404,
          );
        }
        return c.json({ session_id: sessionId, updated: true });
      },
      (b) =>
        policy(gatewayPolicy())(b)
          .withParams(z.object({ session_id: z.string().min(1) }))
          .withRawResponse(GATEWAY_INTERNAL_ANSWER),
    )
    .registerRoute(
      "post",
      "/realtime-sessions/:session_id/usage",
      MANAGEMENT_API_VERSION,
      async (c, input: { session_id: string }) => {
        const parsed = reportRealtimeUsageSchema.safeParse(await c.req.json().catch(() => null));
        if (!parsed.success) {
          return c.json(
            {
              error: {
                type: "bad_request",
                code: "invalid_usage_report",
                message:
                  "project_id, virtual_key_id and a usage object of integer quantities are required",
              },
            },
            400,
          );
        }
        const sessionId = input.session_id;
        const realtimeSessions = ports.realtimeSessions?.();
        if (!realtimeSessions) {
          return c.json(realtimeSessionsUnavailable, 503);
        }
        const outcome = await realtimeSessionService.reportRealtimeSessionUsage({
          collaborators: realtimeSessions,
          sessionId,
          projectId: parsed.data.project_id,
          virtualKeyId: parsed.data.virtual_key_id,
          usage: parsed.data.usage,
        });
        if (outcome === "not_found") {
          return c.json(
            {
              error: {
                type: "not_found",
                code: "realtime_session_not_found",
                message: "no session with that id belongs to this project",
              },
            },
            404,
          );
        }
        return c.json({ session_id: sessionId, status: "CLOSED" });
      },
      (b) =>
        policy(gatewayPolicy())(b)
          .withParams(z.object({ session_id: z.string().min(1) }))
          .withRawResponse(GATEWAY_INTERNAL_ANSWER),
    )
    .registerRoute(
      "get",
      "/bootstrap",
      MANAGEMENT_API_VERSION,
      (c) => notImplemented(c),
      (b) => policy(gatewayPolicy())(b).withRawResponse(GATEWAY_INTERNAL_ANSWER),
    )
    .build();
}
