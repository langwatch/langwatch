import {
  attributedUserBucketScopeId,
  computeBucketPeriodFloorMs,
  bucketScopeIdFor,
  type GatewayBudget,
  type GatewayInternalCodexRefreshResult,
  type GatewayInternalSpendCommandRecord,
  type GatewayGuardrailCheckInput,
  type GatewayGuardrailCheckResult,
  type GatewayInternalProtocol,
  type GatewayRealtimeCorrelation,
  type GatewayRealtimeRelease,
  type GatewayRealtimeReservation,
  type GatewayRealtimeReservationResult,
  type GatewayRealtimeSessionUpdate,
  type GatewayRealtimeUsageOutcome,
  type GatewayRealtimeUsageReport,
  isLicenseTokenShape,
  registryHashForToken,
  type GatewayLicenseTokenRefusal,
  type GatewayLicenseTokenResolution,
  type GatewayPricedSpend,
  type GatewayPricedSpendResult,
  type GatewayInternalSpendSubmission,
  type VirtualKeyWithScopes,
  type GatewayVirtualKeyRecord,
} from "@langwatch/gateway-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { nowInstant, Temporal, type Instant } from "@langwatch/time";

import type { GatewayBudgetSpendRepository } from "../repositories/gateway-budget-spend.repository.ts";
import type { GatewayChangeEventsRepository } from "../repositories/gateway-change-event.repository.ts";
import type { GatewayInternalStoreRepository } from "../repositories/gateway-internal-store.repository.ts";
import type { GatewayConfigMaterialiserService } from "./gateway-config-materialisation.service.ts";
import type { GatewayGuardrailEvaluationService } from "./gateway-guardrail-evaluation.service.ts";
import type { GatewayJwtService } from "./gateway-jwt.service.ts";
import {
  GatewayRealtimeSessionService,
  type GatewayRealtimeSessionCollaborators,
} from "./gateway-realtime-session.service.ts";
import { GatewaySpendCommandIngestService } from "./gateway-spend-command-ingest.service.ts";
import type { GatewaySpendRating } from "./model-catalog-gateway-spend-rating.service.ts";
import type { VirtualKeyService } from "./virtual-key.service.ts";

const realtimeSessionService = GatewayRealtimeSessionService.create();

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
  changes: GatewayChangeEventsRepository;
  /** Builds one key's warm-cache configuration bundle. */
  config: GatewayConfigMaterialiserService;
  /** Absent with no ClickHouse; the bucket read then reports zero spend, not an invented figure. */
  budgetSpend: GatewayBudgetSpendRepository | undefined;
  /** Owns the Codex session a 401 on a Codex-backed provider is recovered through. */
  modelProviders: Pick<ModelProviderApi, "refreshCodexForGateway">;
  /** All-or-nothing; a guardrail that cannot verdict must refuse, never answer allow. */
  guardrails: GatewayGuardrailEvaluationService;
  /** Absent with no spend pipeline registered; /spend-commands then answers 503. */
  spend: GatewayInternalSpendPipeline | undefined;
  /** Absent with no spend confirmation path; a booked session would then never bill. */
  realtimeSessions: GatewayRealtimeSessionCollaborators | undefined;
}>;

/** Callable boundary for the deployment-internal gateway protocol. */
export class GatewayInternalProtocolService implements GatewayInternalProtocol {
  #members: GatewayInternalProtocolMembers;
  #spendCommands: GatewaySpendCommandIngestService;

  private constructor(members: GatewayInternalProtocolMembers) {
    this.#members = members;
    this.#spendCommands = GatewaySpendCommandIngestService.create(members);
  }

  static create(members: GatewayInternalProtocolMembers): GatewayInternalProtocolService {
    return new GatewayInternalProtocolService(members);
  }

  findVirtualKeyBySecret(secret: string): Promise<GatewayVirtualKeyRecord | null> {
    return this.#members.virtualKeys.findBySecretInternal(secret);
  }

  /**
   * The key a presented license token runs under, judged only on the facts
   * licensing wrote onto it. A key with no bound install has not synced, and
   * reads as a license not registered for hosted services.
   */
  async resolveLicenseToken(input: {
    token: string;
    instanceId: string | undefined;
  }): Promise<GatewayLicenseTokenResolution> {
    if (!isLicenseTokenShape(input.token)) return refuse("connect_license_token_malformed");
    const instanceId = input.instanceId?.trim() ?? "";
    if (instanceId === "") return refuse("connect_instance_required");

    const licensed = await this.#members.virtualKeys.findByLicenseTokenHashInternal(
      await registryHashForToken(input.token),
    );
    if (!licensed?.instanceId) return refuse("connect_license_not_registered");
    if (licensed.key.status !== "ACTIVE") return refuse("connect_license_revoked");
    const now = nowInstant();
    if (licensed.expiresAt && Temporal.Instant.compare(licensed.expiresAt, now) <= 0) {
      return refuse("connect_license_expired");
    }
    if (licensed.instanceId !== instanceId) return refuse("connect_wrong_instance");

