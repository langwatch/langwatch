/**
 * Reconciles brokered ElevenLabs voice sessions the post-call webhook did
 * not close.
 *
 * The webhook is the fast path, and it is one slot per workspace that a
 * customer may already be using for something else. Without a fallback the
 * broker would need that slot before a customer could adopt it at all, so
 * this poller makes the webhook an optimization instead of a requirement.
 *
 * The poll is exact, not a guess: the mint recorded the vendor's own
 * conversation id, so each open session is read back by id. A session with
 * no recorded id is left alone; it settles as cost-unknown on the spend
 * grace, which is visible, rather than being charged whatever conversation
 * happened to be nearby.
 *
 * Spec: specs/ai-gateway/realtime-sessions.feature.
 */

import { createLogger } from "@langwatch/observability";
import type { GatewayRealtimeSession } from "~/generated/prisma/client";
import { prisma } from "~/server/db";
import { decryptCustomKeys } from "~/server/modelProviders/customKeys";
import { isElevenLabsHost } from "~/server/modelProviders/registry";
import { ssrfSafeFetch } from "~/utils/ssrfProtection";
import {
  closeAndConfirmRealtimeSession,
  expireStaleRealtimeSessions,
  releaseRealtimeSession,
} from "./realtimeSession.service";

const logger = createLogger("langwatch:workers:realtimeSessionPoller");

/** How often the reconciliation runs. */
const TICK_INTERVAL_MS = 60 * 1000;

/**
 * How long a session is left to the webhook before the poller reads it.
 *
 * The vendor finishes writing a conversation shortly after the call ends,
 * and the webhook usually lands first. Two minutes keeps the poller off the
 * common path while staying far inside the spend settlement grace, so a
 * reconciled session confirms rather than settles.
 */
const POLL_AFTER_MS = 2 * 60 * 1000;

/** Bounds one tick, so a backlog cannot turn into a burst of vendor calls. */
const MAX_SESSIONS_PER_TICK = 25;

const DEFAULT_BASE_URL = "https://api.elevenlabs.io";
const VENDOR_CALL_TIMEOUT_MS = 10_000;

export interface RealtimeSessionPollerHandle {
  stop(): void;
}

/** The vendor fields this reads. The transcript is never fetched into logs. */
interface ConversationReport {
  status?: string;
  metadata?: {
    call_duration_secs?: number;
    cost?: number;
    cost_fiat?: unknown;
  };
}

/** A conversation the vendor considers finished has a final duration. */
function isTerminal(status: string | undefined): boolean {
  return status === "done" || status === "failed";
}

/** The API key and host for one ElevenLabs credential row. */
async function credentialFor(
  modelProviderId: string,
): Promise<{ apiKey: string; baseUrl: string } | null> {
  const provider = await prisma.modelProvider.findUnique({
    where: { id: modelProviderId },
    select: { provider: true, customKeys: true },
  });
  if (provider?.provider !== "elevenlabs") return null;
  const keys = decryptCustomKeys(provider.customKeys);
  const apiKey = keys.ELEVENLABS_API_KEY;
  if (typeof apiKey !== "string" || apiKey.length === 0) return null;
  const configured = keys.ELEVENLABS_BASE_URL;
  if (typeof configured === "string" && configured.length > 0) {
    // Checked again on read, not only on write. A row stored before the
    // registry constrained this field would otherwise send the customer's
    // key to whatever host it names.
    if (!isElevenLabsHost(configured)) {
      logger.warn(
        { modelProviderId },
        "an ElevenLabs credential names a base URL outside elevenlabs.io; reconciling against the default host instead",
      );
      return { apiKey, baseUrl: DEFAULT_BASE_URL };
    }
    return { apiKey, baseUrl: configured.replace(/\/$/, "") };
  }
  return { apiKey, baseUrl: DEFAULT_BASE_URL };
}

/**
 * Reads one conversation back from the vendor.
 *
 * A 404 is reported as such rather than as a failure to read. A minted
 * credential the caller never used produces no conversation at all, so the
 * vendor will answer 404 for it forever, and polling it once a minute until
 * the expiry sweep is an hour of pointless vendor calls per unused mint.
 */
async function readConversation(params: {
  apiKey: string;
  baseUrl: string;
  conversationId: string;
}): Promise<{ report?: ConversationReport; notFound: boolean }> {
  // ssrfSafeFetch, not fetch: the base URL comes from a customer-configured
  // credential, and this request carries that customer's xi-api-key. A plain
  // fetch would follow a redirect and hand the key to whatever host answered.
  const response = await ssrfSafeFetch(
    `${params.baseUrl}/v1/convai/conversations/${encodeURIComponent(params.conversationId)}`,
    {
      headers: { "xi-api-key": params.apiKey },
      signal: AbortSignal.timeout(VENDOR_CALL_TIMEOUT_MS),
      followRedirects: false,
      headersTimeoutMs: VENDOR_CALL_TIMEOUT_MS,
      bodyTimeoutMs: VENDOR_CALL_TIMEOUT_MS,
    },
  );
  if (response.status === 404) return { notFound: true };
  if (!response.ok) return { notFound: false };
  return {
    report: (await response.json()) as ConversationReport,
    notFound: false,
  };
}

