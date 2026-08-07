// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Databricks AI/BI Genie puller — the first adapter whose records exist for
 * VISIBILITY rather than for money (ADR-088 Decisions 1, 2 and 5).
 *
 * Genie is a natural-language analytics surface: a user asks a question, Genie
 * writes SQL against Unity Catalog and runs it. For governance that is the
 * whole point — the question and the generated SQL are the sensitive artefacts,
 * and until now they were invisible to the platform. Every other pulled source
 * answers "what did this cost"; this one answers "who asked what, and what SQL
 * did it run against our warehouse".
 *
 * It cannot be an `HttpPollingPullerAdapter` config. That adapter maps one flat
 * paginated feed through JSON paths, and Genie is a THREE-level walk —
 * spaces → conversations → messages — with a separate SCIM call to turn the
 * numeric author id into a person. A declarative field mapping has nowhere to
 * put a join.
 *
 * Three things about the upstream API that are load-bearing, each verified
 * against a live workspace rather than read off the docs:
 *
 *   `include_all=true` is NOT optional. Without it the conversations endpoint
 *   returns only the CALLER'S OWN conversations. A governance puller that
 *   omitted it would run green forever and report one user's activity as if it
 *   were the workspace's — the worst possible failure for this feature, because
 *   nothing anywhere would look wrong.
 *
 *   Cost is absent, and its absence is the design. Genie charges nothing per
 *   message; the SQL warehouse DBUs a question burns are billed through
 *   Databricks' own system tables, which this API does not expose. So the
 *   record carries zero — `provider_reported` because it is the provider's
 *   position and not a figure we derived, `estimate` because zero is honestly
 *   an approximation of what the warehouse actually charged. Claiming `exact`
 *   would assert we hold the invoice for a question we can only see half of.
 *
 *   A message is immutable, so restatement never happens here. The dimensions
 *   are the coordinates of the message itself and nothing about the author, so
 *   an identity that resolves differently on a later pull (a backfilled SCIM
 *   `externalId`, a renamed account) re-labels the record instead of minting a
 *   second one.
 */

import { createLogger } from "@langwatch/observability";
import { z } from "zod";

import { ssrfSafeFetch } from "~/utils/ssrfProtection";
import { PULLED_USAGE_HINT_KEY } from "./pulledUsageRecord";
import type {
  NormalizedPullEvent,
  PullerAdapter,
  PullResult,
  PullRunOptions,
} from "./pullerAdapter";

const logger = createLogger("langwatch:governance:databricks-genie-puller");

const REQUEST_TIMEOUT_MS = 30_000;
const PAGE_SIZE = 100;

/**
 * What one run will read before handing the rest to the next one. The walk is
 * three levels deep, so this counts HTTP requests rather than pages of one
 * feed: a workspace with hundreds of conversations must not turn a single run
 * into an unbounded crawl of the whole history.
 */
const MAX_REQUESTS_PER_RUN = 400;

/** The ledger's model label. Genie is one product, not a family of models. */
const GENIE_MODEL = "databricks/genie" as const;

export const DATABRICKS_GENIE_ADAPTER_ID = "databricks_genie" as const;

export const databricksGeniePullConfigSchema = z.object({
  adapter: z.literal(DATABRICKS_GENIE_ADAPTER_ID),
  /** Workspace base URL, e.g. `https://adb-1234567890.4.azuredatabricks.net`. */
  workspaceUrl: z.string().url(),
  /**
   * Which spaces to pull. Empty means "every space the credential can see",
   * which is the setting most customers want and the one that silently starts
   * covering a space the day someone creates it.
   */
  spaceIds: z.array(z.string()).default([]),
  /** ISO instant the very first run starts from. Later runs use the cursor. */
  startingAt: z.string().datetime().optional(),
  schedule: z.string().default("*/15 * * * *"),
});
export type DatabricksGeniePullConfig = z.infer<
  typeof databricksGeniePullConfigSchema
>;

/**
 * The durable cursor.
 *
 * `sinceMs` is the watermark: a message is new when it was created after it.
 * It only moves once a full sweep has drained, because the sweep visits spaces
 * in whatever order the API lists them and advancing mid-sweep would move the
 * watermark past a space that had not been read yet.
 *
 * `spaceId` / `conversationPage` are where an interrupted sweep resumes, so a
 * run cut off at its deadline picks up where it stopped rather than restarting
 * the crawl. `maxSeenMs` accumulates the newest message the in-flight sweep has
 * seen, and becomes the next `sinceMs` when the sweep completes.
 */
