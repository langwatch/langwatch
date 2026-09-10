/**
 * `/api/internal/langy` — the control plane between the two halves of one
 * deployment: the Go agent's outbound calls back to the app, and the worker's
 * inbound frame stream.
 *
 * Every route answers behind `internalSecret`, so the deployment's own shared
 * bearer is checked by the DOOR, ahead of any handler; a route whose author
 * forgets a check still ships authenticated. The paths are literal and carry no
 * `/api/v1` twin because the agent dials these exact addresses, and a control
 * plane between two halves of one deployment has no dated contract to negotiate.
 */
import { anyAuthenticated } from "@langwatch/api/access";
import {
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
} from "@langwatch/api/rest";
import {
  LangyApi,
  langyInternalAcceptedSchema,
  langyInternalRefusalSchema,
  langyInternalRevokedSchema,
  langyInternalTurnParamsSchema,
  langyRevokeCredentialsSchema,
  langyTurnResultSchema,
  type LangyRelayConnection,
} from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";

const logger = createLogger("langwatch:langy:internal");

/** Running tally of a relay connection's frame outcomes, returned when it ends. */
export interface RelayTally {
  applied: number;
  duplicate: number;
  rejected: number;
  terminal: boolean;
}

/**
 * The counters this family publishes. A fact rather than a member because a
 * metric registry is process-wide state a module may not own: two registries
 * would give one deployment two answers for the same rate.
 */
export type LangyInternalMetrics = Readonly<{
  /** One completed or failed turn, by outcome. */
  turnResult(status: "completed" | "failed"): void;
  /** A revoke that named a key which is not a Langy session key. */
  sessionKeyRevokeRefused(): void;
}>;

/** One counter per relay frame outcome, so the rates stay graphable fleet-wide. */
export type LangyRelayFrameMetrics = Readonly<{
  frames(outcome: "applied" | "duplicate" | "rejected" | "terminal", count: number): void;
}>;

export const langyInternalMetrics = defineRestMiddleware(
  "langyInternalMetrics",
  z.custom<LangyInternalMetrics>(),
);

export const langyRelayFrameMetrics = defineRestMiddleware(
  "langyRelayFrameMetrics",
  z.custom<LangyRelayFrameMetrics>(),
);

/**
 * Whether this process holds the Redis the live edge lives in. The relay
 * refuses rather than degrades: no Redis is no live buffer and no dedup set, so
 * a frame accepted here would be a frame silently dropped.
 */
export const langyRelayLiveBuffer = defineRestMiddleware("langyRelayLiveBuffer", z.boolean());

