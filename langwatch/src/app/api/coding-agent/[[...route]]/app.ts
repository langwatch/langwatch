import { describeRoute } from "hono-openapi";
import { resolver } from "hono-openapi/zod";
import { z } from "zod";
import { createProjectApp, requires } from "~/server/api/security";
import { getApp } from "~/server/app-layer/app";
import type { SessionEventsCursor } from "~/server/app-layer/coding-agent/repositories/coding-agent-session-events.repository";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";

import { baseResponses } from "../../shared/base-responses";

patchZodOpenapi();

const MAX_PAGE = 1000;
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

const sessionEventSchema = z
  .object({
    timeUnixMs: z.number(),
    recordId: z.string(),
    eventKind: z.string(),
    agent: z.string(),
    promptId: z.string(),
    querySource: z.string(),
    agentType: z.string(),
    model: z.string(),
    inputTokens: z.number(),
    outputTokens: z.number(),
    cacheReadTokens: z.number(),
    cacheCreationTokens: z.number(),
    costUsd: z.number(),
    durationMs: z.number(),
    preTokens: z.number(),
    postTokens: z.number(),
    compactionTrigger: z.string(),
    toolName: z.string(),
  })
  .passthrough();

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

    const limitRaw = Number(c.req.query("limit") ?? DEFAULT_PAGE);
    const limit =
      Number.isSafeInteger(limitRaw) && limitRaw > 0
        ? Math.min(limitRaw, MAX_PAGE)
        : DEFAULT_PAGE;

    const kindsRaw = c.req.query("kinds");
    const kinds = kindsRaw
      ? kindsRaw
          .split(",")
          .map((kind) => kind.trim())
          .filter((kind) => kind.length > 0)
      : undefined;

    const fromRaw = c.req.query("from");
    const toRaw = c.req.query("to");
    const fromMs = fromRaw ? Number(fromRaw) : undefined;
    const toMs = toRaw ? Number(toRaw) : undefined;
    const occurredAt =
      Number.isFinite(fromMs) && Number.isFinite(toMs)
        ? { fromMs: fromMs!, toMs: toMs! }
        : undefined;

    const cursor = decodeCursor(c.req.query("cursor"));

    const { events, nextCursor } =
      await getApp().codingAgents.sessions.getSessionEvents({
        projectId: project.id,
        sessionId,
        kinds,
        occurredAt,
        cursor,
        limit,
      });

    return c.json({
      events: events.map(({ tenantId: _tenantId, ...event }) => event),
      nextCursor: nextCursor ? encodeCursor(nextCursor) : null,
    });
  },
);

function encodeCursor(cursor: SessionEventsCursor): string {
  return Buffer.from(
    JSON.stringify({ t: cursor.timeUnixMs, r: cursor.recordId }),
  ).toString("base64url");
}

function decodeCursor(
  raw: string | undefined,
): SessionEventsCursor | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8"),
    ) as { t?: unknown; r?: unknown };
    if (typeof parsed.t !== "number" || typeof parsed.r !== "string") {
      return undefined;
    }
    return { timeUnixMs: parsed.t, recordId: parsed.r };
  } catch {
    return undefined;
  }
}

export const app = secured.hono;
