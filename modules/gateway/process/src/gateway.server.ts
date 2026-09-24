import { bindRestCredential, bindRestMiddleware, ForbiddenError } from "@langwatch/api/rest";
import type { GatewayRealtimeSession } from "@langwatch/gateway-contract";
import { defineServerModule } from "@langwatch/kernel";
import type { RedisConnection } from "@langwatch/redis-client";
import { nowInstant, type Instant } from "@langwatch/time";

import { GatewayApp } from "./app/gateway.app.ts";
import type {
  GatewayModelProviderCredentials,
  GatewaySpendConfirmation,
} from "./app/gateway.members.ts";
import { gatewaySpendEventing } from "./eventing/gateway-spend.pipeline.ts";
import type { GatewayRealtimeSessionRepository } from "./repositories/gateway-realtime-session.repository.ts";
import {
  PrismaGatewayElevenLabsCredentialRepository,
  type GatewayElevenLabsCredentialDatabase,
} from "./repositories/prisma/prisma.gateway-elevenlabs-credential.repository.ts";
import {
  PrismaGatewayRealtimeSessionRepository,
  type GatewayRealtimeSessionDatabase,
} from "./repositories/prisma/prisma.gateway-realtime-session.repository.ts";
import { RedisGatewayBudgetChangeDedupeRepository } from "./repositories/redis/redis.gateway-budget-change-dedupe.repository.ts";
import {
  GatewayBudgetChangeDedupeService,
  type BudgetChangeEventDedupeService,
} from "./services/gateway-budget-change-dedupe.service.ts";
import { GatewayElevenLabsCredentialService } from "./services/gateway-elevenlabs-credential.service.ts";
import {
  elevenLabsConversationReportSchema,
  GatewayRealtimeSessionReconciliationService,
  realtimeSessionReconciliationConfig,
  type ElevenLabsConversationReader,
  type ElevenLabsConversationReport,
  type RealtimeSessionReconciliationClock,
  type RealtimeSessionReconciliationLogger,
  type RealtimeSessionReconciliationRepository,
} from "./services/gateway-realtime-session-reconciliation.service.ts";
import {
  GatewayRealtimeSessionService,
  type GatewayRealtimeSessionCollaborators,
} from "./services/gateway-realtime-session.service.ts";
import { ModelCatalogGatewaySpendRatingService } from "./services/model-catalog-gateway-spend-rating.service.ts";
import { agentCacheRest } from "./transport/agent-cache.rest.ts";
import { elevenLabsSignature, elevenLabsWebhookRest } from "./transport/elevenlabs-webhook.rest.ts";
import { gatewayBudgetTrpcTransport } from "./transport/gateway-budget.trpc.ts";
import { gatewayCacheRuleTrpcTransport } from "./transport/gateway-cache-rule.trpc.ts";
import { gatewayGuardrailTrpcTransport } from "./transport/gateway-guardrail.trpc.ts";
import { gatewayInternalRest } from "./transport/gateway-internal.rest.ts";
import { gatewayPlatformRest } from "./transport/gateway-platform.rest.ts";
import { gatewaySpendEventTrpcTransport } from "./transport/gateway-spend-event.trpc.ts";
import { gatewaySpendBillingPlanGate, gatewaySpendRest } from "./transport/gateway-spend.rest.ts";
import { gatewayUsageTrpcTransport } from "./transport/gateway-usage.trpc.ts";
import { virtualKeyTrpcTransport } from "./transport/virtual-key.trpc.ts";

export type { GatewayInfrastructure } from "./app/gateway.app.ts";

export const gatewayServer = defineServerModule("gateway")
  .withApp(GatewayApp)
  .withTransports(
    agentCacheRest,
    elevenLabsWebhookRest,
    gatewayInternalRest,
    gatewayBudgetTrpcTransport,
    gatewayCacheRuleTrpcTransport,
    gatewayGuardrailTrpcTransport,
    gatewayPlatformRest,
    gatewaySpendRest,
    gatewaySpendEventTrpcTransport,
    gatewayUsageTrpcTransport,
    virtualKeyTrpcTransport,
  )
  .withEventing(gatewaySpendEventing)
  .withTransportFacts(({ app, dependencies }) => {
    if (!(app instanceof GatewayApp)) {
      throw new TypeError("Gateway transport requires its constructed application");
    }

    return [
      // The gateway control plane is signed rather than bearer-authenticated.
      // It owns the same declared secret as the data-plane client.
      bindRestCredential("internalSecret", () => app.internalDoor),
      // The callback arrives publicly and the application verifies the raw bytes
      // against the provider row's own stored secret, so the header is all the
      // transport carries.
      bindRestMiddleware(elevenLabsSignature, (context) => ({
        signature: context.req.header("elevenlabs-signature"),
      })),
      /**
       * ADR-072: the reconciliation pull gates under the webhook platform's
       * plan flag, resolved per request after auth and the permission check.
       * Fail-closed: a rejected lookup refuses; no plan store refuses at boot.
       */
      bindRestMiddleware(gatewaySpendBillingPlanGate, async (context) => {
        const organization = context.get("organization") as { id: string };
        const plan = await dependencies.entitlement.getActivePlan({
          organizationId: organization.id,
        });
        if (plan.webhookEndpointsEnabled !== true) {
          throw new ForbiddenError(
            "The billing events API is an enterprise feature; this organization's plan does not include it.",
          );
        }

        return {};
      }),
    ];
  });

/**
 * The advisory dedupe window a spend graph debits through: without it
 * BUDGET_UPDATED fires on every debit and a busy project evicts its own gateway
 * bundles as fast as it spends. With no Redis the stand-in emits every time.
 */
