import type { GatewayRealtimeSessionRecord } from "@langwatch/gateway-contract";
import { z } from "zod";

export const elevenLabsConversationReportSchema = z
  .object({
    status: z.string().optional(),
    metadata: z
      .object({
        call_duration_secs: z.number().optional(),
        cost: z.number().optional(),
        cost_fiat: z.unknown().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type ElevenLabsConversationReport = z.infer<
  typeof elevenLabsConversationReportSchema
>;

export interface RealtimeSessionReconciliationLogger {
  warn(context: Record<string, unknown>, message: string): void;
  info(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
}

export interface RealtimeSessionReconciliationClock {
  now(): Date;
}

export interface RealtimeSessionReconciliationRepository {
  expireStaleSessions(input: { now: Date }): Promise<number>;
  listOpenElevenLabsSessions(input: {
    mintedBefore: Date;
    limit: number;
  }): Promise<GatewayRealtimeSessionRecord[]>;
  releaseMissingVendorConversation(input: {
    sessionId: string;
    projectId: string;
    reason: string;
  }): Promise<void>;
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
  }): Promise<{ apiKey: string; baseUrl: string } | null>;
}

export interface ElevenLabsConversationReader {
  readConversation(input: {
    apiKey: string;
    baseUrl: string;
    conversationId: string;
    timeoutMs: number;
  }): Promise<{ report?: ElevenLabsConversationReport; notFound: boolean }>;
}

export interface RealtimeSessionReconciliationConfig {
  tickIntervalMs: number;
  pollAfterMs: number;
  maxSessionsPerTick: number;
  vendorCallTimeoutMs: number;
}

export interface RealtimeSessionPollerHandle {
  stop(): void;
}

export const realtimeSessionReconciliationConfig: RealtimeSessionReconciliationConfig = {
  tickIntervalMs: 60 * 1000,
  pollAfterMs: 2 * 60 * 1000,
  maxSessionsPerTick: 25,
  vendorCallTimeoutMs: 10_000,
};

/** A process-owned worker contribution. Creating it does not start a timer. */
export class GatewayRealtimeSessionReconciliationWorker {
  private constructor(
    private readonly repository: RealtimeSessionReconciliationRepository,
    private readonly credentials: ElevenLabsCredentialReader,
    private readonly conversations: ElevenLabsConversationReader,
    private readonly logger: RealtimeSessionReconciliationLogger,
    private readonly config: RealtimeSessionReconciliationConfig,
    private readonly clock: RealtimeSessionReconciliationClock,
  ) {}

  static create(options: {
    repository: RealtimeSessionReconciliationRepository;
    credentials: ElevenLabsCredentialReader;
    conversations: ElevenLabsConversationReader;
    logger: RealtimeSessionReconciliationLogger;
    config: RealtimeSessionReconciliationConfig;
    clock: RealtimeSessionReconciliationClock;
  }): GatewayRealtimeSessionReconciliationWorker {
    return new GatewayRealtimeSessionReconciliationWorker(
      options.repository,
      options.credentials,
      options.conversations,
      options.logger,
      options.config,
      options.clock,
    );
  }

  async poll(now = this.clock.now()): Promise<{
    examined: number;
    confirmed: number;
    expired: number;
  }> {
    const expired = await this.repository.expireStaleSessions({ now });
    const sessions = await this.repository.listOpenElevenLabsSessions({
      mintedBefore: new Date(now.getTime() - this.config.pollAfterMs),
      limit: this.config.maxSessionsPerTick,
    });

    let confirmed = 0;
    for (const session of sessions) {
      try {
        if (await this.reconcile(session)) confirmed += 1;
      } catch (error) {
        this.logger.warn(
          { error, sessionId: session.id },
          "could not reconcile a voice session; it stays open for the next tick",
        );
      }
    }

    return { examined: sessions.length, confirmed, expired };
  }

  start(): RealtimeSessionPollerHandle {
    let stopped = false;
    let running = false;

    const tick = async () => {
      if (stopped) return;
      if (running) {
        this.logger.warn(
          {},
          "the previous realtime reconciliation tick is still running; skipping this one",
        );
        return;
      }

      running = true;
      try {
        const result = await this.poll();
        if (result.examined > 0 || result.expired > 0) {
          this.logger.info(result, "realtime voice session reconciliation tick");
        }
      } catch (error) {
        this.logger.error(
          { error },
          "realtime voice session reconciliation tick failed (will retry)",
        );
      } finally {
        running = false;
      }
    };

    const timer = setInterval(() => void tick(), this.config.tickIntervalMs);
    void tick();

    return {
      stop() {
        stopped = true;
        clearInterval(timer);
      },
    };
  }

  private async reconcile(session: GatewayRealtimeSessionRecord): Promise<boolean> {
    if (!session.vendorConversationId) return false;

    const credential = await this.credentials.getApiCredential({
      modelProviderId: session.modelProviderId,
    });
    if (!credential) return false;

    const { report, notFound } = await this.conversations.readConversation({
      ...credential,
      conversationId: session.vendorConversationId,
      timeoutMs: this.config.vendorCallTimeoutMs,
    });
    if (notFound) {
      await this.repository.releaseMissingVendorConversation({
        sessionId: session.id,
        projectId: session.projectId,
        reason:
          "the vendor has no conversation for this session, so the credential was never used",
      });
      return false;
    }
    if (!report || !isTerminal(report.status)) return false;

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