/** The three internal addresses, exactly as the agent and the worker dial them. */
export const langyInternalRest = defineRestRouter(LangyApi)
  .withNamespace("langy-internal")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })

  // ── the agent's durable final for a turn ──────────────────────────────────
  //
  // Idempotent on `turnId`: re-posting the same final (the agent's bounded
  // retry, or a final the relay already recorded) collapses to one event at the
  // store.
  .post("/api/internal/langy/turn/:turnId/result", "ingestTurnResult")
  .withCredential("internalSecret")
  .withAccess(anyAuthenticated({ reason: "the deployment's own Langy bearer is the whole gate" }))
  .withParams(langyInternalTurnParamsSchema)
  .withInput(langyTurnResultSchema)
  .responds({ 202: langyInternalAcceptedSchema, 404: langyInternalRefusalSchema })
  .withDocs({ description: "Record one Langy turn's durable final result" })
  .withMiddleware(langyInternalMetrics)
  .handle(async ({ app, input }, metrics) => {
    const { turnId, projectId, conversationId } = input;

    // Cross-check the triple before writing. `projectId`/`conversationId` are
    // body fields the bearer alone would otherwise let through unverified — the
    // sibling relay proves the same thing with an HMAC over the runToken, but
    // this durable path has only the shared secret. A turn row exists only if
    // the turn was really accepted under this conversation in this project, so
    // this rejects a forged triple and a benign cross-tenant mix-up alike.
    const turnExists = await app.turnExists({ projectId, conversationId, turnId });

    if (!turnExists) {
      logger.warn(
        { projectId, conversationId, turnId },
        "refusing a turn-result ingest for an unknown (project, conversation, turn) triple",
      );

      return { status: 404, body: { error: "turn not found" } } as const;
    }

    await app.ingestAgentTurnResult({
      projectId,
      conversationId,
      turnId,
      status: input.status,
      text: input.text,
      toolCalls: input.toolCalls,
      errorCode: input.errorCode,
    });

    // The durable completion of a turn — the one line that says a turn ended
    // and how, attributable by ids and graphable by outcome.
    metrics.turnResult(input.status);
    logger.info(
      {
        projectId,
        conversationId,
        turnId,
        status: input.status,
        ...(input.errorCode ? { errorCode: input.errorCode } : {}),
      },
      "langy turn result ingested",
    );

    return { status: 202, body: { status: "accepted" } } as const;
  })

  // ── the worker's session key, handed back for revocation ──────────────────
  //
  // The agent hands back a session-key handle on worker shutdown so the app can
  // revoke it. The app can only revoke — never mint — keeping the trust
  // boundary where it was, and `revokeWorkerSessionKey` refuses any key that is
  // not a Langy session key.
  .post("/api/internal/langy/credentials/revoke", "revokeWorkerSessionKey")
  .withCredential("internalSecret")
  .withAccess(anyAuthenticated({ reason: "the deployment's own Langy bearer is the whole gate" }))
  .withInput(langyRevokeCredentialsSchema)
  .responds({
    200: langyInternalRevokedSchema,
    403: langyInternalRefusalSchema,
    404: langyInternalRevokedSchema,
  })
  .withDocs({ description: "Revoke one Langy worker session key by id, within its project" })
  .withMiddleware(langyInternalMetrics)
  .handle(async ({ app, input }, metrics) => {
    const outcome = await app.revokeWorkerSessionKey({
      apiKeyId: input.apiKeyId,
      projectId: input.projectId,
    });

    switch (outcome) {
      case "revoked":
      case "already_revoked":
        return { status: 200, body: { outcome } } as const;
      case "not_found":
        // 404, which the manager treats as success — the key is in the state it
        // asked for. Anything else would make the reaper winning the race look
        // like a fault.
        return { status: 404, body: { outcome } } as const;
      case "refused":
        // The id resolved to a key that is not ours. Refused, and loud: this
        // should never happen in normal operation. (The warn with the key id
        // fires inside `revokeWorkerSessionKey`; the counter makes a sustained
        // rate alertable.)
        metrics.sessionKeyRevokeRefused();

        return { status: 403, body: { error: "Not a Langy session key" } } as const;
    }
  })

  // ── the worker's inbound frame stream ─────────────────────────────────────
  //
  // A long-lived ndjson stream of authenticated worker frames. It answers once
  // the stream ends — fire-and-forget frames need no per-frame ack, because the
  // dedup set makes redelivery safe — with a tally. Raw on both sides: the body
  // is consumed AS a stream by the relay itself, so nothing may parse it first.
  .post("/api/internal/langy/relay/frames", "streamRelayFrames")
  .withCredential("internalSecret")
  .withAccess(anyAuthenticated({ reason: "the deployment's own Langy bearer is the whole gate" }))
  .withRawResponse({ produces: "application/json" })
  .withDocs({ description: "Stream one Langy worker's frames in and read the tally back" })
  .withMiddleware(langyRelayLiveBuffer, langyRelayFrameMetrics)
  .handle(async ({ app, request }, hasLiveBuffer, metrics) => {
    if (!hasLiveBuffer) {
      logger.error("relay called with no Redis connection");

      return Response.json({ error: "streaming unavailable" }, { status: 503 });
    }

    const body = request.body;

    if (!body) return Response.json({ error: "missing body" }, { status: 400 });

    const relay = app.openRelayConnection();
    const tally = await readFrames({ relay, body });

    // One summary per stream, not one log per frame: the tally is the useful
    // shape (throughput plus duplicate and rejection rates) and the pinned ids
    // make it attributable. The counters make the same rates graphable
    // fleet-wide.
    metrics.frames("applied", tally.applied);
    metrics.frames("duplicate", tally.duplicate);
    metrics.frames("rejected", tally.rejected);
    if (tally.terminal) metrics.frames("terminal", 1);
    logger.info({ ...tally, ...relay.pinnedTurn }, "langy relay stream closed");

    return Response.json(tally, { status: 200 });
  })

  .build();

/** Reads the stream to its end, applying one frame per line as it arrives. */
async function readFrames(input: {
  relay: LangyRelayConnection;
  body: ReadableStream<Uint8Array>;
}): Promise<RelayTally> {
  const { relay } = input;
  const tally: RelayTally = { applied: 0, duplicate: 0, rejected: 0, terminal: false };
  const reader = input.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      pending += decoder.decode(value, { stream: true });

      for (let nl = pending.indexOf("\n"); nl >= 0; nl = pending.indexOf("\n")) {
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
        ...relay.pinnedTurn,
      },
      "relay stream read error — connection closed mid-turn",
    );
  }

  return tally;
}

async function applyLine(
  relay: LangyRelayConnection,
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
