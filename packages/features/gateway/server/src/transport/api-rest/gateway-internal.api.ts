/**
 * Contract: specs/ai-gateway/_shared/contract.md §4 (v0.1)
 * Hono routes for internal gateway control-plane endpoints, consumed only by the Go AI Gateway. All paths protected by HMAC (LW_GATEWAY_INTERNAL_SECRET + X-LangWatch-Gateway-Signature); never expose publicly (Helm blocks /api/internal at ingress). Moved whole out of the retired application's module-level app/prisma/env, each becoming an OPTIONAL member of GatewayInternalRestPorts — an absent one refuses its route by name (503) rather than the family failing to mount or, worse, silently succeeding (a guardrail that allows or a spend command accepted and dropped is worse than a refusal).
 */

// biome-ignore-all lint/suspicious/noEmptyBlockStatements: the empty blocks in this file are deliberate no-ops.

import { internalSecret } from "@langwatch/api";
import type { AppRestSecurity, MountableRestApp } from "@langwatch/api/rest";
import type { MonitorService } from "@langwatch/monitor-contract";
import { createLogger } from "@langwatch/observability";
import type { ProjectService } from "@langwatch/project-contract";
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
} from "../../adapters/virtual-key-crypto.adapter";
import type { GatewayJwtAdapter } from "../../adapters/jwt.gateway-token.adapter";
import type { GatewayBudgetSpendPort } from "../../ports/gateway-budget-spend.port";
import type { GatewayChangeEventsPort } from "../../ports/gateway-change-events.port";
import type { GatewayInternalStorePort } from "../../ports/gateway-internal-store.port";
import type { GatewaySpendRatingPort } from "../../ports/gateway-spend-rating.port";
import {
  admitSpendWireSchema,
  confirmSpendWireSchema,
  failSpendWireSchema,
  type SpendUsage,
  spendUsageSchema,
} from "../../processes/gateway-spend-commands.process";
import type { GatewayConfigMaterialiserService } from "../../services/gateway-config-materialisation.service";
import {
  GatewayGuardrailEvaluationService,
  GUARDRAIL_WIRE_DIRECTIONS,
  type EvaluatorRunner,
} from "../../services/gateway-guardrail-evaluation.service";
import {
  GatewayRealtimeSessionService,
  type GatewayRealtimeSessionCollaborators,
} from "../../services/gateway-realtime-session.service";
import type { VirtualKeyService } from "../../services/virtual-key.service";
import type { GatewayBudget } from "@langwatch/gateway-contract";
import type { GatewayGuardrailRepository } from "../../repositories/gateway-guardrail.repository";

const realtimeSessionService = GatewayRealtimeSessionService.create();
const logger = createLogger("langwatch:gateway-internal");

/**
 * Spend pipeline's command senders, as this family dispatches to them — structural, not the eventing runtime's own type: a named sender per command, admitting undefined per name so a missing registration is a 503 the caller can act on rather than an assumption all three exist.
 */
export interface GatewaySpendCommandSender {
  sendBatch?: (payloads: unknown[]) => Promise<unknown>;
  send: (payload: unknown) => Promise<unknown>;
}

