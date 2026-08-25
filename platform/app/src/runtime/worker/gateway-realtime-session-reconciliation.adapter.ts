import type { GatewayRealtimeSessionRecord } from "@langwatch/gateway-contract";
import {
  GatewayRealtimeSessionReconciliationWorker,
  elevenLabsConversationReportSchema,
  realtimeSessionReconciliationConfig,
  type ElevenLabsConversationReader,
  type ElevenLabsCredentialReader,
  type ElevenLabsConversationReport,
  type RealtimeSessionPollerHandle,
  type RealtimeSessionReconciliationClock,
  type RealtimeSessionReconciliationConfig,
  type RealtimeSessionReconciliationLogger,
  type RealtimeSessionReconciliationRepository,
} from "@langwatch/gateway-server/realtime-session-reconciliation";
import type { PrismaClient } from "~/generated/prisma/client";
import { ssrfSafeFetch } from "~/utils/ssrfProtection";

export interface RealtimeSessionPollerServices {
  expireStaleSessions(input: { now: Date }): Promise<number>;
  releaseRealtimeSession(input: {
    sessionId: string;
    projectId: string;
    status: "EXPIRED";
    reason: string;
  }): Promise<boolean>;
  closeAndConfirmRealtimeSession(input: {
    session: GatewayRealtimeSessionRecord;
    usage: { audio_ms: number };
    vendorCostRaw: ElevenLabsConversationReport["metadata"] | null;
    durationMs: number;
    reason: string;
  }): Promise<void>;
}

export interface RealtimeSessionPollerDatabase {
  listOpenElevenLabsSessions(input: {
    mintedBefore: Date;
    limit: number;
  }): Promise<GatewayRealtimeSessionRecord[]>;
}

export class PrismaRealtimeSessionPollerDatabase implements RealtimeSessionPollerDatabase {
  private constructor(private readonly database: PrismaClient) {}

  static create(options: {
    database: PrismaClient;
  }): PrismaRealtimeSessionPollerDatabase {
    return new PrismaRealtimeSessionPollerDatabase(options.database);
  }

  listOpenElevenLabsSessions({
    mintedBefore,
    limit,
  }: {
    mintedBefore: Date;
    limit: number;
  }): Promise<GatewayRealtimeSessionRecord[]> {
    return this.database.gatewayRealtimeSession.findMany({
      where: {
        vendor: "elevenlabs",
        status: "OPEN",
        vendorConversationId: { not: null },
        mintedAt: { lt: mintedBefore },
      },
      orderBy: { mintedAt: "asc" },
      take: limit,
      select: {
        id: true,
        projectId: true,
        organizationId: true,
        virtualKeyId: true,
        modelProviderId: true,
        vendor: true,
        model: true,
        traceId: true,
        requestedModel: true,
        mintedAt: true,
        vendorConversationId: true,
      },
    });
  }
}

export interface RealtimeSessionPollerComposition {
  database: RealtimeSessionPollerDatabase;
  sessions: RealtimeSessionPollerServices;
  credentials: ElevenLabsCredentialReader;
  logger: RealtimeSessionReconciliationLogger;
  config?: RealtimeSessionReconciliationConfig;
  clock?: RealtimeSessionReconciliationClock;
}

function repositoryFor(
  composition: RealtimeSessionPollerComposition,
): RealtimeSessionReconciliationRepository {
  return {
    expireStaleSessions: ({ now }) => composition.sessions.expireStaleSessions({ now }),
    listOpenElevenLabsSessions: (input) =>
      composition.database.listOpenElevenLabsSessions(input),
    releaseMissingVendorConversation: async ({ sessionId, projectId, reason }) => {
      await composition.sessions.releaseRealtimeSession({
        sessionId,
        projectId,
        status: "EXPIRED",
        reason,
      });
    },
    confirmSession: ({ session, audioMs, vendorCostRaw, durationMs, reason }) =>
      composition.sessions.closeAndConfirmRealtimeSession({
        session,
        usage: { audio_ms: audioMs },
        vendorCostRaw,
        durationMs,
        reason,
      }),
  };
}

const conversations: ElevenLabsConversationReader = {
  async readConversation({ apiKey, baseUrl, conversationId, timeoutMs }) {
    const response = await ssrfSafeFetch(
      `${baseUrl}/v1/convai/conversations/${encodeURIComponent(conversationId)}`,
      {
        headers: { "xi-api-key": apiKey },
        signal: AbortSignal.timeout(timeoutMs),
        followRedirects: false,
        headersTimeoutMs: timeoutMs,
        bodyTimeoutMs: timeoutMs,
      },
    );
    if (response.status === 404) return { notFound: true };
    if (!response.ok) return { notFound: false };
    const report = elevenLabsConversationReportSchema.parse(await response.json());

    return { report, notFound: false };
  },
};

function createWorker(
  composition: RealtimeSessionPollerComposition,
): GatewayRealtimeSessionReconciliationWorker {
  return GatewayRealtimeSessionReconciliationWorker.create({
    repository: repositoryFor(composition),
    credentials: composition.credentials,
    conversations,
    logger: composition.logger,
    config: composition.config ?? realtimeSessionReconciliationConfig,
    clock: composition.clock ?? { now: () => new Date() },
  });
}

/** Worker composition adapter until the dedicated worker app owns this root. */
export function startRealtimeSessionPoller(
  composition: RealtimeSessionPollerComposition,
): RealtimeSessionPollerHandle {
  return createWorker(composition).start();
}

/** Kept for focused application callers that run one reconciliation pass. */
export function pollOpenRealtimeSessions(
  composition: RealtimeSessionPollerComposition,
  now = composition.clock?.now(),
) {
  return now === void 0
    ? createWorker(composition).poll()
    : createWorker(composition).poll(now);
}
