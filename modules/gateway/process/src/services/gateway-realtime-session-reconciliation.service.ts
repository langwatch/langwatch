import type {
  GatewayRealtimeSession,
  GatewayRealtimeSessionRecord,
} from "@langwatch/gateway-contract";
import { HandledError } from "@langwatch/handled-error";
import type { Instant } from "@langwatch/time";

import type {
  ElevenLabsConversationChannel,
  ElevenLabsConversationReport,
} from "../channels/elevenlabs-conversation.channel.ts";
import { REALTIME_SETTLEMENT_BATCH_SIZE } from "../rules/gateway-realtime-session-metering.rules.ts";

export interface RealtimeSessionReconciliationLogger {
  warn(context: Record<string, unknown>, message: string): void;
  info(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
}

export interface RealtimeSessionReconciliationClock {
  now(): Instant;
}

export interface RealtimeSessionReconciliationRepository {
  expireStaleSessions: (input: { now: Instant }) => Promise<number>;
  /** Open sessions the gateway meters itself whose gateway stopped reporting. */
  listOrphanedGatewaySessions: (input: {
    now: Instant;
    limit: number;
  }) => Promise<GatewayRealtimeSession[]>;
  /** Metered sessions past the open window that nothing closed. */
  listSessionsAwaitingSettlement: (input: {
    now: Instant;
    limit: number;
  }) => Promise<GatewayRealtimeSession[]>;
  /** Closes one at what was recorded, or at an estimate when nothing was. */
  settleSession: (input: {
    session: GatewayRealtimeSession;
    orphaned: boolean;
    now: Instant;
  }) => Promise<"estimated" | "closed">;
  listOpenElevenLabsSessions: (input: {
    mintedBefore: Instant;
    limit: number;
  }) => Promise<GatewayRealtimeSessionRecord[]>;
  releaseMissingVendorConversation: (input: {
    sessionId: string;
    projectId: string;
    reason: string;
  }) => Promise<void>;
  // Method shorthand on purpose: the one implementation narrows `session` to
  // `GatewayRealtimeSession`, which bivariant method checking accepts and a property signature
  // rejects (TS2416).
  confirmSession(input: {
    session: GatewayRealtimeSessionRecord;
    audioMs: number;
    vendorCostRaw: ElevenLabsConversationReport["metadata"] | null;
    durationMs: number;
    reason: string;
  }): Promise<void>;
}

export interface ElevenLabsCredentialReader {
  getApiCredential(input: {
    modelProviderId: string;
  }): Promise<{ apiKey: string; baseUrl: string }>;
}

export interface RealtimeSessionReconciliationConfig {
  tickIntervalMs: number;
  pollAfterMs: number;
  maxSessionsPerTick: number;
  /** Metered sessions settled per tick, orphaned and past the window each. */
  maxSettlementsPerTick: number;
  vendorCallTimeoutMs: number;
}

export const realtimeSessionReconciliationConfig: RealtimeSessionReconciliationConfig = {
  tickIntervalMs: 60 * 1000,
  pollAfterMs: 2 * 60 * 1000,
  maxSessionsPerTick: 25,
  maxSettlementsPerTick: REALTIME_SETTLEMENT_BATCH_SIZE,
  vendorCallTimeoutMs: 10_000,
};

/** One reconciliation tick, `poll`; the schedule that runs it is not this class's. */
export class GatewayRealtimeSessionReconciliationService {
  private readonly repository: RealtimeSessionReconciliationRepository;
  private readonly credentials: ElevenLabsCredentialReader;
  private readonly conversations: ElevenLabsConversationChannel;
  private readonly logger: RealtimeSessionReconciliationLogger;
  private readonly config: RealtimeSessionReconciliationConfig;
  private readonly clock: RealtimeSessionReconciliationClock;

  private constructor({
    repository,
    credentials,
    conversations,
    logger,
    config,
    clock,
  }: {
    repository: RealtimeSessionReconciliationRepository;
    credentials: ElevenLabsCredentialReader;
    conversations: ElevenLabsConversationChannel;
    logger: RealtimeSessionReconciliationLogger;
    config: RealtimeSessionReconciliationConfig;
    clock: RealtimeSessionReconciliationClock;
  }) {
    this.repository = repository;
    this.credentials = credentials;
    this.conversations = conversations;
    this.logger = logger;
    this.config = config;
    this.clock = clock;
  }