/** Everything the internal control plane reaches that it does not own. */
export type GatewayInternalRestPorts = Readonly<{
  /**
   * Shared HMAC secret the Go data plane signs with, or none. A function, not a value — the deployment may configure it after the family is built, and an unset secret must answer 500 rather than let the gate fall open.
   */
  internalSecret: () => string | undefined;
  /** The SAME virtual-key service every other gateway door reads. */
  virtualKeys: () => VirtualKeyService;
  /** The project directory a key's trace destination is resolved through. */
  projects: () => ProjectService;
  /** Mints the short-lived credential the data plane presents onward. */
  jwt: () => GatewayJwtAdapter;
  /** The row reads no service on this package owns. */
  store: () => GatewayInternalStorePort;
  /** The durable revision feed the configuration long-poll walks. */
  changes: () => GatewayChangeEventsPort;
  /** Builds one key's warm-cache configuration bundle. */
  config: () => GatewayConfigMaterialiserService;
  /**
   * Budget ledger, or none — absent on a deployment with no ClickHouse. The bucket read then reports zero spend rather than inventing a figure, keeping enforcement permissive (the retired application's own behaviour).
   */
  budgetSpend: () => GatewayBudgetSpendPort | undefined;
  /**
   * Refreshes a provider row's stored Codex OAuth session, or none — absent where this process composed no model-provider service, so the recovery road for a 401 from OpenAI's codex backend refuses by name.
   */
  refreshCodex?:
    | ((input: {
        providerRowId: string;
      }) => Promise<
        | { status: "refreshed"; accessToken: string; accountId: string }
        | { status: "not_connected" }
        | { status: "session_expired" }
      >)
    | undefined;
  /**
   * Monitor directory + evaluator runtime for one guardrail check, or none — all three together or none, since a guardrail names a monitor (carrying the check type), the attachment scoping it, and the evaluator to run it. Partial composition refuses the route by name rather than allowing every request — a guardrail that can't verdict and answers allow has quietly stopped protecting.
   */
  guardrails?:
    | (() => {
        repository: GatewayGuardrailRepository;
        monitors: MonitorService;
        runEvaluator: EvaluatorRunner;
      })
    | undefined;
  /**
   * Gateway spend pipeline's commands and its one pricing seam, or none — absent where this process registered no spend pipeline, so /spend-commands answers 503 spend_pipeline_disabled, the code the data plane's drainer already spools against.
   */
  spend?:
    | (() =>
        | {
            commands: Record<string, GatewaySpendCommandSender | undefined>;
            rating: GatewaySpendRatingPort;
          }
        | undefined)
    | undefined;
  /**
   * What a brokered realtime voice session is booked, correlated and settled against, or none — absent where this process composed no spend confirmation path, meaning a booked session would run with nowhere to report usage, i.e. never billed.
   */
  realtimeSessions?: (() => GatewayRealtimeSessionCollaborators) | undefined;
}>;

/**
 * Contract 4.6. Directions are the wire vocabulary the data plane sends, deliberately not the Prisma enum — an earlier schema version used storage values, so every real gateway call failed validation and the data plane fell back to allowing the request.
 */
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

/**
 * Refusal every realtime-session route answers on a process with no session store — a 503, not a booking that succeeds and reports nothing: the gateway refuses the mint when this refuses, which is what makes the per-key cap real and stops an unbilled call running.
 */
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
 * Verify gateway HMAC with replay protection: canonical = method+"\n"+path+"\n"+unix_ts+"\n"+hex(sha256(body)); X-LangWatch-Gateway-Signature = hex(hmac_sha256(secret, canonical)); X-LangWatch-Gateway-Timestamp within ±300s. Checks missing headers, then signature (constant-time), then timestamp, in that order — HMAC before timestamp prevents a timing channel revealing which failed. Emits the specific decision code at WARN (loggerMiddleware only logs status=401) so a dogfooder isn't left guessing between five causes.
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
    const now = Math.floor(Date.now() / 1000);
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

/**
 * §4.1 — resolve a raw virtual key to a signed JWT + current revision. Request: {key_presented, gateway_node_id}; response: {jwt, revision, key_id, display_prefix}. A refusal uses the contract's error shape.
 */
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

/**
 * Why a resolved key bars itself from serving, or null if it may — each stop carries its own code so a tenant can tell "we turned you off" from "your credential is wrong" from "your key ran out" (platform tooling branches on it). Expiry is a date, checked here rather than read off status (extending it is an ordinary edit); a key expiring now stops resolving immediately, and a token minted before then ends at the date since the mint clamps exp to it.
 */
