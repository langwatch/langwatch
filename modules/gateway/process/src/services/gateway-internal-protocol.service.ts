import {
  attributedUserBucketScopeId,
  bucketPeriodFloorMs,
  bucketScopeIdFor,
  GATEWAY_INTERNAL_SPEND_COMMANDS,
  type GatewayBudget,
  type GatewayInternalSpendCommandName,
  type GatewayInternalSpendCommandRecord,
  type GatewayInternalProtocol,
  type GatewayPricedSpend,
  type GatewayPricedSpendResult,
  type SpendUsage,
} from "@langwatch/gateway-contract";
import { createLogger } from "@langwatch/observability";
import type { ProjectApi } from "@langwatch/project-contract";
import { nowInstant, type Instant } from "@langwatch/time";

import type {
  GatewayBudgetSpend,
  GatewayChangeEvents,
  GatewaySpendRating,
} from "../app/gateway.members.ts";
import {
  admitSpendWireSchema,
  confirmSpendWireSchema,
  EMPTY_SPEND_USAGE,
  failSpendWireSchema,
} from "../eventing/gateway-spend-commands.process.ts";
import type { GatewayInternalStoreRepository } from "../repositories/gateway-internal-store.repository.ts";
import type { GatewayConfigMaterialiserService } from "./gateway-config-materialisation.service.ts";
import type { GatewayGuardrailEvaluationService } from "./gateway-guardrail-evaluation.service.ts";
import type { GatewayJwtService } from "./gateway-jwt.service.ts";
import {
  GatewayRealtimeSessionService,
  type GatewayRealtimeSessionCollaborators,
} from "./gateway-realtime-session.service.ts";
import type { VirtualKeyService } from "./virtual-key.service.ts";

const realtimeSessionService = GatewayRealtimeSessionService.create();
const logger = createLogger("langwatch:gateway-internal");

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
export type GatewayCodexRefresh = (input: {
  providerRowId: string;
}) => Promise<
  | { status: "refreshed"; accessToken: string; accountId: string }
  | { status: "not_connected" }
  | { status: "session_expired" }
>;