const cursorSchema = z.object({
  sinceMs: z.number().int().nonnegative(),
  spaceId: z.string().nullable().default(null),
  conversationPage: z.string().nullable().default(null),
  maxSeenMs: z.number().int().nonnegative().default(0),
});
type GenieCursor = z.infer<typeof cursorSchema>;

function parseCursor(
  cursor: string | null,
  config: DatabricksGeniePullConfig,
): GenieCursor {
  if (cursor) {
    try {
      return cursorSchema.parse(JSON.parse(cursor));
    } catch {
      logger.warn(
        { cursor },
        "unreadable databricks genie cursor; restarting from the configured watermark",
      );
    }
  }
  const sinceMs = config.startingAt
    ? Date.parse(config.startingAt)
    : defaultSinceMs();
  return {
    sinceMs: Number.isFinite(sinceMs) ? sinceMs : defaultSinceMs(),
    spaceId: null,
    conversationPage: null,
    maxSeenMs: 0,
  };
}

/** A first run with no configured watermark reads the last 30 days. */
function defaultSinceMs(): number {
  return Date.now() - 30 * 24 * 60 * 60 * 1000;
}

const spaceSchema = z
  .object({
    space_id: z.string(),
    title: z.string().nullable().default(null),
  })
  .passthrough();

const spacesPageSchema = z.object({
  spaces: z.array(spaceSchema).default([]),
  next_page_token: z.string().nullable().default(null),
});

const conversationSchema = z
  .object({
    conversation_id: z.string(),
    title: z.string().nullable().default(null),
    created_timestamp: z.number().nullable().default(null),
  })
  .passthrough();

const conversationsPageSchema = z.object({
  conversations: z.array(conversationSchema).default([]),
  next_page_token: z.string().nullable().default(null),
});

/**
 * One Genie message. `attachments` is a union in the wire format — a text
 * reply, a generated query, a set of suggested follow-ups, a visualisation —
 * so everything but the id is optional and unknown members pass through.
 */
const attachmentSchema = z
  .object({
    attachment_id: z.string().optional(),
    query: z
      .object({
        query: z.string().nullable().default(null),
        description: z.string().nullable().default(null),
        statement_id: z.string().nullable().default(null),
        query_result_metadata: z
          .object({ row_count: z.number().nullable().default(null) })
          .passthrough()
          .nullable()
          .default(null),
      })
      .passthrough()
      .optional(),
    text: z
      .object({ content: z.string().nullable().default(null) })
      .passthrough()
      .optional(),
  })
  .passthrough();

const messageSchema = z
  .object({
    message_id: z.string(),
    conversation_id: z.string().nullable().default(null),
    space_id: z.string().nullable().default(null),
    /** Databricks' numeric account id for the author. Immutable. */
    user_id: z.number().nullable().default(null),
    /** The question, as the user typed it. */
    content: z.string().nullable().default(null),
    status: z.string().nullable().default(null),
    created_timestamp: z.number().nullable().default(null),
    attachments: z.array(attachmentSchema).nullable().default(null),
  })
  .passthrough();

const messagesPageSchema = z.object({
  messages: z.array(messageSchema).default([]),
  next_page_token: z.string().nullable().default(null),
});

const scimUserSchema = z
  .object({
    userName: z.string().nullable().default(null),
    externalId: z.string().nullable().default(null),
    displayName: z.string().nullable().default(null),
  })
  .passthrough();

/** Who asked, resolved once per run and reused across every message. */
interface GenieIdentity {
  /**
   * The stable identity key: the IdP's object id when the directory carries
   * one, the login name otherwise. `externalId` is written once at account
   * creation and is absent for accounts provisioned before SCIM was wired, so
   * it cannot be the sole key — an adapter that insisted on it would attribute
   * a real person's activity to nobody.
   */
  key: string;
  /** The email-shaped login, which is what `actor` means everywhere else. */
  email: string;
  externalId: string;
  displayName: string;
}

const UNKNOWN_IDENTITY: GenieIdentity = {
  key: "",
  email: "",
  externalId: "",
  displayName: "",
};

/**
 * Budgets one run's HTTP calls and its deadline in one place.
 *
 * Both limits mean the same thing to the caller — stop sweeping, keep what you
 * read, resume from the cursor — so they are one question rather than two
 * checks scattered through three nested loops.
 */
class RunBudget {
  private requests = 0;

  constructor(private readonly deadlineMs: number | undefined) {}