/** Confirms one session from what the vendor reports about its call. */
async function reconcile(session: GatewayRealtimeSession): Promise<boolean> {
  if (!session.vendorConversationId) return false;
  const credential = await credentialFor(session.modelProviderId);
  if (!credential) return false;

  const { report, notFound } = await readConversation({
    ...credential,
    conversationId: session.vendorConversationId,
  });
  if (notFound) {
    // The credential was minted and never used, so no call exists and none
    // will. Free the cap slot now instead of polling for it until the
    // expiry sweep; its spend record settles as unknown on its own grace.
    await releaseRealtimeSession({
      sessionId: session.id,
      projectId: session.projectId,
      status: "EXPIRED",
      reason:
        "the vendor has no conversation for this session, so the credential was never used",
    });
    return false;
  }
  if (!report || !isTerminal(report.status)) return false;

  // A terminal conversation with no duration is not a free call. Confirming
  // zero would write a confirmed spend record the fold never downgrades, so
  // no later report could correct it. Leaving the session open lets the next
  // tick retry, and the expiry sweep or the spend grace owns the outcome.
  const reportedSecs = report.metadata?.call_duration_secs;
  if (typeof reportedSecs !== "number" || !Number.isFinite(reportedSecs)) {
    logger.warn(
      { sessionId: session.id, status: report.status },
      "the vendor reported a finished conversation with no duration; leaving the session open",
    );
    return false;
  }

  const durationSecs = Math.max(0, Math.round(reportedSecs));
  await closeAndConfirmRealtimeSession({
    session,
    usage: { audio_ms: durationSecs * 1000 },
    // Evidence only. `cost_fiat` is the money field, `cost` is credits;
    // nothing here prices from either, because the session bills on duration.
    vendorCostRaw: report.metadata ?? null,
    durationMs: durationSecs * 1000,
    reason: "reconciled by poll",
  });
  return true;
}

/** One reconciliation pass. Exported so a test can drive it directly. */
export async function pollOpenRealtimeSessions(
  now = new Date(),
): Promise<{ examined: number; confirmed: number; expired: number }> {
  // The unscoped sweep. reserveRealtimeSession expires a key's stale rows
  // under its own lock, but only for a key that has a cap, and only when that
  // key mints again. A key with no cap, or one whose customer stopped calling,
  // would otherwise leave OPEN rows behind forever: rows the OpenAI arm has no
  // other closing path for, since its socket never signals that it ended.
  const expired = await expireStaleRealtimeSessions({ now });

  const sessions = await prisma.gatewayRealtimeSession.findMany({
    where: {
      vendor: "elevenlabs",
      status: "OPEN",
      vendorConversationId: { not: null },
      mintedAt: { lt: new Date(now.getTime() - POLL_AFTER_MS) },
    },
    orderBy: { mintedAt: "asc" },
    take: MAX_SESSIONS_PER_TICK,
  });

  let confirmed = 0;
  for (const session of sessions) {
    try {
      if (await reconcile(session)) confirmed += 1;
    } catch (error) {
      logger.warn(
        { error, sessionId: session.id },
        "could not reconcile a voice session; it stays open for the next tick",
      );
    }
  }
  return { examined: sessions.length, confirmed, expired };
}

/**
 * Long-running loop that reconciles unreported voice sessions once a
 * minute. A failed tick is logged and retried on the next interval: billing
 * reconciliation must degrade rather than stop.
 */
export function startRealtimeSessionPoller(): RealtimeSessionPollerHandle {
  let stopped = false;
  let running = false;
  let timer: NodeJS.Timeout | undefined;

  const tick = async () => {
    if (stopped) return;
    // setInterval does not wait for an async callback. A tick reads up to
    // MAX_SESSIONS_PER_TICK conversations one after another, each bounded by
    // VENDOR_CALL_TIMEOUT_MS, so a slow vendor makes one tick outlast the
    // interval several times over and ticks pile up on the same rows. Spend
    // confirmation is idempotent, so that would not double charge; it would
    // multiply calls against a vendor already struggling, which is the wrong
    // answer to that signal.
    if (running) {
      logger.warn(
        {},
        "the previous realtime reconciliation tick is still running; skipping this one",
      );
      return;
    }
    running = true;
    try {
      const result = await pollOpenRealtimeSessions();
      if (result.examined > 0 || result.expired > 0) {
        logger.info(result, "realtime voice session reconciliation tick");
      }
    } catch (error) {
      logger.error(
        { error },
        "realtime voice session reconciliation tick failed (will retry)",
      );
    } finally {
      running = false;
    }
  };

  timer = setInterval(() => void tick(), TICK_INTERVAL_MS);
  void tick();

  return {
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
    },
  };
}
