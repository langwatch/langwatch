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
 * How far back a completed sweep sets its watermark from the instant it began.
 *
 * The window is re-read on the next run, and that is the point. Genie's list
 * endpoints take no server-side time filter, so "new" is decided here against
 * `created_timestamp` — a value Databricks stamps on its own clock, not ours.
 * A watermark placed exactly at our sweep's start would drop any message whose
 * server timestamp landed a few seconds behind our clock. Re-reading five
 * minutes costs a handful of requests and dedups on the message id at both
 * sinks; the alternative silently loses messages at the boundary.
 */
const WATERMARK_LAG_MS = 5 * 60 * 1000;

/**
 * The durable cursor.
 *
 * `sinceMs` is the watermark: a message is new when it was created after it.
 * `spaceId` is where a budget-truncated sweep resumes, so a large workspace
 * makes forward progress across runs instead of re-crawling from the top and
 * running out at the same place every time.
 */
const cursorSchema = z.object({
  sinceMs: z.number().int().nonnegative(),
  spaceId: z.string().nullable().default(null),
  /**
   * Where inside `spaceId` to resume, or null to start that space from the top.
   *
   * Space granularity alone is not enough. A space whose walk costs more than
   * one run's entire request budget could never be finished: every run would
   * restart it from the first conversation, run out at roughly the same place,
   * and the sweep would never advance past it — so no space ordered after it
   * would be swept either. Nothing was lost (the watermark is held), but
   * nothing arrived. This carries the position inside the space so each run
   * picks up where the last one stopped.
   */
  conversationId: z.string().nullable().default(null),
  /**
   * When the sweep currently IN FLIGHT began, or null when none is.
   *
   * A sweep is not a run. The budget can cut one short and `spaceId` carries
   * it into the next run, so a large workspace is swept across several runs
   * over several scheduled ticks. The watermark has to anchor to when that
   * whole sweep started, which means the instant has to outlive the run that
   * stamped it — hence the cursor rather than a local.
   */
  sweepStartedAtMs: z.number().int().positive().nullable().default(null),
});
type GenieCursor = z.infer<typeof cursorSchema>;

/**
 * Where the watermark lands after a sweep.
 *
 * It moves ONLY on a complete sweep, and it is derived from when the sweep
 * BEGAN rather than from the newest message it saw. The difference is the
 * whole correctness argument: a sweep walks six spaces over some seconds or
 * minutes, and someone asking a question in space one while the sweep is
 * already reading space four is invisible to it. A watermark at the newest
 * message seen would sit AFTER that question's timestamp, and the next run
 * would filter it out — a message lost with nothing anywhere reporting a
 * failure. Anchored to the sweep's start, that question is still in the next
 * run's window.
 *
 * `sweepStartedAtMs` is the start of the SWEEP, which on a large workspace is
 * several runs back — not the start of the run calling this. Anchoring to the
 * current run would reintroduce the same loss on exactly the workspaces the
 * resume mechanism exists for: the gap between the first run and the last is
 * scheduling interval times the number of runs, and everything asked in an
 * already-swept space during that gap would be filtered out for good.
 *
 * `Math.max` against the previous value keeps it monotonic, so a clock that
 * steps backwards cannot rewind the window to the beginning of history.
 */
function nextWatermark({
  previousMs,
  sweepStartedAtMs,
  complete,
}: {
  previousMs: number;
  sweepStartedAtMs: number;
  complete: boolean;
}): number {
  if (!complete) return previousMs;
  return Math.max(previousMs, sweepStartedAtMs - WATERMARK_LAG_MS);
}

/**
 * The cursor's one invariant, enforced in the single place that mints one:
 * `conversationId` requires `spaceId`, and `spaceId` requires
 * `sweepStartedAtMs`.
 *
 * A resume point without the anchor it belongs to is worse than no resume
 * point. `runOnce` only treats a cursor as resuming when BOTH `spaceId` and
 * `sweepStartedAtMs` are set, so a cursor carrying a position but no anchor
 * would stamp a fresh anchor at now, still skip every space before the
 * position, complete, and then set the watermark from that fresh anchor —
 * losing everything it skipped. Cursors written before the anchor existed have
 * exactly that shape, so this is reachable rather than theoretical.
 */
