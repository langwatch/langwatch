import { auditLog } from "@ee/audit-log/auditLog";
import { ValidationError } from "@langwatch/handled-error";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import { createProjectApp, requires } from "~/server/api/security";
import { getApp } from "~/server/app-layer/app";
import { MAX_SESSION_EVENTS_PAGE_SIZE } from "~/server/app-layer/coding-agent/coding-agent-session.service";
import type { SessionEventsCursor } from "~/server/app-layer/coding-agent/repositories/coding-agent-session-events.repository";
import { GithubPullRequestNotMappedError } from "~/server/app-layer/github/errors";
import {
  type CallerApiKeyCeiling,
  resolveCallerProjectScope,
} from "~/server/organizations/resolveCallerProjectScope";
import { resolveOrganizationId } from "~/server/organizations/resolveOrganizationId";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";

import { baseResponses } from "../../shared/base-responses";
import { resolvePersonalCaller } from "../../shared/personal-project-caller";
import {
  pullRequestUsageQuerySchema,
  pullRequestUsageResponseSchema,
} from "./pull-request-usage-wire";

patchZodOpenapi();

// Rejected here so an over-large `limit` is refused outright rather than
// silently answered with a narrower page; the service clamps to the same
// ceiling for every other caller.
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

// GET /sessions/:sessionId/events: one session's event sequence, in time
// order: every model call with its context and cost, every compaction with
// its before/after tokens, rate limits, tool runs, prompts. The raw material
// for per-call context and cost analytics; scalar facts only, content stays
// on the trace/log reads.
secured.access(requires("traces:view")).get(
  "/sessions/:sessionId/events",
  describeRoute({
    summary: "List coding agent session events",
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
      throw ValidationError.fromZodError(query.error);
    }
    const { limit, kinds, from, to, cursor } = query.data;
    // Both bounds or neither: half a window would silently widen the read
    // past what the caller asked for.
    if ((from === undefined) !== (to === undefined)) {
      throw new ValidationError("from and to must be supplied together");
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

// GET /pull-request-usage: what one pull request cost in assistant usage,
// across every project of the organization the CALLER may read. Numbers and
// names only: no session title, no prompt, no file list.
secured.access(requires("traces:view")).get(
  "/pull-request-usage",
  describeRoute({
    summary: "Get pull request coding agent usage",
    description:
      "Assistant usage for one pull request: sessions, tokens and cost, " +
      "grouped by contributor and agent, plus per-model totals, " +
      "over the pull request's whole lifetime rather than a time window. " +
      "Every row and the totals split cost three ways: the part priced per " +
      "token, the part a bundled subscription already covers, and the " +
      "list-price total of both. Per-model totals carry the list price only. " +
      "Cost is calculated from the tokens the agent reported and LangWatch's " +
      "model prices, so it estimates spend rather than restating a provider " +
      "invoice. " +
      "Requires a personal-project API key; rows appear only for projects the " +
      "calling user may view, and cost only for those they may price. " +
      "Prefer `GET /api/v1/coding-agent/pull-request-usage`, which answers the " +
      "same question with an organization API key alone and needs no " +
      "X-Project-Id header.",
    parameters: [
      {
        name: "repository",
        in: "query",
        required: true,
        schema: { type: "string" },
        description: 'The repository as "owner/name".',
      },
      {
        name: "pullRequest",
        in: "query",
        required: true,
        schema: { type: "integer" },
        description: "The pull request number.",
      },
      {
        name: "host",
        in: "query",
        required: false,
        schema: { type: "string", default: "github.com" },
      },
    ],
    responses: {
      ...baseResponses,
      200: {
        description: "The pull request's usage rollup",
        content: {
          "application/json": {
            schema: resolver(pullRequestUsageResponseSchema),
          },
        },
      },
    },
  }),
  async (c) => {
    const project = c.get("project");
    // The rollup answers with whatever the CALLER may read across the whole
    // organization, so it needs a person rather than just a project.
    const callerUserId = resolvePersonalCaller({
      project,
      apiKeyUserId: c.get("apiKeyUserId"),
    });

    const query = pullRequestUsageQuerySchema.safeParse({
      repository: c.req.query("repository"),
      pullRequest: c.req.query("pullRequest"),
      host: c.req.query("host"),
    });
    if (!query.success) throw ValidationError.fromZodError(query.error);

    const organizationId = await resolveOrganizationId(project.id);
    if (!organizationId) {
      throw new GithubPullRequestNotMappedError({
        repositoryFullName: query.data.repository,
        prNumber: query.data.pullRequest,
      });
    }

    // The same permission cut the in-app surfaces resolve, names included: a
    // caller reading this rollup is building something that has to say WHO the
    // usage belongs to, and the agent-reported id it used to get instead
    // resolved to nobody. A user-bound API key also brings its own binding
    // ceiling: a deliberately narrowed key reads with its own scope, never
    // its holder's full one. A legacy project key carries no ceiling by
    // design, so none is applied for it.
    const apiKeyId = c.get("apiKeyId");
    const scope = await resolveCallerProjectScope({
      userId: callerUserId,
      organizationId,
      ...(apiKeyId
        ? {
            apiKeyCeiling: {
              apiKeyId,
              check: (check: Parameters<CallerApiKeyCeiling["check"]>[0]) =>
                getApp().permissions.hasApiKeyPermission(check),
            },
          }
        : {}),
    });

    const usage =
      await getApp().codingAgents.pullRequestUsage.getPullRequestUsage({
        organizationId,
        repositoryHost: query.data.host,
        repositoryFullName: query.data.repository,
        prNumber: query.data.pullRequest,
        ...scope,
      });

    // This answer names people, so who read it stays attributable. Awaited
    // before the answer leaves, so a read is never served unrecorded. Never
    // the contributors themselves: how many projects fed the rollup says how
    // wide the read reached without copying the names into a second store
    // that outlives it.
    await auditLog({
      userId: callerUserId,
      organizationId,
      action: "codingAgents.pullRequestUsage",
      targetKind: "pullRequest",
      targetId: `${query.data.host}/${query.data.repository}#${query.data.pullRequest}`,
      args: {
        repository: query.data.repository,
        host: query.data.host,
        pullRequest: query.data.pullRequest,
        contributingProjectCount: new Set(
          usage.rows.map((row) => row.projectId),
        ).size,
      },
    });

    return c.json(usage);
  },
);

export const app = secured.hono;
