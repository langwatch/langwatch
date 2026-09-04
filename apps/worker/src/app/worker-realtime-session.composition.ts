/**
 * Reconciling brokered voice sessions the post-call webhook never closed.
 *
 * The webhook is the fast path and it is one slot per ElevenLabs workspace — a
 * slot a customer may already be using for something else. Without this loop
 * the broker would need that slot before a customer could adopt it at all, so
 * the poller is what makes the webhook an optimisation rather than a
 * prerequisite for being billed correctly.
 *
 * The poll is EXACT rather than a guess: the mint recorded the vendor's own
 * conversation id, and each open session is read back by that id. A session
 * with no recorded id is left alone and settles as cost-unknown on the spend
 * grace, which is visible, instead of being charged whatever conversation
 * happened to be nearby.
 *
 * @see specs/ai-gateway/realtime-sessions.feature
 */

import { createSsrfUrlValidator, fetchValidatedDestination } from "@langwatch/egress";
import type { GatewayRealtimeSessionRecord } from "@langwatch/gateway-contract";
import {
  closeAndConfirmRealtimeSession,
  expireStaleRealtimeSessions,
  GatewayModelProviderCredentialsPort,
  GatewayRealtimeSessionReconciliationWorker,
  elevenLabsConversationReportSchema,
  getElevenLabsApiCredential,
  realtimeSessionReconciliationConfig,
  releaseRealtimeSession,
  ModelCatalogGatewaySpendRatingAdapter,
  type ElevenLabsConversationReader,
  type ElevenLabsConversationReport,
  type ElevenLabsCredentialReader,
  type GatewayRealtimeSessionCollaborators,
  type GatewaySpendConfirmationPort,
} from "@langwatch/gateway-server";
import { readCustomKeys } from "@langwatch/model-provider-server";
import { createLogger, type Logger } from "@langwatch/observability";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { AesGcmSecretEncryptionAdapter } from "@langwatch/secret-server";

/**
 * Reports the composition decision an absent poller would otherwise hide.
 *
 * Silent in production, and expensive: brokered voice spend then settles only
 * when a customer's post-call webhook arrives, and a workspace that never
 * configured one bills nothing at all.
 */
export abstract class WorkerRealtimeSessionAbsenceReportPort {
  abstract withoutPoller(reason: "no-typed-prisma-connection" | "no-encryption-key"): void;
}

export type WorkerRealtimeSessionCompositionInput = Readonly<{
  database: PrismaClient | undefined;
  /** The deployment's stored-credential key, which a provider row is read under. */
  encryptionKey: string | undefined;
  /**
   * The gateway spend pipeline's own `confirmSpend`, as this process registered
   * it.
   *
   * A reconciled session confirms into the SAME pipeline the data plane's own
   * drainer sends to: two paths writing one spend record is how they come to
   * disagree about what a call cost.
   */
  spendConfirmation: GatewaySpendConfirmationPort;
  absence?: WorkerRealtimeSessionAbsenceReportPort;
}>;

export function tryCreateWorkerRealtimeSessionPoller(
  options: WorkerRealtimeSessionCompositionInput,
): GatewayRealtimeSessionReconciliationWorker | undefined {
  const { database, encryptionKey } = options;
  if (!database) {
    options.absence?.withoutPoller("no-typed-prisma-connection");
    return undefined;
  }
  if (!encryptionKey) {
    options.absence?.withoutPoller("no-encryption-key");
    return undefined;
  }

  const logger = createLogger("langwatch:worker:realtime-session-poller");
  const collaborators: GatewayRealtimeSessionCollaborators = {
    database,
    // The one rating seam for the vertical: the session bills on duration, and
    // the vendor's own cost figure is stored beside the answer as evidence
    // rather than billed from.
    spendRating: ModelCatalogGatewaySpendRatingAdapter.create(),
    spendConfirmation: options.spendConfirmation,
  };
  const credentials = WorkerElevenLabsCredentials.create({
    database,
    encryption: AesGcmSecretEncryptionAdapter.create({ key: encryptionKey }),
  });

  return GatewayRealtimeSessionReconciliationWorker.create({
    repository: WorkerRealtimeSessionRepository.create({ database, collaborators }),
    credentials,
    conversations: WorkerElevenLabsConversations.create(),
    logger,
    config: realtimeSessionReconciliationConfig,
    clock: { now: () => new Date() },
  });
}

/**
 * The session rows, read and closed through the feature's own operations.
 *
 * Only the LISTING is a query of this module's own: everything that changes a
 * row goes through the gateway package's exported operations, so a session
 * closed by the poller and one closed by the webhook take the same path
 * through the same idempotency.
 */
class WorkerRealtimeSessionRepository {
  static create(options: {
    database: PrismaClient;
    collaborators: GatewayRealtimeSessionCollaborators;
  }): WorkerRealtimeSessionRepository {
    return new WorkerRealtimeSessionRepository(options.database, options.collaborators);
  }

  private constructor(
    private readonly database: PrismaClient,
    private readonly collaborators: GatewayRealtimeSessionCollaborators,
  ) {}

  expireStaleSessions(input: { now: Date }): Promise<number> {
    return expireStaleRealtimeSessions({ now: input.now, collaborators: this.collaborators });
  }