export function createGatewayBudgetChangeDedupe(options: {
  redis?: RedisConnection | null | undefined;
}): BudgetChangeEventDedupeService {
  return GatewayBudgetChangeDedupeService.create(
    options.redis ? RedisGatewayBudgetChangeDedupeRepository.create(options.redis) : null,
  );
}

/** The vendor the reconciliation sweep reads back from. */
const RECONCILED_VENDOR = "elevenlabs";

/**
 * One conversation as the vendor answered it, read behind the process's own
 * egress fence. The bytes are the process's to fetch; what they mean is this
 * feature's to say.
 */
export interface ElevenLabsConversationSource {
  readConversationBody(input: {
    apiKey: string;
    baseUrl: string;
    conversationId: string;
    timeoutMs: number;
  }): Promise<{ body?: unknown; notFound: boolean }>;
}

/** What a process holds before this feature can reconcile brokered voice sessions. */
export type GatewayRealtimeSessionReconciliationSubstrates = Readonly<{
  database: GatewayRealtimeSessionDatabase & GatewayElevenLabsCredentialDatabase;
  /** The Model Provider feature's credential reader, which owns the cipher. */
  providerCredentials: GatewayModelProviderCredentials;
  conversations: ElevenLabsConversationSource;
  /**
   * The gateway spend pipeline's own `confirmSpend`, as this process registered
   * it: a reconciled session confirms into the SAME pipeline the data plane's
   * drainer sends to, since two paths writing one spend record disagree.
   */
  spendConfirmation: GatewaySpendConfirmation;
  logger: RealtimeSessionReconciliationLogger;
  clock?: RealtimeSessionReconciliationClock | undefined;
}>;

/**
 * The poller that settles brokered voice sessions whose post-call webhook never
 * arrived. Rating is the vertical's one seam: the session bills on duration and
 * the vendor's own cost figure is stored beside the answer as evidence.
 */
export function createGatewayRealtimeSessionReconciliation(
  substrates: GatewayRealtimeSessionReconciliationSubstrates,
): GatewayRealtimeSessionReconciliationService {
  const sessions = PrismaGatewayRealtimeSessionRepository.create({
    database: substrates.database,
  });

  return GatewayRealtimeSessionReconciliationService.create({
    repository: GatewayRealtimeSessionSweep.create({
      sessions,
      collaborators: {
        sessions,
        spendRating: ModelCatalogGatewaySpendRatingService.create(),
        spendConfirmation: substrates.spendConfirmation,
      },
    }),
    credentials: GatewayElevenLabsCredentialService.create({
      providers: PrismaGatewayElevenLabsCredentialRepository.create({
        database: substrates.database,
      }),
      credentials: substrates.providerCredentials,
    }),
    conversations: ElevenLabsConversationReports.create(substrates.conversations),
    logger: substrates.logger,
    config: realtimeSessionReconciliationConfig,
    clock: substrates.clock ?? { now: () => nowInstant() },
  });
}

/** The session rows, read and closed through the feature's own operations. */
class GatewayRealtimeSessionSweep implements RealtimeSessionReconciliationRepository {
  static create(options: {
    sessions: GatewayRealtimeSessionRepository;
    collaborators: GatewayRealtimeSessionCollaborators;
  }): GatewayRealtimeSessionSweep {
    return new GatewayRealtimeSessionSweep(options.sessions, options.collaborators);
  }

  readonly #operations = GatewayRealtimeSessionService.create();

  private constructor(
    private readonly sessions: GatewayRealtimeSessionRepository,
    private readonly collaborators: GatewayRealtimeSessionCollaborators,
  ) {}

  expireStaleSessions(input: { now: Instant }): Promise<number> {
    return this.#operations.expireStaleRealtimeSessions({
      now: input.now,
      collaborators: this.collaborators,
    });
  }

  listOpenElevenLabsSessions(input: {
    mintedBefore: Instant;
    limit: number;
  }): Promise<GatewayRealtimeSession[]> {
    return this.sessions.findOpenAwaitingVendorReport({ vendor: RECONCILED_VENDOR, ...input });
  }

  async releaseMissingVendorConversation(input: {
    sessionId: string;
    projectId: string;
    reason: string;
  }): Promise<void> {
    await this.#operations.releaseRealtimeSession({
      ...input,
      status: "EXPIRED",
      collaborators: this.collaborators,
    });
  }

  confirmSession(input: {
    session: GatewayRealtimeSession;
    audioMs: number;
    vendorCostRaw: ElevenLabsConversationReport["metadata"] | null;
    durationMs: number;
    reason: string;
  }): Promise<void> {
    return this.#operations.closeAndConfirmRealtimeSession({
      session: input.session,
      usage: { audio_ms: input.audioMs },
      vendorCostRaw: input.vendorCostRaw,
      durationMs: input.durationMs,
      reason: input.reason,
      collaborators: this.collaborators,
    });
  }
}

/** The vendor's answer, read as this feature's report or as nothing at all. */
class ElevenLabsConversationReports implements ElevenLabsConversationReader {
  static create(source: ElevenLabsConversationSource): ElevenLabsConversationReports {
    return new ElevenLabsConversationReports(source);
  }

  private constructor(private readonly source: ElevenLabsConversationSource) {}

  async readConversation(input: {
    apiKey: string;
    baseUrl: string;
    conversationId: string;
    timeoutMs: number;
  }): Promise<{ report?: ElevenLabsConversationReport; notFound: boolean }> {
    const read = await this.source.readConversationBody(input);
    if (read.notFound) return { notFound: true };

    const parsed = elevenLabsConversationReportSchema.safeParse(read.body);
    return parsed.success ? { report: parsed.data, notFound: false } : { notFound: false };
  }
}