  spend(): void {
    this.requests += 1;
  }

  exhausted(): boolean {
    if (this.requests >= MAX_REQUESTS_PER_RUN) return true;
    return this.deadlineMs !== undefined && Date.now() > this.deadlineMs;
  }
}

/**
 * What one sweep read, and where it stopped.
 *
 * `stoppedAt` null means drained — the only state in which the watermark is
 * allowed to move.
 */
interface SweepResult {
  events: NormalizedPullEvent[];
  maxSeenMs: number;
  stoppedAt: { spaceId: string; conversationPage: string | null } | null;
}

export class DatabricksGeniePuller
  implements PullerAdapter<DatabricksGeniePullConfig>
{
  readonly id: string = DATABRICKS_GENIE_ADAPTER_ID;

  validateConfig(config: unknown): DatabricksGeniePullConfig {
    return databricksGeniePullConfigSchema.parse(config);
  }

  async runOnce(
    options: PullRunOptions,
    config: DatabricksGeniePullConfig,
  ): Promise<PullResult> {
    const token = options.credentials?.token;
    if (!token) {
      throw new Error(
        "databricks genie puller requires a workspace bearer token in credentials.token",
      );
    }

    const cursor = parseCursor(options.cursor, config);
    const budget = new RunBudget(options.deadlineMs);

    let sweep: SweepResult;
    try {
      sweep = await this.sweep({ config, token, options, budget, cursor });
    } catch (error) {
      // A failed sweep leaves the cursor exactly where it was, so the window is
      // retried rather than skipped. Returning the events already read would
      // be worse than dropping them: the OCSF sink dedups on the message id, so
      // the retry re-lands them anyway, and reporting a partial sweep as a
      // successful one is how a watermark advances past unread history.
      logger.error(
        {
          adapter: this.id,
          workspaceUrl: config.workspaceUrl,
          error: error instanceof Error ? error.message : String(error),
        },
        "databricks genie sweep failed; leaving the cursor where it was",
      );
      return { events: [], cursor: options.cursor, errorCount: 1 };
    }

    // An interrupted sweep keeps `sinceMs` where it was and records where to
    // resume; only a COMPLETE one moves the watermark, and only forward — a
    // sweep that saw nothing new must not drag it back to zero.
    return {
      events: sweep.events,
      cursor: encode(
        sweep.stoppedAt
          ? {
              sinceMs: cursor.sinceMs,
              spaceId: sweep.stoppedAt.spaceId,
              conversationPage: sweep.stoppedAt.conversationPage,
              maxSeenMs: sweep.maxSeenMs,
            }
          : {
              sinceMs: Math.max(cursor.sinceMs, sweep.maxSeenMs),
              spaceId: null,
              conversationPage: null,
              maxSeenMs: 0,
            },
      ),
      errorCount: 0,
    };
  }

  /**
   * Walks spaces → conversations → messages until drained or out of budget.
   *
   * Returns where it stopped rather than deciding what that means for the
   * cursor. The watermark rule is one decision and it lives in `runOnce`; a
   * sweep that also encoded cursors would let "we ran out of budget" and "we
   * finished" be answered in two places.
   */
  private async sweep({
    config,
    token,
    options,
    budget,
    cursor,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: RunBudget;
    cursor: GenieCursor;
  }): Promise<SweepResult> {
    // One SCIM lookup per author per run, not per message. A conversation is
    // many messages by one person, so the naive version would ask the identity
    // provider the same question dozens of times inside one sweep.
    const identities = new Map<number, GenieIdentity>();
    const events: NormalizedPullEvent[] = [];
    let maxSeenMs = cursor.maxSeenMs;

    const spaces = await this.resolveSpaces({ config, token, options, budget });
    // Resume where the last sweep stopped. An unknown id means the space was
    // deleted mid-sweep, and starting over is the safe answer: the watermark
    // has not moved, so nothing is skipped.
    const resumeAt = cursor.spaceId
      ? spaces.findIndex((s) => s.space_id === cursor.spaceId)
      : 0;
    const startIndex = resumeAt >= 0 ? resumeAt : 0;
    let page = resumeAt >= 0 ? cursor.conversationPage : null;

    for (let i = startIndex; i < spaces.length; i += 1) {
      const space = spaces[i]!;
      do {
        if (budget.exhausted()) {
          return {
            events,
            maxSeenMs,
            stoppedAt: { spaceId: space.space_id, conversationPage: page },
          };
        }

        const conversations = conversationsPageSchema.parse(
          await this.get({
            config,
            token,
            options,
            budget,
            path: `/api/2.0/genie/spaces/${encodeURIComponent(space.space_id)}/conversations`,
            // Without this the endpoint answers with the CALLER'S OWN
            // conversations only, and a governance sweep would quietly report
            // one service account's activity as the workspace's.
            query: { include_all: "true", page_size: String(PAGE_SIZE) },
          }),
        );

        for (const conversation of conversations.conversations) {
          const read = await this.conversationMessages({
            config,
            token,
            options,
            budget,
            space,
            conversation,
            sinceMs: cursor.sinceMs,
            identities,
          });
          events.push(...read.events);
          maxSeenMs = Math.max(maxSeenMs, read.maxSeenMs);
        }

        page = conversations.next_page_token;
      } while (page);
    }

    return { events, maxSeenMs, stoppedAt: null };
  }

  /** The configured spaces, or every space the credential can see. */
  private async resolveSpaces({
    config,
    token,
    options,
    budget,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: RunBudget;
  }): Promise<Array<z.infer<typeof spaceSchema>>> {
    if (config.spaceIds.length > 0) {
      // Titles are only a label, so a configured list does not pay for a
      // discovery call to fetch them.
      return config.spaceIds.map((space_id) => ({ space_id, title: null }));
    }

    const spaces: Array<z.infer<typeof spaceSchema>> = [];
    let page: string | null = null;
    do {
      const parsed: z.infer<typeof spacesPageSchema> = spacesPageSchema.parse(
        await this.get({
          config,
          token,
          options,
          budget,
          path: "/api/2.0/genie/spaces",
          query: {
            page_size: String(PAGE_SIZE),
            ...(page ? { page_token: page } : {}),
          },
        }),
      );
      spaces.push(...parsed.spaces);
      page = parsed.next_page_token;
    } while (page && !budget.exhausted());
    return spaces;
  }

  /** Every new message in one conversation, mapped to events. */
  private async conversationMessages({
    config,
    token,
    options,
    budget,
    space,
    conversation,
    sinceMs,
    identities,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: RunBudget;
    space: z.infer<typeof spaceSchema>;
    conversation: z.infer<typeof conversationSchema>;
    sinceMs: number;
    identities: Map<number, GenieIdentity>;
  }): Promise<{ events: NormalizedPullEvent[]; maxSeenMs: number }> {
    const events: NormalizedPullEvent[] = [];
    let maxSeenMs = 0;
    let page: string | null = null;

    do {
      const parsed: z.infer<typeof messagesPageSchema> =
        messagesPageSchema.parse(
          await this.get({
            config,
            token,
            options,
            budget,
            path: `/api/2.0/genie/spaces/${encodeURIComponent(space.space_id)}/conversations/${encodeURIComponent(conversation.conversation_id)}/messages`,
            query: {
              page_size: String(PAGE_SIZE),
              ...(page ? { page_token: page } : {}),
            },
          }),
        );

      for (const message of parsed.messages) {
        const createdMs = message.created_timestamp;
        // A message with no timestamp cannot be placed on the watermark, and
        // emitting it would either re-emit it on every future sweep or file it
        // under `now`. Skipping it loses one row; the alternatives corrupt the
        // cursor for every row after it.
        if (createdMs === null || !Number.isFinite(createdMs)) {
          logger.warn(
            { adapter: this.id, messageId: message.message_id },
            "genie message has no created_timestamp; skipping",
          );
          continue;
        }
        maxSeenMs = Math.max(maxSeenMs, createdMs);
        if (createdMs <= sinceMs) continue;

        events.push(
          this.messageEvent({
            message,
            space,
            conversation,
            createdMs,
            identity: await this.identityFor({
              config,
              token,
              options,
              budget,
              userId: message.user_id,
              identities,
            }),
          }),
        );
      }
      page = parsed.next_page_token;
    } while (page && !budget.exhausted());

    return { events, maxSeenMs };
  }

  /**
   * The person behind a numeric author id, cached for the run.
   *
   * A SCIM lookup that fails is cached as unknown rather than retried per
   * message: a deactivated account 404s every time, and re-asking once per
   * message would turn one deleted user into hundreds of wasted calls. The
   * event still lands — an unattributed question is worth recording, and a
   * missing author must not cost the workspace its visibility.
   */
  private async identityFor({
    config,
    token,
    options,
    budget,
    userId,
    identities,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: RunBudget;
    userId: number | null;
    identities: Map<number, GenieIdentity>;
  }): Promise<GenieIdentity> {
    if (userId === null) return UNKNOWN_IDENTITY;
    const cached = identities.get(userId);
    if (cached) return cached;

    let identity = UNKNOWN_IDENTITY;
    try {
      const user = scimUserSchema.parse(
        await this.get({
          config,
          token,
          options,
          budget,
          path: `/api/2.0/preview/scim/v2/Users/${encodeURIComponent(String(userId))}`,
        }),
      );
      const email = user.userName ?? "";
      const externalId = user.externalId ?? "";
      identity = {
        key: externalId || email || String(userId),
        email,
        externalId,
        displayName: user.displayName ?? "",
      };
    } catch (error) {
      logger.warn(
        {
          adapter: this.id,
          userId,
          error: error instanceof Error ? error.message : String(error),
        },
        "could not resolve a genie author through SCIM; recording the message unattributed",
      );
    }
    identities.set(userId, identity);
    return identity;
  }

  /**
   * One message → one visibility record.
   *
   * The dimensions are the message's own coordinates and nothing else. Not the
   * author: identity resolution can change between pulls (a backfilled
   * `externalId`, a renamed account) and an author in the key would mint a
   * SECOND record for a message that has not changed. Not the space title
   * either, for the same reason — it is a label an admin can edit.
   */
  private messageEvent({
    message,
    space,
    conversation,
    createdMs,
    identity,
  }: {
    message: z.infer<typeof messageSchema>;
    space: z.infer<typeof spaceSchema>;
    conversation: z.infer<typeof conversationSchema>;
    createdMs: number;
    identity: GenieIdentity;
  }): NormalizedPullEvent {
    const generated = message.attachments?.find((a) => a.query?.query);
    const dimensions = {
      spaceId: space.space_id,
      conversationId: conversation.conversation_id,
      messageId: message.message_id,
    };

    return {
      source_event_id: message.message_id,
      event_timestamp: new Date(createdMs).toISOString(),
      actor: identity.email,
      action: "genie_query",
      target: space.title ?? space.space_id,
      // Genie bills nothing per message. See the file header: the warehouse
      // DBUs the generated SQL burns are billed elsewhere and are not on this
      // API, so the record says zero and declines to call it the full invoice.
      cost_usd: 0,
      tokens_input: 0,
      tokens_output: 0,
      raw_payload: JSON.stringify(message),
      extra: {
        spaceId: space.space_id,
        spaceTitle: space.title ?? "",
        conversationId: conversation.conversation_id,
        conversationTitle: conversation.title ?? "",
        messageId: message.message_id,
        status: message.status ?? "",
        // The two artefacts this adapter exists to surface.
        question: message.content ?? "",
        generatedSql: generated?.query?.query ?? "",
        statementId: generated?.query?.statement_id ?? "",
        rowCount: generated?.query?.query_result_metadata?.row_count ?? null,
        // The resolved author, all three forms. `actorKey` is the one to join
        // on; the other two are what a human reads.
        actorKey: identity.key,
        actorEmail: identity.email,
        actorExternalId: identity.externalId,
        actorDisplayName: identity.displayName,
        actorUserId: message.user_id === null ? "" : String(message.user_id),
        [PULLED_USAGE_HINT_KEY]: {
          costBasis: "provider_reported",
          // Not `exact`. Zero is Genie's own per-message price, but the
          // warehouse cost behind the question is invoiced through Databricks'
          // system tables, which this API does not expose. `estimate` says
          // that plainly instead of claiming we hold the whole figure.
          costStatus: "estimate",
          costUsd: "0",
          dimensions,
          model: GENIE_MODEL,
        },
      },
    };
  }

  /** One authenticated GET, budgeted and abortable. */
  private async get({
    config,
    token,
    options,
    budget,
    path,
    query,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: RunBudget;
    path: string;
    query?: Record<string, string>;
  }): Promise<unknown> {
    const url = new URL(path, config.workspaceUrl);
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, value);
    }

    const signal = options.signal
      ? AbortSignal.any([
          options.signal,
          AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        ])
      : AbortSignal.timeout(REQUEST_TIMEOUT_MS);

    budget.spend();
    const response = await ssrfSafeFetch(url.toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal,
    });
    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status} ${response.statusText} (databricks genie ${path})`,
      );
    }
    return await response.json();
  }
}

function encode(cursor: GenieCursor): string {
  return JSON.stringify(cursor);
}
