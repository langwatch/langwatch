import { describeRoute } from "hono-openapi";
import { resolver } from "hono-openapi/zod";
import { z } from "zod";
import { createProjectApp, requires } from "~/server/api/security";
import { getApp } from "~/server/app-layer/app";
import { MAX_SESSION_EVENTS_PAGE_SIZE } from "~/server/app-layer/coding-agent/coding-agent-session.service";
import type { SessionEventsCursor } from "~/server/app-layer/coding-agent/repositories/coding-agent-session-events.repository";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";

import { baseResponses } from "../../shared/base-responses";

patchZodOpenapi();

// Rejected here so an over-large `limit` reads as a 400 rather than a
// silently narrower page; the service clamps to the same ceiling for every
// other caller.
const MAX_PAGE = MAX_SESSION_EVENTS_PAGE_SIZE;
const DEFAULT_PAGE = 500;

const EVENT_KINDS = [
  "model_call",
  "compaction",
  "rate_limit",
  "api_error",
  "retries_exhausted",
  "tool_result",
  "tool_decision",
  "user_prompt",
  "subagent_completed",
] as const;

// Every column of the fact table, in the order the row carries them. All of
// them are always present: the table stores typed scalars with no nullable
// columns, so a field that does not apply to an event kind comes back as ""
// or 0 rather than being omitted. `tenantId` is the one column the read does
// not select, and it is absent here for the same reason.
const sessionEventSchema = z.object({
  sessionId: z.string(),
  timeUnixMs: z.number(),
  recordId: z.string(),
  eventKind: z.string(),
  agent: z.string(),
  sessionKeySource: z.string(),
  traceId: z.string(),
  spanId: z.string(),
  promptId: z.string(),
  querySource: z.string(),
  agentType: z.string(),
  eventSequence: z.number(),
  requestId: z.string(),
  model: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheCreationTokens: z.number(),
  costUsd: z.number(),
  durationMs: z.number(),
  ttftMs: z.number(),
  attempt: z.number(),
  speed: z.string(),
  stopReason: z.string(),
  preTokens: z.number(),
  postTokens: z.number(),
  compactionTrigger: z.string(),
  precomputeReuse: z.string(),
  statusCode: z.string(),
  errorType: z.string(),
  rateLimitCarrier: z.string(),
  retryDurationMs: z.number(),
  toolName: z.string(),
  success: z.string(),
  decision: z.string(),
  decisionSource: z.string(),
  toolInputBytes: z.number(),
  toolResultBytes: z.number(),
  promptChars: z.number(),
  totalTokens: z.number(),
});

const secured = createProjectApp({ basePath: "/api/coding-agent" });

// GET /sessions/:sessionId/events — one session's event sequence, in time
// order: every model call with its context and cost, every compaction with
// its before/after tokens, rate limits, tool runs, prompts. The raw material
// for per-call context and cost analytics; scalar facts only, content stays
// on the trace/log reads.
secured.access(requires("traces:view")).get(
  "/sessions/:sessionId/events",
  describeRoute({
    description:
      "List a coding-agent session's events (model calls, compactions, rate limits, " +
      "tool runs, prompts) in time order, keyset-paginated. Pass the previous " +
      "response's nextCursor to continue; filter with kinds (comma-separated).",
    parameters: [
      {
        name: "sessionId",
        in: "path",
        required: true,
        schema: { type: "string" },
        description:
          "The agent's own session id (session.id / conversation id).",
      },
      {
        name: "kinds",
        in: "query",
        required: false,
        schema: { type: "string" },
        description: `Comma-separated event kinds to include. Known kinds: ${EVENT_KINDS.join(", ")}.`,
      },
      {
        name: "cursor",
        in: "query",
        required: false,
        schema: { type: "string" },
        description:
          "Opaque keyset cursor from the previous response's nextCursor.",
      },
      {
        name: "limit",
        in: "query",
        required: false,
        schema: { type: "integer", maximum: MAX_PAGE, default: DEFAULT_PAGE },
      },
      {
        name: "from",
        in: "query",
        required: false,
        schema: { type: "integer" },
        description:
          "Epoch ms lower bound on event time; with `to`, prunes storage partitions for faster reads.",
      },
      {
        name: "to",
        in: "query",
        required: false,
        schema: { type: "integer" },
        description: "Epoch ms upper bound on event time.",
      },
    ],
    responses: {
      ...baseResponses,
      200: {
        description:
          "One page of session events plus the cursor for the next page",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                events: z.array(sessionEventSchema),
                nextCursor: z.string().nullable(),
              }),
            ),
          },
        },
      },
    },
  }),
  async (c) => {
    const project = c.get("project");
    const sessionId = c.req.param("sessionId");

    const query = eventsQuerySchema.safeParse({
      limit: c.req.query("limit"),
      kinds: c.req.query("kinds"),
      from: c.req.query("from"),
      to: c.req.query("to"),
      cursor: c.req.query("cursor"),
    });
    if (!query.success) {
      return c.json(
        { error: `Invalid query: ${query.error.issues[0]?.message}` },
        400,
      );
    }
    const { limit, kinds, from, to, cursor } = query.data;
    // Both bounds or neither: half a window would silently widen the read
    // past what the caller asked for.
    if ((from === undefined) !== (to === undefined)) {
      return c.json({ error: "from and to must be supplied together" }, 400);
    }

    const { events, nextCursor } =
      await getApp().codingAgents.sessions.getSessionEvents({
        projectId: project.id,
        sessionId,
        kinds,
        occurredAt:
          from !== undefined && to !== undefined
            ? { fromMs: from, toMs: to }
            : undefined,
        cursor,
        limit,
      });

    return c.json({
      events,
      nextCursor: nextCursor ? encodeCursor(nextCursor) : null,
    });
  },
);

/**
 * Query parsing that REFUSES what it cannot honour. Every field here was once
 * a silent fallback, and each one lied in its own way: an unparseable cursor
 * restarted the walk at page 1, so a client following `nextCursor` looped
 * forever, and a malformed bound dropped the window and answered over a wider
 * range than was asked for.
 */
const eventsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(MAX_PAGE).default(DEFAULT_PAGE),
  kinds: z
    .string()
    .optional()
    .transform((raw) =>
      raw
        ? raw
            .split(",")
            .map((kind) => kind.trim())
            .filter((kind) => kind.length > 0)
        : undefined,
    ),
  from: z.coerce.number().finite().optional(),
  to: z.coerce.number().finite().optional(),
  cursor: z
    .string()
    .optional()
    .transform((raw, ctx) => {
      if (raw === undefined) return undefined;
      const decoded = decodeCursor(raw);
      if (!decoded) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "cursor is not decodable",
        });
        return z.NEVER;
      }
      return decoded;
    }),
});

function encodeCursor(cursor: SessionEventsCursor): string {
  return Buffer.from(
    JSON.stringify({ t: cursor.timeUnixMs, r: cursor.recordId }),
  ).toString("base64url");
}

function decodeCursor(raw: string): SessionEventsCursor | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8"),
    ) as { t?: unknown; r?: unknown };
    if (typeof parsed.t !== "number" || typeof parsed.r !== "string") {
      return null;
    }
    return { timeUnixMs: parsed.t, recordId: parsed.r };
  } catch {
    return null;
  }
}

export const app = secured.hono;