function withoutOrphanedResume(cursor: GenieCursor): GenieCursor {
  if (cursor.sweepStartedAtMs !== null && cursor.spaceId !== null) {
    return cursor;
  }
  if (cursor.spaceId === null && cursor.conversationId === null) return cursor;
  logger.warn(
    { cursor },
    "databricks genie cursor carries a resume position with no sweep anchor; restarting the sweep from the top",
  );
  return { ...cursor, spaceId: null, conversationId: null };
}

function parseCursor(
  cursor: string | null,
  config: DatabricksGeniePullConfig,
): GenieCursor {
  if (cursor) {
    try {
      return withoutOrphanedResume(cursorSchema.parse(JSON.parse(cursor)));
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
    conversationId: null,
    sweepStartedAtMs: null,
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
 * The identity for a parsed SCIM user. Key precedence: the IdP object id when
 * the directory carries one, else the login email, else the raw numeric id —
 * see the `GenieIdentity.key` note for why `externalId` cannot stand alone.
 */
function genieIdentityFromScimUser(
  user: z.infer<typeof scimUserSchema>,
  userId: number,
): GenieIdentity {
  const email = user.userName ?? "";
  const externalId = user.externalId ?? "";
  return {
    key: externalId || email || String(userId),
    email,
    externalId,
    displayName: user.displayName ?? "",
  };
}

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
 * What one sweep read, and whether it read all of it.
 *
 * `complete` is the only thing the watermark is allowed to depend on, and it
 * is false for every reason a sweep might have left something behind: the
 * request budget ran out, the deadline hit, a space returned 403, one
 * conversation 429'd. They differ in cause and not in consequence — data we did
 * not fetch — so they collapse to one flag rather than a taxonomy the caller
 * would have to re-derive the same answer from.
 */
interface SweepResult {
  events: NormalizedPullEvent[];
  complete: boolean;
  /** Which space to start at next run, when the budget cut this one short. */
  resumeSpaceId: string | null;
  /** Where inside that space to start, or null to take it from the top. */
  resumeConversationId: string | null;
}

/** One page of a Databricks list endpoint, and whether more were left unread. */
interface PagedRead<T> {
  items: T[];
  complete: boolean;
}

/**
 * The spaces to sweep in a deterministic order, plus where to start.
 *
 * Exactly the same argument as `conversationWalkPlan`, one level up, and for
 * exactly the same reason: resuming skips everything before the resume point,
 * which is only sound if a space cannot move across it between runs.
 * `/api/2.0/genie/spaces` carries no ordering guarantee either, so a space that
 * existed when the sweep began could sit after the resume point on one run and
 * before it on the next, never be read, and then fall outside the window once
 * the completed sweep advanced the watermark. Sorting on the immutable
 * `space_id` removes the dependency on the API's order.
 *
 * `resumable` is false when the space listing was itself truncated: a partial
 * list has no trustworthy position in it, so the sweep restarts from the top.
 */
function spaceWalkPlan({
  spaces,
  resumeSpaceId,
}: {
  spaces: PagedRead<z.infer<typeof spaceSchema>>;
  resumeSpaceId: string | null;
}): {
  ordered: Array<z.infer<typeof spaceSchema>>;
  startAt: number;
  resumable: boolean;
} {
  const ordered = [...spaces.items].sort((a, b) =>
    a.space_id < b.space_id ? -1 : a.space_id > b.space_id ? 1 : 0,
  );
  const resumable = spaces.complete;
  // An id no longer in the list means the space was deleted since the cursor
  // was written; starting over only ever re-reads, and the watermark is held.
  const startAt =
    resumable && resumeSpaceId
      ? Math.max(
          ordered.findIndex((s) => s.space_id === resumeSpaceId),
          0,
        )
      : 0;
  return { ordered, startAt, resumable };
}

/**
 * One space's conversations in a deterministic order, plus where to start.
 *
 * The sort is the load-bearing part — see `spaceMessages` for why resuming is
 * only sound against an order we impose rather than the one the workspace
 * happened to return.
 *
 * `resumable` is false when the listing was itself cut short. A partial list
 * is only a PREFIX of the space's conversations, so a position inside it means
 * nothing: the conversations that would have sorted earlier may sit on a page
 * that was never read, and resuming into it would skip them permanently once
 * the sweep completed. Such a space restarts from the top instead — slower,
 * and still lossless.
 */
function conversationWalkPlan({
  conversations,
  resumeConversationId,
}: {
  conversations: PagedRead<z.infer<typeof conversationSchema>>;
  resumeConversationId: string | null;
}): {
  ordered: Array<z.infer<typeof conversationSchema>>;
  startAt: number;
  resumable: boolean;
} {
  const ordered = [...conversations.items].sort((a, b) =>
    a.conversation_id < b.conversation_id
      ? -1
      : a.conversation_id > b.conversation_id
        ? 1
        : 0,
  );
  const resumable = conversations.complete;
  // An id no longer in the list means the conversation was deleted since the
  // last run; starting the space over is safe for the same reason as a space.
  const startAt =
    resumable && resumeConversationId
      ? Math.max(
          ordered.findIndex((c) => c.conversation_id === resumeConversationId),
          0,
        )
      : 0;
  return { ordered, startAt, resumable };
}

/**
 * Remembers the FIRST thing a walk did not finish.
 *
 * Both loops in this file need the same rule and get it wrong the same way
 * without it: a unit that fails in isolation is walked past deliberately, so
 * the unit the budget finally stops on is not necessarily the earliest one
 * still owed. Resuming at the later one silently abandons the earlier, and the
 * sweep that eventually completes moves the watermark over it.
 */
class FirstUnfinished<T> {
  private value: T | null = null;

  note(candidate: T): void {
    this.value ??= candidate;
  }

  /** The earliest unfinished unit, or `fallback` when nothing failed yet. */
  resolve(fallback: T): T {
    return this.value ?? fallback;
  }
}

/**
 * The result for a sweep that stopped early, owing the given space.
 *
 * The resume point is dropped when the space listing was not resumable, which
 * restarts the sweep from the top rather than resuming into a position that was
 * never trustworthy.
 */
function sweptUpTo({
  events,
  resume,
  plan,
}: {
  events: NormalizedPullEvent[];
  resume: { space: z.infer<typeof spaceSchema>; at: string | null };
  plan: { resumable: boolean };
}): SweepResult {
  return {
    events,
    complete: false,
    resumeSpaceId: plan.resumable ? resume.space.space_id : null,
    resumeConversationId: plan.resumable ? resume.at : null,
  };
}

/**
 * The result for a space walk that stopped early on a given conversation.
 *
 * The resume point is dropped when the plan says the space is not resumable
 * (a truncated listing), which turns the next run into a clean restart of the
 * space rather than a resume into a position that was never trustworthy.
 */
function stoppedAt({
  items,
  conversation,
  plan,
}: {
  items: NormalizedPullEvent[];
  conversation: z.infer<typeof conversationSchema>;
  plan: { resumable: boolean };
}): SpaceRead {
  return {
    items,
    complete: false,
    resumeConversationId: plan.resumable ? conversation.conversation_id : null,
  };
}

/** What one space's walk read, and where to pick it up if it was cut short. */
interface SpaceRead {
  items: NormalizedPullEvent[];
  complete: boolean;
  /**
   * The conversation to restart this space at, or null for "from the top".
   *
   * Null does not mean "finished" — read it together with `complete`. A space
   * whose conversation LISTING was itself cut short reports `complete: false`
   * with a null resume point, because a partial list has no trustworthy
   * position in it to resume from.
   */
  resumeConversationId: string | null;
}

/**
 * A non-2xx from the workspace, carrying the status.
 *
 * The status is on the error rather than only in its message because one
 * caller has to branch on it: a 404 from SCIM is a permanent answer worth
 * caching, and every other code is a transient one that must not be.
 */
class GenieHttpError extends Error {
  readonly status: number;

  constructor({
    status,
    statusText,
    path,
  }: {
    status: number;
    statusText: string;
    path: string;
  }) {
    super(`HTTP ${status} ${statusText} (databricks genie ${path})`);
    this.name = "GenieHttpError";
    this.status = status;
  }
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
    // Stamped BEFORE the first request when a FRESH sweep begins, and carried
    // unchanged through every run that resumes it. The next watermark is
    // derived from this instant, so anything created while the sweep is
    // running lands after it and is caught next time.
    //
    // Resuming is the case that matters: `spaceId` means a sweep is already in
    // flight, and re-stamping here would anchor the finished sweep to its LAST
    // run instead of its first, silently dropping everything asked in an
    // already-swept space in between. Reading the clock at the end of the run
    // would be the same bug, one step worse.
    const resuming =
      cursor.spaceId !== null && cursor.sweepStartedAtMs !== null;
    const sweepStartedAtMs = resuming ? cursor.sweepStartedAtMs! : Date.now();

    let sweep: SweepResult;
    try {
      sweep = await this.sweep({ config, token, options, budget, cursor });
    } catch (error) {
      // Only a failure to enumerate spaces reaches here — everything below it
      // is isolated. With no space list there is nothing to have read, so the
      // cursor stays put and the run is reported as failed.
      logger.error(
        {
          adapter: this.id,
          workspaceUrl: config.workspaceUrl,
          error: error instanceof Error ? error.message : String(error),
        },
        "databricks genie could not enumerate spaces; leaving the cursor where it was",
      );
      return { events: [], cursor: options.cursor, errorCount: 1 };
    }

    return {
      events: sweep.events,
      cursor: encode({
        sinceMs: nextWatermark({
          previousMs: cursor.sinceMs,
          sweepStartedAtMs,
          complete: sweep.complete,
        }),
        spaceId: sweep.resumeSpaceId,
        // Meaningless without a space to resume into, so it is cleared with it
        // rather than left behind to be matched against some later sweep's
        // space by accident.
        conversationId:
          sweep.resumeSpaceId === null ? null : sweep.resumeConversationId,
        // Held only while the sweep is still in flight. Cleared the moment it
        // stops resuming, so the next run stamps a fresh anchor rather than
        // inheriting a stale one and re-reading from it forever.
        sweepStartedAtMs:
          sweep.resumeSpaceId === null ? null : sweepStartedAtMs,
      }),
      errorCount: 0,
    };
  }

  /**
   * Walks spaces → conversations → messages, keeping everything it manages to
   * read and reporting whether it read all of it.
   *
   * Each space, and each conversation within it, is isolated. One space the
   * credential cannot see must not cost the workspace the other five: this API
   * has no partial-failure response, so a 403 on space four would otherwise
   * unwind the run and discard three spaces' worth of already-read messages,
   * forever, because the next run would hit the same 403 at the same point.
   *
   * A failure does still suppress the watermark, so nothing behind the broken
   * space is skipped — the cost of a permanently unreadable space is a sweep
   * that keeps re-reading the rest, which is loud and lossless rather than
   * quiet and lossy.
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

    const spaces = await this.resolveSpaces({ config, token, options, budget });
    let complete = spaces.complete;

    const plan = spaceWalkPlan({ spaces, resumeSpaceId: cursor.spaceId });

    // Where the next run picks up: the earliest space this sweep did not
    // finish, NOT the one the budget happened to stop on. They differ whenever
    // a space is walked past — one 403s in isolation and a later one runs out
    // of budget — and resuming at the later one abandons the earlier for the
    // rest of the sweep.
    const owed = new FirstUnfinished<{
      space: z.infer<typeof spaceSchema>;
      at: string | null;
    }>();

    for (let i = plan.startAt; i < plan.ordered.length; i += 1) {
      const space = plan.ordered[i]!;
      // Only the space the cursor actually stopped in inherits the conversation
      // resume point. Every space after it is taken from the top.
      const resumeConversationId =
        space.space_id === cursor.spaceId ? cursor.conversationId : null;

      if (budget.exhausted()) {
        // Everything read so far is kept and the watermark is held. The
        // conversation position is handed back rather than dropped, so a run
        // that ends before it could touch this space does not undo the progress
        // an earlier run already made inside it.
        return sweptUpTo({
          events,
          resume: owed.resolve({ space, at: resumeConversationId }),
          plan,
        });
      }

      const read = await this.spaceMessages({
        config,
        token,
        options,
        budget,
        space,
        sinceMs: cursor.sinceMs,
        identities,
        resumeConversationId,
      });
      events.push(...read.items);
      if (!read.complete) {
        complete = false;
        // `read.resumeConversationId` narrows a re-read of this space to the
        // conversation it stopped on, which is what lets a space bigger than one
        // run's whole budget finish across several runs. It is null for an
        // isolated failure, which correctly restarts the space from the top.
        owed.note({ space, at: read.resumeConversationId });
      }

      // Out of budget with something unfinished — stop, and resume at the
      // earliest space still owed rather than this one. An isolated failure
      // with budget left falls through and keeps going, so one unreadable
      // space cannot wedge the sweep before the rest of the workspace.
      if (!read.complete && budget.exhausted()) {
        return sweptUpTo({
          events,
          resume: owed.resolve({ space, at: read.resumeConversationId }),
          plan,
        });
      }
    }

    return {
      events,
      complete,
      resumeSpaceId: null,
      resumeConversationId: null,
    };
  }

  /**
   * Every new message across one space's conversations, resumable partway.
   *
   * The conversation list is walked in a DETERMINISTIC order this method
   * imposes itself — sorted by `conversation_id` — rather than in whatever
   * order the workspace happened to return it. That sort is what makes
   * `resumeConversationId` safe.
   *
   * Resuming means skipping every conversation before the resume point, and
   * that is only sound if a conversation cannot MOVE across it between runs.
   * Databricks documents no ordering guarantee for this endpoint, so without a
   * sort of our own a conversation that existed when the sweep began could sit
   * after the resume point on one run and before it on the next, get skipped
   * for the rest of the sweep, and then be filtered out for good once the
   * completed sweep advanced the watermark past its messages. Sorting on an
   * immutable key removes the dependency on the API's ordering entirely.
   *
   * A conversation CREATED while the sweep is in flight may still sort before
   * the resume point and be skipped — and that is fine, because every message
   * in it is necessarily newer than `sweepStartedAtMs`, which is where the
   * watermark lands. The next sweep picks it up.
   */
  private async spaceMessages({
    config,
    token,
    options,
    budget,
    space,
    sinceMs,
    identities,
    resumeConversationId,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: RunBudget;
    space: z.infer<typeof spaceSchema>;
    sinceMs: number;
    identities: Map<number, GenieIdentity>;
    resumeConversationId: string | null;
  }): Promise<SpaceRead> {
    const conversations = await this.listConversations({
      config,
      token,
      options,
      budget,
      space,
    });
    if (!conversations)
      return { items: [], complete: false, resumeConversationId: null };

    const plan = conversationWalkPlan({ conversations, resumeConversationId });
    const walked = await this.walkConversations({
      config,
      token,
      options,
      budget,
      space,
      sinceMs,
      identities,
      plan,
    });

    // A truncated LISTING keeps the space incomplete even when everything the
    // walk actually saw was read in full — there are pages of conversations it
    // never got to.
    return {
      ...walked,
      complete: walked.complete && conversations.complete,
    };
  }

  /**
   * Reads one space's conversations in the planned order, stopping when the
   * budget runs out.
   *
   * Stopping hands back the conversation to restart ON — not the one after it
   * — so a conversation whose message pages were cut partway is re-read rather
   * than half-skipped.
   */
  private async walkConversations({
    config,
    token,
    options,
    budget,
    space,
    sinceMs,
    identities,
    plan,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: RunBudget;
    space: z.infer<typeof spaceSchema>;
    sinceMs: number;
    identities: Map<number, GenieIdentity>;
    plan: ReturnType<typeof conversationWalkPlan>;
  }): Promise<SpaceRead> {
    const events: NormalizedPullEvent[] = [];
    let complete = true;
    // The earliest conversation this walk did not finish. Same argument as the
    // space loop one level up.
    const owed = new FirstUnfinished<z.infer<typeof conversationSchema>>();

    for (let i = plan.startAt; i < plan.ordered.length; i += 1) {
      const conversation = plan.ordered[i]!;
      if (budget.exhausted()) {
        return stoppedAt({
          items: events,
          conversation: owed.resolve(conversation),
          plan,
        });
      }

      const read = await this.isolate({
        what: "messages",
        context: {
          spaceId: space.space_id,
          conversationId: conversation.conversation_id,
        },
        run: () =>
          this.conversationMessages({
            config,
            token,
            options,
            budget,
            space,
            conversation,
            sinceMs,
            identities,
          }),
      });

      if (read) events.push(...read.items);
      // Null is an isolated failure on this one conversation; false means its
      // pages were cut short. Both leave the space incomplete.
      if (!read?.complete) {
        complete = false;
        owed.note(conversation);
      }

      // Out of budget with something unfinished — stop, and resume at the
      // earliest conversation still owed rather than this one. An isolated
      // failure with budget still left falls through and keeps going, so one
      // broken conversation cannot wedge the whole space.
      if (!read?.complete && budget.exhausted()) {
        return stoppedAt({
          items: events,
          conversation: owed.resolve(conversation),
          plan,
        });
      }
    }

    return { items: events, complete, resumeConversationId: null };
  }

  /**
   * Every conversation in one space, or null when the space could not be read.
   *
   * Isolated: a space the credential cannot see must not cost the workspace
   * the others, so the caller turns a null into `complete: false` rather than
   * letting the failure unwind the whole sweep.
   */
  private async listConversations({
    config,
    token,
    options,
    budget,
    space,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: RunBudget;
    space: z.infer<typeof spaceSchema>;
  }): Promise<PagedRead<z.infer<typeof conversationSchema>> | null> {
    return await this.isolate({
      what: "conversations",
      context: { spaceId: space.space_id },
      run: () =>
        this.paginate({
          config,
          token,
          options,
          budget,
          path: `/api/2.0/genie/spaces/${encodeURIComponent(space.space_id)}/conversations`,
          // Without this the endpoint answers with the CALLER'S OWN
          // conversations only, and a governance sweep would quietly report one
          // service account's activity as the workspace's.
          query: { include_all: "true" },
          parse: (body) => {
            const page = conversationsPageSchema.parse(body);
            return { items: page.conversations, next: page.next_page_token };
          },
        }),
    });
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
  }): Promise<PagedRead<z.infer<typeof spaceSchema>>> {
    if (config.spaceIds.length > 0) {
      // A pinned list still gets titles where they can be had. The title is
      // what a human reads on the governance screen — "ACME Revenue Analyst"
      // rather than `01f190cfd5c1…` — and a source that pinned its spaces
      // should not be the one that reads worse.
      //
      // Best-effort, and deliberately so: a credential permitted to read a
      // space's conversations but not to enumerate the workspace is a real
      // configuration, and it must keep working. A failed lookup costs the
      // label, never the records, so it neither fails the run nor marks the
      // sweep incomplete.
      const discovered = await this.isolate({
        what: "space titles",
        context: {},
        run: () => this.discoverSpaces({ config, token, options, budget }),
      });
      const titles = new Map(
        (discovered?.items ?? []).map((s) => [s.space_id, s.title]),
      );
      return {
        items: config.spaceIds.map((space_id) => ({
          space_id,
          title: titles.get(space_id) ?? null,
        })),
        complete: true,
      };
    }

    return await this.discoverSpaces({ config, token, options, budget });
  }

  /** Every Genie space the credential can enumerate. */
  private async discoverSpaces({
    config,
    token,
    options,
    budget,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: RunBudget;
  }): Promise<PagedRead<z.infer<typeof spaceSchema>>> {
    return await this.paginate({
      config,
      token,
      options,
      budget,
      path: "/api/2.0/genie/spaces",
      parse: (body) => {
        const page = spacesPageSchema.parse(body);
        return { items: page.spaces, next: page.next_page_token };
      },
    });
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
  }): Promise<PagedRead<NormalizedPullEvent>> {
    const messages = await this.paginate({
      config,
      token,
      options,
      budget,
      path: `/api/2.0/genie/spaces/${encodeURIComponent(space.space_id)}/conversations/${encodeURIComponent(conversation.conversation_id)}/messages`,
      parse: (body) => {
        const page = messagesPageSchema.parse(body);
        return { items: page.messages, next: page.next_page_token };
      },
    });

    const events: NormalizedPullEvent[] = [];
    for (const message of messages.items) {
      const createdMs = message.created_timestamp;
      // A message with no timestamp cannot be placed against the watermark, and
      // emitting it would either re-emit it on every future sweep or file it
      // under `now`. Skipping it loses one row; the alternatives corrupt the
      // window for every row after it.
      if (createdMs === null || !Number.isFinite(createdMs)) {
        logger.warn(
          { adapter: this.id, messageId: message.message_id },
          "genie message has no created_timestamp; skipping",
        );
        continue;
      }
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
    return { items: events, complete: messages.complete };
  }

  /**
   * Walks one paginated Databricks list endpoint to the end, or to the budget.
   *
   * `complete: false` says pages were left unread. It is NOT an error and the
   * items already read are returned — the caller's job is to make sure the
   * watermark does not step over what is missing.
   *
   * A `next_page_token` that has already been seen in this walk is refused
   * rather than followed. Databricks pages by opaque token, so a token that
   * revisits a page is a contract violation, and following it would spend the
   * run's whole request budget re-reading the same pages and then report "out
   * of budget" — indistinguishable, from the outside, from a workspace that is
   * merely large. Same shape as `has_more` with no token, same answer.
   *
   * The whole set is tracked, not just the previous token: A → B → A is a
   * cycle too, and a check against only the last one walks it forever.
   */
  private async paginate<T>({
    config,
    token,
    options,
    budget,
    path,
    query,
    parse,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: RunBudget;
    path: string;
    query?: Record<string, string>;
    parse: (body: unknown) => { items: T[]; next: string | null };
  }): Promise<PagedRead<T>> {
    const items: T[] = [];
    let page: string | null = null;
    const seen = new Set<string>();

    for (;;) {
      if (budget.exhausted()) return { items, complete: false };

      const parsed = parse(
        await this.get({
          config,
          token,
          options,
          budget,
          path,
          query: {
            ...(query ?? {}),
            page_size: String(PAGE_SIZE),
            ...(page ? { page_token: page } : {}),
          },
        }),
      );
      items.push(...parsed.items);

      if (parsed.next === null) return { items, complete: true };
      if (seen.has(parsed.next)) {
        throw new Error(
          `databricks genie ${path} returned a page_token it had already served; refusing to re-read pages in a cycle`,
        );
      }
      seen.add(parsed.next);
      page = parsed.next;
    }
  }

  /**
   * Runs one unit of the walk, answering null instead of throwing.
   *
   * This is where "keep what we read" is actually implemented. The caller turns
   * a null into `complete: false`, which holds the watermark, so a failure
   * costs freshness rather than data.
   */
  private async isolate<T>({
    what,
    context,
    run,
  }: {
    what: string;
    context: Record<string, string>;
    run: () => Promise<T>;
  }): Promise<T | null> {
    try {
      return await run();
    } catch (error) {
      logger.error(
        {
          adapter: this.id,
          ...context,
          error: error instanceof Error ? error.message : String(error),
        },
        `databricks genie could not read ${what}; keeping the rest of the sweep and holding the watermark`,
      );
      return null;
    }
  }

  /**
   * The person behind a numeric author id, cached for the run.
   *
   * Only a 404 is remembered. A missing user is a permanent answer — the
   * account is gone, and asking again once per message would turn one deleted
   * user into hundreds of wasted calls. Anything else (a 429, a 503, a socket
   * reset) is transient, and caching THAT would take one unlucky moment and
   * silently strip the author off every remaining message in the run.
   *
   * Either way the event still lands. An unattributed question is worth
   * recording, and a directory hiccup must not cost the workspace its
   * visibility.
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
      const identity = genieIdentityFromScimUser(user, userId);
      identities.set(userId, identity);
      return identity;
    } catch (error) {
      const gone = error instanceof GenieHttpError && error.status === 404;
      logger.warn(
        {
          adapter: this.id,
          userId,
          permanent: gone,
          error: error instanceof Error ? error.message : String(error),
        },
        "could not resolve a genie author through SCIM; recording the message unattributed",
      );
      // Only the permanent answer is remembered. A transient failure is left
      // uncached so the next message gets a fresh attempt.
      if (gone) identities.set(userId, UNKNOWN_IDENTITY);
      return UNKNOWN_IDENTITY;
    }
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
      // The login when the directory has one, the identity key otherwise. An
      // account with no `userName` still has an object id or a numeric id, and
      // an empty `actor` would drop it out of every actor-filtered SIEM view —
      // present-but-not-an-email beats absent.
      actor: identity.email || identity.key,
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
      throw new GenieHttpError({
        status: response.status,
        statusText: response.statusText,
        path,
      });
    }
    return await response.json();
  }
}

function encode(cursor: GenieCursor): string {
  return JSON.stringify(cursor);
}
