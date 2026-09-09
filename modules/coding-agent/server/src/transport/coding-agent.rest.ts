/**
 * The coding-agent reads over the project-scoped `/api/coding-agent` prefix.
 * `coding-agent` is dated with an `/api/v1` twin; `coding-agent-rollup` answers
 * at the bare path alone, the v1 address being another family's.
 */
import {
  CodingAgentApi,
  MAX_CODING_AGENT_SESSION_EVENTS_PAGE_SIZE,
  type CodingAgentCallerScope,
  type CodingAgentSessionCursor,
} from "@langwatch/coding-agent-contract";
import {
  baseResponses,
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  resolvePersonalCaller,
} from "@langwatch/api/rest";
import { ValidationError } from "@langwatch/handled-error";
import { z } from "zod";

import {
  pullRequestUsageQuerySchema,
  pullRequestUsageResponseSchema,
} from "../rules/pull-request-usage-wire.rules.ts";

// Rejected here so an over-large `limit` is refused outright rather than
// silently answered with a narrower page; the service clamps to the same
// ceiling for every other caller.
const MAX_PAGE = MAX_CODING_AGENT_SESSION_EVENTS_PAGE_SIZE;
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

/**
 * What the project door resolved: the workspace the personal-workspace guard is
 * applied to, and the credential itself, which reads with its own bindings.
 */
export const codingAgentRestCaller = defineRestMiddleware(
  "codingAgentRestCaller",
  z.object({
    project: z.object({
      isPersonal: z.boolean().nullable(),
      ownerUserId: z.string().nullable(),
    }),
    credential: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("legacyProjectKey") }),
      z.object({
        kind: z.literal("apiKey"),
        apiKeyId: z.string(),
        userId: z.string().nullable(),
        organizationId: z.string(),
        projectId: z.string(),
        teamId: z.string(),
      }),
    ]),
  }),
);

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

/** Query parsing that REFUSES what it cannot honour. */
const eventsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(MAX_PAGE).default(DEFAULT_PAGE),
  kinds: z
    .string()
    .optional()
    .describe(`Comma-separated event kinds to include. Known kinds: ${EVENT_KINDS.join(", ")}.`)
    .transform((raw) =>
      raw
        ? raw
            .split(",")
            .map((kind) => kind.trim())
            .filter((kind) => kind.length > 0)
        : undefined,
    ),
  from: z.coerce
    .number()
    .finite()
    .optional()
    .describe(
      "Epoch ms lower bound on event time; with `to`, prunes storage partitions for faster reads.",
    ),
  to: z.coerce.number().finite().optional().describe("Epoch ms upper bound on event time."),
  cursor: z
    .string()
    .optional()
    .describe("Opaque keyset cursor from the previous response's nextCursor.")
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

const sessionParamsSchema = z.object({
  sessionId: z
    .string()
    .min(1)
    .describe("The agent's own session id (session.id / conversation id)."),
});

const sessionEventsResponseSchema = z.object({
  events: z.array(sessionEventSchema),
  nextCursor: z.string().nullable(),
});

/**
 * One session's event sequence, in time order: every model call with its
 * context and cost, every compaction with its before/after tokens, rate limits,
 * tool runs, prompts. Scalar facts only; content stays on the trace/log reads.
 */
export const codingAgentRest = defineRestRouter(CodingAgentApi)
  .withNamespace("coding-agent")
  .withVersion(MANAGEMENT_API_VERSION)

  .get("/sessions/:sessionId/events", "listCodingAgentSessionEvents")
  .withParams(sessionParamsSchema)
  .withQuery(eventsQuerySchema)
  .withPermission("traces:view")
  .withOutput(sessionEventsResponseSchema)
  .withDocs({
    summary: "List coding agent session events",
    description:
      "List a coding-agent session's events (model calls, compactions, rate limits, " +
      "tool runs, prompts) in time order, keyset-paginated. Pass the previous " +
      "response's nextCursor to continue; filter with kinds (comma-separated).",
    responses: baseResponses,
  })
  .handle(async ({ app, input, scope }) => {
    // Both bounds or neither: half a window would silently widen the read
    // past what the caller asked for.
    if ((input.from === undefined) !== (input.to === undefined)) {
      throw new ValidationError("from and to must be supplied together");
    }

    const { events, nextCursor } = await app.getSessionEvents({
      projectId: scope.id,
      sessionId: input.sessionId,
      kinds: input.kinds,
      occurredAt:
        input.from !== undefined && input.to !== undefined
          ? { fromMs: input.from, toMs: input.to }
          : undefined,
      cursor: input.cursor,
      limit: input.limit,
    });

    return { events, nextCursor: nextCursor ? encodeCursor(nextCursor) : null };
  })
  .build();

/**
 * What one pull request cost in assistant usage, across every project of the
 * organization the CALLING CREDENTIAL may read. Numbers and names only: no
 * session title, no prompt, no file list.
 */
export const codingAgentRollupRest = defineRestRouter(CodingAgentApi)
  .withNamespace("coding-agent-rollup")
  .withVersion(MANAGEMENT_API_VERSION)
  // The bare path alone, at exactly the address it has always answered.
  .withAddressing("literal", { v1Twin: false })

  .get("/api/coding-agent/pull-request-usage", "getCodingAgentPullRequestUsage")
  .withQuery(pullRequestUsageQuerySchema)
  .withPermission("traces:view")
  .withOutput(pullRequestUsageResponseSchema)
  .withMiddleware(codingAgentRestCaller)
  .withDocs({
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
      "calling user may view, and cost only for those they may price.",
    responses: baseResponses,
  })
  .handle(async ({ app, input, scope }, caller) => {
    // Whose data this is stays the personal-workspace question it always was.
    // What the read REACHES is the credential's, the same way the v1 door
    // reads it.
    const ownerUserId = resolvePersonalCaller({
      project: caller.project,
      credential: caller.credential,
    });
    const by: CodingAgentCallerScope =
      caller.credential.kind === "legacyProjectKey"
        ? { kind: "user", userId: ownerUserId }
        : {
            kind: "apiKey",
            apiKeyId: caller.credential.apiKeyId,
            userId: caller.credential.userId,
          };
    const host = input.host ?? new URL(app.githubWebBase()).hostname;

    // The application resolves the organization behind the project, refuses an
    // orphan as "not mapped", and applies the same permission cut the in-app
    // surfaces resolve — names included.
    const { usage, organizationId } = await app.getPullRequestUsage(
      {
        projectId: scope.id,
        repositoryHost: host,
        repositoryFullName: input.repository,
        prNumber: input.pullRequest,
      },
      by,
    );

    // Awaited before the answer leaves, so a read is never served unrecorded.
    await app.recordPullRequestUsageRead({
      readerUserId: ownerUserId,
      organizationId,
      repositoryHost: host,
      repositoryFullName: input.repository,
      prNumber: input.pullRequest,
      contributingProjectCount: new Set(usage.rows.map((row) => row.projectId)).size,
    });

    return usage;
  })
  .build();

function encodeCursor(cursor: CodingAgentSessionCursor): string {
  return Buffer.from(JSON.stringify({ t: cursor.timeUnixMs, r: cursor.recordId })).toString(
    "base64url",
  );
}

function decodeCursor(raw: string): CodingAgentSessionCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as {
      t?: unknown;
      r?: unknown;
    };
    if (typeof parsed.t !== "number" || typeof parsed.r !== "string") {
      return null;
    }
    return { timeUnixMs: parsed.t, recordId: parsed.r };
  } catch {
    return null;
  }
}