/** Everything the internal control plane reaches that it does not own. */
export type GatewayInternalProtocolMembers = Readonly<{
  /** The SAME virtual-key service every other gateway door reads. */
  virtualKeys: VirtualKeyService;
  /** The project directory a key's trace destination is resolved through. */
  projects: ProjectApi;
  /** Mints the short-lived credential the data plane presents onward. */
  jwt: GatewayJwtService | undefined;
  /** The row reads no service on this package owns. */
  store: GatewayInternalStoreRepository;
  /** The durable revision feed the configuration long-poll walks. */
  changes: GatewayChangeEvents;
  /** Builds one key's warm-cache configuration bundle. */
  config: GatewayConfigMaterialiserService | undefined;
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

/** Callable boundary for the deployment-internal gateway protocol. */
export class GatewayInternalProtocolService implements GatewayInternalProtocol {
  #members: GatewayInternalProtocolMembers;

  private constructor(members: GatewayInternalProtocolMembers) {
    this.#members = members;
  }

  static create(members: GatewayInternalProtocolMembers): GatewayInternalProtocolService {
    return new GatewayInternalProtocolService(members);
  }

  findVirtualKeyBySecret(secret: string) {
    return this.#members.virtualKeys.findBySecretInternal(secret);
  }

  findTraceDestination(projectId: string) {
    return this.#members.projects.findTraceDestination(projectId);
  }

  signJwt(input: Parameters<GatewayJwtService["sign"]>[0]) {
    const jwt = this.#members.jwt;
    if (!jwt) throw new Error("gateway JWT signing is unavailable in this deployment");

    return jwt.sign(input);
  }

  touchVirtualKeyUsage(id: string): Promise<void> {
    return this.#members.virtualKeys.touchUsage(id);
  }

  refreshCodex(input: { providerRowId: string }) {
    return this.#members.refreshCodex?.(input) ?? null;
  }

  findVirtualKeyForConfig(id: string) {
    return this.#members.store.findVirtualKeyForConfig(id);
  }

  async configVersionToken(input: Parameters<GatewayConfigMaterialiserService["versionToken"]>[0]) {
    const config = this.#members.config;
    if (!config)
      throw new Error("gateway config materialisation is unavailable in this deployment");

    return config.versionToken(input);
  }

  async materialiseConfig(input: Parameters<GatewayConfigMaterialiserService["materialise"]>[0]) {
    const config = this.#members.config;
    if (!config)
      throw new Error("gateway config materialisation is unavailable in this deployment");

    return config.materialise(input);
  }

  listChanges(organizationId: string, since: bigint, limit: number) {
    return this.#members.changes.since(organizationId, since, limit);
  }

  currentRevision(organizationId: string) {
    return this.#members.changes.currentRevision(organizationId);
  }

  checkGuardrails(input: Parameters<GatewayGuardrailEvaluationService["check"]>[0]) {
    return this.#members.guardrails?.check(input) ?? null;
  }

  async budgetBucketSpend(input: { budgetId: string; endUserId: string }) {
    const budget = await this.#members.store.findBudget(input.budgetId);
    if (!budget || budget.archivedAt || budget.scopeType !== "ATTRIBUTED_USER") {
      return { status: "not_found" } as const;
    }
    if (!this.#members.budgetSpend) {
      return { status: "available", spentMicroUsd: 0, bucketScopeId: null } as const;
    }
    const bucketScopeId = bucketScopeIdFor(
      budget,
      attributedUserBucketScopeId(budget.scopeId, input.endUserId),
    );
    const boundary = await this.#members.store.findBucketBoundary({
      budgetId: budget.id,
      bucketScopeId,
    });
    const spentMicroUsd = await bucketSpentMicroUsd({
      store: this.#members.store,
      budgetRepository: this.#members.budgetSpend,
      budget,
      bucketScopeId,
      periodFloorMs: bucketPeriodFloorMs(budget, boundary?.periodStartedAt),
    });
    return { status: "available", spentMicroUsd, bucketScopeId } as const;
  }

  async submitSpendCommands(records: GatewayInternalSpendCommandRecord[]) {
    const pipeline = this.#members.spend;
    if (!pipeline) return { status: "unavailable" } as const;
    const { perCommand, rejected } = groupSpendCommands(records, pipeline.rating);
    await enrichAttributedCommands({
      store: this.#members.store,
      admits: perCommand.admitSpend,
      outcomes: [...perCommand.confirmSpend, ...perCommand.failSpend],
    });
    const unregistered = await sendSpendCommands(pipeline.commands, perCommand);
    if (unregistered) return { status: "unregistered", command: unregistered } as const;
    return { status: "accepted", accepted: records.length - rejected.length, rejected } as const;
  }

  /**
   * Appends one outcome the caller priced itself. Straight onto the pipeline's
   * `confirmSpend`, not through the drain path: that re-rates every outcome
   * against the model registry, which holds no entry for a judgement.
   */
  async recordPricedSpend(input: GatewayPricedSpend): Promise<GatewayPricedSpendResult> {
    const sender = this.#members.spend?.commands.confirmSpend;
    if (!sender) return { status: "unavailable" } as const;
    await sender.send(pricedSpendCommandData(input));

    return { status: "recorded" } as const;
  }

  async reserveRealtimeSession(
    input: Omit<
      Parameters<GatewayRealtimeSessionService["reserveRealtimeSession"]>[0],
      "collaborators"
    >,
  ) {
    const collaborators = this.#members.realtimeSessions;
    return collaborators
      ? realtimeSessionService.reserveRealtimeSession({ collaborators, ...input })
      : null;
  }

  async correlateRealtimeSession(
    input: Omit<
      Parameters<GatewayRealtimeSessionService["correlateRealtimeSession"]>[0],
      "collaborators"
    >,
  ) {
    const collaborators = this.#members.realtimeSessions;
    return collaborators
      ? realtimeSessionService.correlateRealtimeSession({ collaborators, ...input })
      : null;
  }

  async releaseRealtimeSession(
    input: Omit<
      Parameters<GatewayRealtimeSessionService["releaseRealtimeSession"]>[0],
      "collaborators"
    >,
  ) {
    const collaborators = this.#members.realtimeSessions;
    return collaborators
      ? realtimeSessionService.releaseRealtimeSession({ collaborators, ...input })
      : null;
  }

  async reportRealtimeSessionUsage(
    input: Omit<
      Parameters<GatewayRealtimeSessionService["reportRealtimeSessionUsage"]>[0],
      "collaborators"
    >,
  ) {
    const collaborators = this.#members.realtimeSessions;
    return collaborators
      ? realtimeSessionService.reportRealtimeSessionUsage({ collaborators, ...input })
      : null;
  }
}