  async listOpenElevenLabsSessions(input: {
    mintedBefore: Date;
    limit: number;
  }): Promise<GatewayRealtimeSessionRecord[]> {
    return this.database.gatewayRealtimeSession.findMany({
      where: {
        vendor: "elevenlabs",
        status: "OPEN",
        vendorConversationId: { not: null },
        mintedAt: { lt: input.mintedBefore },
      },
      orderBy: { mintedAt: "asc" },
      take: input.limit,
    });
  }

  async releaseMissingVendorConversation(input: {
    sessionId: string;
    projectId: string;
    reason: string;
  }): Promise<void> {
    await releaseRealtimeSession({
      ...input,
      status: "EXPIRED",
      collaborators: this.collaborators,
    });
  }

  confirmSession(input: {
    session: GatewayRealtimeSessionRecord;
    audioMs: number;
    vendorCostRaw: ElevenLabsConversationReport["metadata"] | null;
    durationMs: number;
    reason: string;
  }): Promise<void> {
    return closeAndConfirmRealtimeSession({
      session: input.session,
      usage: { audio_ms: input.audioMs },
      vendorCostRaw: input.vendorCostRaw,
      durationMs: input.durationMs,
      reason: input.reason,
      collaborators: this.collaborators,
    });
  }
}

/** The customer's own ElevenLabs key, decrypted under the deployment's cipher. */
class WorkerElevenLabsCredentials implements ElevenLabsCredentialReader {
  static create(options: {
    database: PrismaClient;
    encryption: AesGcmSecretEncryptionAdapter;
  }): WorkerElevenLabsCredentials {
    return new WorkerElevenLabsCredentials(options.database, options.encryption);
  }

  private constructor(
    private readonly database: PrismaClient,
    private readonly encryption: AesGcmSecretEncryptionAdapter,
  ) {}

  getApiCredential(input: {
    modelProviderId: string;
  }): Promise<{ apiKey: string; baseUrl: string } | null> {
    return getElevenLabsApiCredential({
      modelProviderId: input.modelProviderId,
      collaborators: {
        database: this.database,
        credentials: WorkerGatewayModelProviderCredentials.create(this.encryption),
      },
    });
  }
}

/**
 * A provider row's stored keys, read leniently.
 *
 * A legacy plaintext row, an absent column and a value written under a rotated
 * key all read as "no custom keys" rather than throwing: one unreadable
 * credential must not stop the sweep that settles every other session.
 */
class WorkerGatewayModelProviderCredentials extends GatewayModelProviderCredentialsPort {
  static create(encryption: AesGcmSecretEncryptionAdapter): WorkerGatewayModelProviderCredentials {
    return new WorkerGatewayModelProviderCredentials(encryption);
  }

  private constructor(private readonly encryption: AesGcmSecretEncryptionAdapter) {
    super();
  }

  readCustomKeys(stored: unknown): Record<string, unknown> {
    const read = readCustomKeys(stored, this.encryption);
    return read.state === "read" ? read.keys : {};
  }
}

/**
 * One conversation, read back from the vendor.
 *
 * Fenced rather than a plain `fetch`, and redirects refused outright: the base
 * URL comes from a customer-configured credential and the request carries that
 * customer's `xi-api-key`, so a followed redirect would hand the key to
 * whatever host answered.
 *
 * A 404 is reported as such rather than as a failure to read. A credential
 * minted and never used produces no conversation at all, so the vendor answers
 * 404 for it forever, and polling it every minute until the expiry sweep is an
 * hour of pointless vendor calls per unused mint.
 */
class WorkerElevenLabsConversations implements ElevenLabsConversationReader {
  static create(): WorkerElevenLabsConversations {
    return new WorkerElevenLabsConversations();
  }

  private readonly validate = createSsrfUrlValidator({ blockLocal: true, allowedHosts: [] });

  private constructor() {}

  async readConversation(input: {
    apiKey: string;
    baseUrl: string;
    conversationId: string;
    timeoutMs: number;
  }): Promise<{ report?: ElevenLabsConversationReport; notFound: boolean }> {
    const validated = await this.validate(
      `${input.baseUrl}/v1/convai/conversations/${encodeURIComponent(input.conversationId)}`,
    );
    const response = await fetchValidatedDestination(
      validated,
      {
        headers: { "xi-api-key": input.apiKey },
        followRedirects: false,
        headersTimeoutMs: input.timeoutMs,
        bodyTimeoutMs: input.timeoutMs,
      },
      { rejectUnauthorized: true },
    );
    if (response.status === 404) return { notFound: true };
    if (!response.ok) return { notFound: false };
    return {
      report: elevenLabsReport(await response.json()),
      notFound: false,
    };
  }
}

function elevenLabsReport(body: unknown): ElevenLabsConversationReport | undefined {
  const parsed = elevenLabsConversationReportSchema.safeParse(body);
  return parsed.success ? parsed.data : undefined;
}

/** Names the poller's absence in this process's own log. */
export class LoggedWorkerRealtimeSessionAbsence extends WorkerRealtimeSessionAbsenceReportPort {
  static create(logger: Logger): LoggedWorkerRealtimeSessionAbsence {
    return new LoggedWorkerRealtimeSessionAbsence(logger);
  }

  private constructor(private readonly logger: Logger) {
    super();
  }

  withoutPoller(reason: "no-typed-prisma-connection" | "no-encryption-key"): void {
    this.logger.warn(
      { reason },
      "worker composed no realtime voice session poller: brokered voice spend settles only where the customer's post-call webhook arrives, and a workspace without one is never billed for its calls",
    );
  }
}