  static create(options: {
    repository: RealtimeSessionReconciliationRepository;
    credentials: ElevenLabsCredentialReader;
    conversations: ElevenLabsConversationChannel;
    logger: RealtimeSessionReconciliationLogger;
    config: RealtimeSessionReconciliationConfig;
    clock: RealtimeSessionReconciliationClock;
  }): GatewayRealtimeSessionReconciliationService {
    return new GatewayRealtimeSessionReconciliationService({
      repository: options.repository,
      credentials: options.credentials,
      conversations: options.conversations,
      logger: options.logger,
      config: options.config,
      clock: options.clock,
    });
  }

  async poll(now = this.clock.now()): Promise<{
    examined: number;
    confirmed: number;
    expired: number;
    settled: number;
    estimated: number;
  }> {
    const expired = await this.repository.expireStaleSessions({ now });
    const settlement = await this.settleMeteredSessions(now);
    const sessions = await this.repository.listOpenElevenLabsSessions({
      mintedBefore: now.subtract({ milliseconds: this.config.pollAfterMs }),
      limit: this.config.maxSessionsPerTick,
    });

    let confirmed = 0;
    for (const session of sessions) {
      try {
        if (await this.reconcile(session)) {
          confirmed += 1;
        }
      } catch (error) {
        this.logger.warn(
          { error, sessionId: session.id },
          "could not reconcile a voice session; it stays open for the next tick",
        );
      }
    }

    return { examined: sessions.length, confirmed, expired, ...settlement };
  }

  /**
   * Closes the metered sessions nothing else will: one whose gateway went silent mid-call, and
   * one past the open window. Each is settled alone, so one that fails waits for the next tick.
   */
  private async settleMeteredSessions(
    now: Instant,
  ): Promise<{ settled: number; estimated: number }> {
    const limit = this.config.maxSettlementsPerTick;
    const orphaned = await this.repository.listOrphanedGatewaySessions({ now, limit });
    const overdue = await this.repository.listSessionsAwaitingSettlement({ now, limit });
    const orphanedIds = new Set(orphaned.map((session) => session.id));
    const batch = [
      ...orphaned.map((session) => ({ session, orphaned: true })),
      ...overdue
        .filter((session) => !orphanedIds.has(session.id))
        .map((session) => ({ session, orphaned: false })),
    ];

    let settled = 0;
    let estimated = 0;
    for (const { session, orphaned: lost } of batch) {
      try {
        const outcome = await this.repository.settleSession({ session, orphaned: lost, now });
        settled += 1;
        if (outcome === "estimated") estimated += 1;
      } catch (error) {
        this.logger.warn(
          { error, sessionId: session.id },
          "could not settle a metered voice session; it waits for the next tick",
        );
      }
    }

    return { settled, estimated };
  }

  private async reconcile(session: GatewayRealtimeSessionRecord): Promise<boolean> {
    if (!session.vendorConversationId) {
      return false;
    }

    const credential = await this.credentials
      .getApiCredential({ modelProviderId: session.modelProviderId })
      .catch((error: unknown) => {
        if (HandledError.isHandled(error) && error.code === "voice_key_missing") return undefined;
        throw error;
      });
    if (!credential) {
      return false;
    }

    const { report, notFound } = await this.conversations.readConversation({
      ...credential,
      conversationId: session.vendorConversationId,
      timeoutMs: this.config.vendorCallTimeoutMs,
    });
    if (notFound) {
      await this.repository.releaseMissingVendorConversation({
        sessionId: session.id,
        projectId: session.projectId,
        reason: "the vendor has no conversation for this session, so the credential was never used",
      });

      return false;
    }

    if (!report || !isTerminal(report.status)) {
      return false;
    }

    const reportedSecs = report.metadata?.call_duration_secs;
    if (
      typeof reportedSecs !== "number" ||
      !Number.isFinite(reportedSecs) ||
      Math.round(reportedSecs) < 1
    ) {
      this.logger.warn(
        { sessionId: session.id, status: report.status },
        "the vendor reported a finished conversation with no usable duration; leaving the session open",
      );

      return false;
    }

    const durationSecs = Math.round(reportedSecs);
    await this.repository.confirmSession({
      session,
      audioMs: durationSecs * 1000,
      vendorCostRaw: report.metadata ?? null,
      durationMs: durationSecs * 1000,
      reason: "reconciled by poll",
    });

    return true;
  }
}

function isTerminal(status: string | undefined): boolean {
  return status === "done" || status === "failed";
}