// ── attributed-user bucket spend ────────────────────────────────────────

/**
 * Per-bucket spend for ATTRIBUTED_USER templates. Per-user cardinality is
 * unbounded, so the gateway resolves and caches the request's own bucket here,
 * not the whole template.
 */
async function bucketSpentMicroUsd(params: {
  store: GatewayInternalStoreRepository;
  budgetRepository: GatewayBudgetSpend;
  budget: GatewayBudget;
  bucketScopeId: string;
  periodFloorMs: number | undefined;
}): Promise<number> {
  const projectIds = await params.store.findProjectIdsForOrganization(params.budget.organizationId);
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
  data: Record<string, unknown> & {
    model: string;
    usage: SpendUsage;
    rate_version?: string;
  },
  rating: GatewaySpendRating,
): Record<string, unknown> {
  const rated = rating.rate({
    model: data.model,
    usage: data.usage,
    rateVersion: data.rate_version,
  });

  return { ...data, cost_nano_usd: rated.costNanoUsd, rate_version: rated.rateVersion };
}

/**
 * The internal command data one wire record maps to, or why it cannot be
 * accepted. `project_id` on the wire is the internal `tenantId`; only admits
 * carry the pod identity the gap detector reads.
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

  const data: Record<string, unknown> = validated.data;
  if (record.command === "admitSpend") {
    return { ok: true, data };
  }

  const outcome =
    record.command === "confirmSpend"
      ? confirmSpendWireSchema.parse(mapped)
      : failSpendWireSchema.parse(mapped);

  return {
    ok: true,
    data: pricedOutcomeData(
      {
        ...outcome,
        usage: outcome.usage ?? {},
      },
      rating,
    ),
  };
}

/**
 * The spine's confirmed-outcome shape for a self-priced outcome: no admission
 * in front of it, no virtual key and no provider, and the price and its stamp
 * exactly as the caller resolved them.
 */
function pricedSpendCommandData(input: GatewayPricedSpend): Record<string, unknown> {
  return {
    gateway_request_id: input.requestId,
    occurred_at: input.occurredAt,
    tenantId: input.projectId,
    model: input.model,
    model_provider_id: "",
    usage: { ...EMPTY_SPEND_USAGE, input_tokens: input.inputTokens },
    rate_version: input.rateVersion,
    duration_ms: 0,
    organization_id: input.organizationId,
    virtual_key_id: "",
    end_user_id: "",
    trace_id: "",
    request_type: input.requestType,
    labels: [],
    metadata: input.metadata ?? "",
    admitted_at: 0,
    cost_nano_usd: input.costNanoUsd,
    principal_user_id: "",
    team_id: input.teamId,
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
  perCommand: Record<GatewayInternalSpendCommandName, Record<string, unknown>[]>;
  rejected: { index: number; code: string }[];
} {
  const perCommand: Record<GatewayInternalSpendCommandName, Record<string, unknown>[]> = {
    admitSpend: [],
    confirmSpend: [],
    failSpend: [],
  };
  const rejected: { index: number; code: string }[] = [];

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
  store: GatewayInternalStoreRepository,
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
 * Joins every admission to attribution the gateway cannot see, via two
 * batched reads. A missing key/team degrades to empty attribution (logged);
 * a Prisma failure 500s so the drainer retries — nothing is silently dropped.
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
  store: GatewayInternalStoreRepository;
  admits: Record<string, unknown>[];
  outcomes: Record<string, unknown>[];
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
  perCommand: Record<GatewayInternalSpendCommandName, Record<string, unknown>[]>,
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