function virtualKeyStatusRejection({
  status,
  expiresAt,
}: {
  status: string;
  expiresAt: Date | null;
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
  if (expiresAt && expiresAt.getTime() <= Date.now()) {
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

/**
 * §9 — startup bootstrap: paginated stream of all non-revoked VK JWTs so the gateway can serve traffic if the control plane is offline on cold start. Enterprise opt-in (LW_GATEWAY_BOOTSTRAP_PULL=true). Query: ?cursor=<opaque>&limit=1000. Response: {jwts, next_cursor, current_revision}.
 */

// ── attributed-user bucket spend ────────────────────────────────────────

/**
 * Per-bucket spend for ATTRIBUTED_USER templates: the bundle carries only the template entry (per-user cardinality is unbounded), so the gateway resolves and briefly caches the request's own bucket here, honoring whichever is later of the template's period boundary or a per-user reset boundary. An org with no projects has nothing to read, so it reports zero.
 */
async function bucketSpentMicroUsd(params: {
  store: GatewayInternalStorePort;
  budgetRepository: GatewayBudgetSpendPort;
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
 * The single seam that prices a gateway outcome. The wire carries quantities, never money, so the server rates here once and the appended event carries the figure from then on — fold, attributed-user debits and webhook envelope all copy it instead of each pricing the request at its own instant against a moving catalog. The gateway always names a model on an outcome (resolved once dispatch settled it, requested before that), the identity the ledger stores.
 */
function pricedOutcomeData(
  data: Record<string, unknown>,
  rating: GatewaySpendRatingPort,
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
  rating: GatewaySpendRatingPort,
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
  rating: GatewaySpendRatingPort,
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
  lastUsedAt: Date | null;
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

/**
 * Advances lastUsedAt on keys this batch admitted. Admission sees every kind of use (including requests later blocked, or whose outcome never arrives), so one conditional write per drain batch, decided off rows already read; a batch touching only recently-used keys writes nothing. Best effort: the column is oversight, not enforcement, so failing the batch over it would cost a retry of records that already appended.
 */
async function touchAdmittedVirtualKeys(
  store: GatewayInternalStorePort,
  virtualKeys: AttributionVirtualKey[],
  now: Date,
): Promise<void> {
  const staleIds = virtualKeys
    .filter(
      (vk) =>
        !vk.lastUsedAt || now.getTime() - vk.lastUsedAt.getTime() > VIRTUAL_KEY_TOUCH_THROTTLE_MS,
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
 * Joins every admission to attribution the gateway can't see (key's principal, tenant project's team) via two batched reads for up to 500 records; the appended event carries the result so nothing downstream re-reads identity. MISSING (a deleted key, a teamless project) is a fact about the world — that record degrades to empty attribution, still owes org/project/key debits, and logs ids so skipped team/principal/group budgets can be reconciled. A Prisma FAILURE is an unknown, not a fact, and an event is immutable once appended, so it 500s and the drainer retries the whole batch. What couldn't be resolved is always reported, never dropped — the admission is already durable on the gateway's side, so each is a control-plane inconsistency to chase, not a reason to lose billing evidence.
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
  store: GatewayInternalStorePort;
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
    new Date(),
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

/**
 * A patch has to change something. Both fields are optional on their own, so this refinement enforces the 400 the message states — without it, a body carrying only project_id parses, applies nothing, and answers 404 as though the session were missing.
 */
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

/**
 * Builds the /api/internal/gateway family over one process's ports. verifySecret applies the HMAC verifier per route in the builder chain rather than an app-wide secured.use(...), keeping each route's access policy declared where the route is.
 */
export function createGatewayInternalRestApp(options: {
  security: AppRestSecurity;
  ports: GatewayInternalRestPorts;
}): MountableRestApp {
  const { security, ports } = options;
  const secured = security.createServiceApp({
    basePath: "/api/internal/gateway",
    verifySecret: verifyGatewaySignature(ports.internalSecret),
  });

  /**
   * §4.7: connectivity probe for the public /health endpoint. The Go gateway's statusprobe calls this every 15s and serves the cached verdict to the status page — riding the signed channel is the point, since a 200 proves the shared HMAC secret matches too (the misconfig where every pod looks green while every VK resolve is refused). Body deliberately static; only the status code is read.
   */
  secured.access(gatewayPolicy()).get("/health", (c) => {
    return c.json({ status: "ok" });
  });

  secured.access(gatewayPolicy()).post("/resolve-key", async (c) => {
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

    const service = ports.virtualKeys();
    const vk = await service.tryGetBySecretInternal(presented);
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
      ? await ports.projects().tryGetTraceDestination(vk.traceProjectId)
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
    void service.touchUsage(vk.id).catch(() => {});

    return c.json({
      jwt,
      revision: vk.revision.toString(),
      key_id: vk.id,
      display_prefix: vk.displayPrefix,
    });
  });

  /**
   * Spec: specs/model-providers/codex-account-provider.feature
   * Codex token refresh — the gateway's recovery road for a 401 from OpenAI's codex backend. Refreshes the provider row's stored OAuth session (single issuer round-trip under concurrent 401 bursts) and returns a fresh access token; a dead session answers codex_session_expired, forwarded so Langy renders the re-authenticate card. Request: {provider_row_id}. Response: {access_token, account_id} | error.
   */
  secured.access(gatewayPolicy()).post("/codex/refresh", async (c) => {
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
  });

  /**
   * §4.2 — full warm-cache config by vk_id with `If-None-Match: <revision>`.
   * Returns 304 Not Modified when client has current revision.
   */
  secured.access(gatewayPolicy()).get("/config/:vk_id", async (c) => {
    const vkId = c.req.param("vk_id");
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
  });

  /**
   * §4.3 — mutations since a given revision. Short, polite long-poll: Hono isn't right for 25s held sockets, so this loops briefly (2s sleeps, ~10s max); the Go client falls straight back into the next long-poll on 204. Query: ?since=<revision>&timeout_s=10. Response: {current_revision, changes:[{kind,vk_id,revision}]}. 204 when no diff within timeout.
   */
  secured.access(gatewayPolicy()).get("/changes", async (c) => {
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
    const deadline = Date.now() + timeoutSeconds * 1000;

    while (Date.now() < deadline) {
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
  });

  /**
   * §4.6 — inline guardrail pipeline. Request: {vk_id, project_id, direction, guardrail_ids, content, metadata}. Response: {decision, reason, modified_content, policies_triggered}. Runs every referenced guardrail in parallel and aggregates (any block blocks); an evaluator that can't verdict falls to its own failure mode rather than passing, so a broken evaluator can't quietly disable protection. project_id is required — it scopes the lookup so one project's key can't name another's guardrail; a key with no trace project materialises none.
   */
  secured.access(gatewayPolicy()).post("/guardrail/check", async (c) => {
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
    const verdict = await GatewayGuardrailEvaluationService.create({
      repository: guardrails.repository,
      monitors: guardrails.monitors,
      runEvaluator: guardrails.runEvaluator,
    }).check({
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
  });

  secured.access(gatewayPolicy()).get("/budget-bucket-spend", async (c) => {
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
  });

  /**
   * Async spend-command ingest: the drainer posts spooled batches at-least-once; every command carries a per-(request,step) idempotency key at the event store, so redelivery is a no-op and the whole batch retries safely. Per-record acceptance — one malformed record must not wedge the spool, so bad records are reported by index while the rest append (rejects are counted; a nonzero rate is a contract bug, and a rejected outcome still surfaces later via reconciliation). Admissions are enriched before appending, the one thing that can fail the whole batch — an unreadable database answers 500 rather than appending a guessed attribution.
   */
  secured.access(gatewayPolicy()).post("/spend-commands", async (c) => {
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
  });

  /**
   * Books a voice session and decides the key's open-session cap in the same transaction that inserts the row. The gateway calls this BEFORE minting and refuses the mint when this refuses — that ordering is what makes the cap real, since minting first would hand out a working credential before the count said no.
   */
  secured.access(gatewayPolicy()).post("/realtime-sessions", async (c) => {
    const parsed = reserveRealtimeSessionSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json(
        {
          error: {
            type: "bad_request",
            code: "invalid_reservation",
            message: "a session reservation names the session, its tenancy, its key and its vendor",
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
  });

  /**
   * Records the vendor's own conversation id on a booked session, or closes a
   * booking whose mint never produced a credential.
   */
  secured.access(gatewayPolicy()).patch("/realtime-sessions/:session_id", async (c) => {
    const parsed = patchRealtimeSessionSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json(
        {
          error: {
            type: "bad_request",
            code: "invalid_session_patch",
            message: "project_id is required, with a vendor_conversation_id or a terminal status",
          },
        },
        400,
      );
    }
    const sessionId = c.req.param("session_id");
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
  });

  /**
   * Closes an OpenAI voice session with the usage its socket reported. OpenAI reports usage over a socket running client-to-vendor, so the client posting it back is the only path those numbers reach billing; the gateway has already made audio and text counts disjoint.
   */
  secured.access(gatewayPolicy()).post("/realtime-sessions/:session_id/usage", async (c) => {
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
    const sessionId = c.req.param("session_id");
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
  });

  secured.access(gatewayPolicy()).get("/bootstrap", (c) => notImplemented(c));

  return secured.hono;
}
