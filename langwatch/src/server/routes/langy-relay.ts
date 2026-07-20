/**
 * Langy relay — the worker's INBOUND authenticated frame stream
 * (LANGY_WORKER_REDESIGN_PLAN §0/§0b). Mounted at `/api/internal/langy/relay`,
 * protected by the shared `LANGY_INTERNAL_SECRET` (so only the worker can push),
 * with per-frame HMAC + frameNonce dedup layered INSIDE that trusted channel.
 *
 * The worker holds one streaming connection per turn and pushes ndjson frames;
 * this handler decodes them line by line and drives a `LangyTurnRelay`, which
 * fans each verified frame to the live Redis Stream buffer and — for named
 * (tool) and terminal (final/error) frames — the durable event log. It is the
 * successor to `runTurn`'s streaming role; the worker no longer holds the /chat
 * response open, and any web instance can serve the connection (all state —
 * runToken, the turn, the dedup set, the stream — is in Redis).
 *
 * On instance death the worker reconnects and re-pushes from the stream's last
 * id; redelivered frames are dropped by the dedup set. Never expose publicly.
 */
import { createServiceApp, internalSecret } from "~/server/api/security";
import { getApp } from "~/server/app-layer/app";
import { connection } from "~/server/redis";
import { createLangyFrameDedup } from "~/server/app-layer/langy/streaming/langyFrameDedup";
import { createLangyTokenBuffer } from "~/server/app-layer/langy/streaming/langyTokenBuffer";
import { LangyTurnRelay } from "~/server/app-layer/langy/streaming/langyTurnRelay";
import { createLogger } from "@langwatch/observability";
import { getLangyRelayFramesCounter } from "~/server/metrics";
import { verifyLangyInternalSecret } from "./langy-internal";

const logger = createLogger("langwatch:langy:relay");

const secured = createServiceApp({
  basePath: "/api/internal/langy",
  verifySecret: verifyLangyInternalSecret,
});

const relayPolicy = () =>
  internalSecret(
    "langy bearer secret verified by the verifySecret chain (verifyLangyInternalSecret)",
  );

/** Running tally of a connection's frame outcomes, returned when it ends. */
interface RelayTally {
  applied: number;
  duplicate: number;
  rejected: number;
  terminal: boolean;
}

/**
 * POST /relay/frames — a long-lived ndjson stream of authenticated worker
 * frames. Responds once the stream ends (fire-and-forget frames need no
 * per-frame ack; the dedup set makes redelivery safe), with a tally.
 */
secured.access(relayPolicy()).post("/relay/frames", async (c) => {
  // No Redis ⇒ no live buffer and no dedup set; refuse rather than silently
  // dropping the turn's live edge.
  if (!connection) {
    logger.error("relay called with no Redis connection");
    return c.json({ error: "streaming unavailable" }, 503);
  }
  const body = c.req.raw.body;
  if (!body) return c.json({ error: "missing body" }, 400);

  const relay = new LangyTurnRelay({
    conversations: getApp().langy.conversations,
    buffer: createLangyTokenBuffer({ redis: connection }),
    reserveFrameNonce: createLangyFrameDedup({ redis: connection })
      .reserveFrameNonce,
    logger,
  });

  const tally: RelayTally = {
    applied: 0,
    duplicate: 0,
    rejected: 0,
    terminal: false,
  };

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, nl).trim();
        pending = pending.slice(nl + 1);
        if (line) await applyLine(relay, line, tally);
      }
    }
    // A final line without a trailing newline.
    const tail = pending.trim();
    if (tail) await applyLine(relay, tail, tally);
  } catch (error) {
    logger.warn(
      {
        error: error instanceof Error ? error.message : String(error),
        ...(relay.pinnedTurn ?? {}),
      },
      "relay stream read error — connection closed mid-turn",
    );
  }

  // One summary per stream, not one log per frame: the tally is the useful
  // shape (throughput + duplicate/rejection rates) and the pinned ids make it
  // attributable. The counters make the same rates graphable fleet-wide.
  getLangyRelayFramesCounter("applied").inc(tally.applied);
  getLangyRelayFramesCounter("duplicate").inc(tally.duplicate);
  getLangyRelayFramesCounter("rejected").inc(tally.rejected);
  if (tally.terminal) getLangyRelayFramesCounter("terminal").inc();
  logger.info(
    { ...tally, ...(relay.pinnedTurn ?? {}) },
    "langy relay stream closed",
  );

  return c.json(tally, 200);
});

async function applyLine(
  relay: LangyTurnRelay,
  line: string,
  tally: RelayTally,
): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    tally.rejected += 1;
    return;
  }
  const outcome = await relay.handle(parsed);
  switch (outcome.status) {
    case "applied":
      tally.applied += 1;
      break;
    case "terminal":
      tally.applied += 1;
      tally.terminal = true;
      break;
    case "duplicate":
      tally.duplicate += 1;
      break;
    case "rejected":
      tally.rejected += 1;
      break;
  }
}

export const app = secured.hono;