    const [notAfter] = [licensed.expiresAt, licensed.key.expiresAt]
      .filter((end): end is Instant => end !== null)
      .toSorted((left, right) => Temporal.Instant.compare(left, right));
    return {
      ok: true,
      key: licensed.key,
      ...(notAfter ? { notAfter } : {}),
      connectServices: licensed.services,
    };
  }

  findTraceDestination(projectId: string): Promise<{
    id: string;
    teamId: string;
  } | null> {
    return this.#members.projects.findTraceDestination(projectId);
  }

  signJwt(input: Parameters<GatewayJwtService["sign"]>[0]): {
    jwt: string;
    expiresAt: number;
  } {
    const jwt = this.#members.jwt;
    if (!jwt) throw new Error("gateway JWT signing is unavailable in this deployment");

    return jwt.sign(input);
  }

  touchVirtualKeyUsage(id: string): Promise<void> {
    return this.#members.virtualKeys.touchUsage(id);
  }

  refreshCodex(input: { providerRowId: string }): Promise<GatewayInternalCodexRefreshResult> {
    return this.#members.modelProviders.refreshCodexForGateway(input);
  }

  findVirtualKeyForConfig(id: string): Promise<VirtualKeyWithScopes | null> {
    return this.#members.store.findVirtualKeyForConfig(id);
  }

  configVersionToken(
    input: Parameters<GatewayConfigMaterialiserService["versionToken"]>[0],
  ): Promise<string> {
    return this.#members.config.versionToken(input);
  }

  materialiseConfig(
    input: Parameters<GatewayConfigMaterialiserService["materialise"]>[0],
  ): Promise<unknown> {
    return this.#members.config.materialise(input);
  }

  listChanges(
    organizationId: string,
    since: bigint,
    limit: number,
  ): Promise<{
    currentRevision: bigint;
    events: {
      kind: string;
      virtualKeyId: string | null;
      budgetId: string | null;
      modelProviderId: string | null;
      projectId: string | null;
      revision: bigint;
    }[];
  }> {
    return this.#members.changes.since(organizationId, since, limit);
  }

  currentRevision(organizationId: string): Promise<bigint> {
    return this.#members.changes.currentRevision(organizationId);
  }

  async checkGuardrails(input: GatewayGuardrailCheckInput): Promise<GatewayGuardrailCheckResult> {
    return this.#members.guardrails.check(input);
  }

  async budgetBucketSpend(input: { budgetId: string; endUserId: string }): Promise<
    | {
        status: "not_found";
      }
    | {
        status: "available";
        spentMicroUsd: number;
        bucketScopeId: string | null;
      }
  > {
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
      projects: this.#members.projects,
      budgetRepository: this.#members.budgetSpend,
      budget,
      bucketScopeId,
      periodFloorMs: computeBucketPeriodFloorMs(budget, boundary?.periodStartedAt),
    });
    return { status: "available", spentMicroUsd, bucketScopeId } as const;
  }

  submitSpendCommands(
    records: GatewayInternalSpendCommandRecord[],
  ): Promise<GatewayInternalSpendSubmission> {
    return this.#spendCommands.submitSpendCommands(records);
  }

  /** Appends one outcome the caller priced itself (see the ingest service). */
  recordPricedSpend(input: GatewayPricedSpend): Promise<GatewayPricedSpendResult> {
    return this.#spendCommands.recordPricedSpend(input);
  }

  async reserveRealtimeSession(
    input: GatewayRealtimeReservation,
  ): Promise<GatewayRealtimeReservationResult> {
    const collaborators = this.#members.realtimeSessions;
    if (!collaborators) return { ok: false, reason: "unavailable" } as const;
    return realtimeSessionService.reserveRealtimeSession({ collaborators, ...input });
  }

  async correlateRealtimeSession(
    input: GatewayRealtimeCorrelation,
  ): Promise<GatewayRealtimeSessionUpdate> {
    const collaborators = this.#members.realtimeSessions;
    if (!collaborators) return "unavailable" as const;
    const correlated = await realtimeSessionService.correlateRealtimeSession({
      collaborators,
      ...input,
    });
    return correlated ? ("applied" as const) : ("not_found" as const);
  }

  async releaseRealtimeSession(
    input: GatewayRealtimeRelease,
  ): Promise<GatewayRealtimeSessionUpdate> {
    const collaborators = this.#members.realtimeSessions;
    if (!collaborators) return "unavailable" as const;
    const released = await realtimeSessionService.releaseRealtimeSession({
      collaborators,
      ...input,
    });
    return released ? ("applied" as const) : ("not_found" as const);
  }

  async reportRealtimeSessionUsage(
    input: GatewayRealtimeUsageReport,
  ): Promise<GatewayRealtimeUsageOutcome> {
    const collaborators = this.#members.realtimeSessions;
    if (!collaborators) return "unavailable" as const;
    return realtimeSessionService.reportRealtimeSessionUsage({ collaborators, ...input });
  }
}

// ── attributed-user bucket spend ────────────────────────────────────────

/**
 * Per-bucket spend for ATTRIBUTED_USER templates. Per-user cardinality is
 * unbounded, so the gateway resolves and caches the request's own bucket here,
 * not the whole template.
 */
async function bucketSpentMicroUsd(params: {
  projects: Pick<ProjectApi, "listIdsByOrganization">;
  budgetRepository: GatewayBudgetSpendRepository;
  budget: GatewayBudget;
  bucketScopeId: string;
  periodFloorMs: number | undefined;
}): Promise<number> {
  const projectIds = await params.projects.listIdsByOrganization({
    organizationId: params.budget.organizationId,
  });
  if (projectIds.length === 0) return 0;

  const spends = await params.budgetRepository.findSpendForTargetsAcrossTenants(projectIds, [
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

function refuse(code: GatewayLicenseTokenRefusal): GatewayLicenseTokenResolution {
  return { ok: false, code };
}
