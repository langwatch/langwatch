import { createLogger } from "@langwatch/observability";

import type {
  IntentContext,
  IntentExecutor,
} from "~/server/event-sourcing/pipeline/processManagerDefinition";
import { isDispatchError } from "~/server/event-sourcing/queues/dispatchError";
import {
  incrementIngestionPullTotal,
  observeIngestionPullDuration,
} from "~/server/metrics";

import { LISTING_FAILED_REASON } from "../schemas/constants";
import type {
  IngestionPullListingIntent,
  IngestionPullRunIntent,
} from "./ingestionPullProcess.types";

const logger = createLogger("langwatch:governance:ingestion-pull-effects");

export const INGESTION_PULL_MAX_ATTEMPTS = 3;

/**
 * The lease must outlive the slowest healthy pull, or a second dispatcher
 * re-leases the row mid-flight and runs the same window concurrently.
 */
export const INGESTION_PULL_LEASE_DURATION_MS = 10 * 60 * 1000;

/**
 * Leased per drain AND dispatched concurrently (the pipeline declares both):
 * pulls for distinct sources are independent, and bounding the lease batch
 * to the same number keeps leased-but-waiting messages from sitting
 * invisible behind a slow provider for the whole lease.
 */
export const INGESTION_PULL_CONCURRENCY = 4;

export interface IngestionPullRunPort {
  run(params: { sourceId: string; cursor: string | null }): Promise<{
    nextCursor: string | null;
    eventCount: number;
    /**
     * Input the run could not read while still advancing past it. Required
     * rather than optional so a partial success cannot reach the durable
     * completion as a clean one by a port simply omitting the field.
     */
    errorCount: number;
    /**
     * Whether the run reached the end of what it set out to read, and the
     * instant it read through to.
     *
     * Optional so a port that has not been taught to report cannot be forced
     * to invent an answer — and absent stays absent all the way to the
     * source row, where it reads as unknown rather than as either answer.
     */
    completeness?: "complete" | "truncated";
    readThroughAt?: number | null;
  }>;
}

/**
 * One on-demand agent listing for one source.
 *
 * Takes only the source id, like `IngestionPullRunPort.run`: the adapter
 * resolves the organization and the credential, so tenancy stays out of the
 * process state and out of the intent payload.
 *
 * `listed` and `empty` collapse into one arm here on purpose. A refusal is
 * its own arm and can never carry a count, so `agentCount: 0` on this side
 * means the provider answered and named none, and cannot mean anything else.
 */
export interface AgentListingPort {
  list(params: {
    sourceId: string;
  }): Promise<
    | { outcome: "listed"; agentCount: number }
    | { outcome: "refused"; reason: string; status: number | null }
  >;
}

/**
 * The same contract for people. A separate interface rather than a shared one
 * with a renamed count, because these are the two ports the composition root
 * wires and each names what it returns: a reader of `pipelineSet.ts` should
 * not have to check which list a `count` belongs to.
 */
export interface PeopleListingPort {
  list(params: { sourceId: string }): Promise<
    | {
        outcome: "listed";
        /** Everyone the provider's directory named. A fact about the provider. */
        directoryPersonCount: number;
        /**
         * How many of the people named above this deployment does not hold,
         * because erasure suppression removed them. A fact about our own
         * obligations, not about the provider.
         *
         * A SUBSET of `directoryPersonCount`, never an addition to it. Adding
         * the two counts the same people twice. Subtracting is the valid
         * arithmetic. Safe to show as a CURRENT figure, never as a series:
         * see the field doc on the event schema for why.
         */
        withheldPersonCount: number;
      }
    | { outcome: "refused"; reason: string; status: number | null }
  >;
}

/** The pipeline commands the effect reports its outcome through. */
export interface IngestionPullOutcomeCommands {
  recordRunCompleted(args: {
    tenantId: string;
    occurredAt: number;
    sourceId: string;
    runId: string;
    scheduledFor: number;
    nextCursor: string | null;
    eventCount: number;
    errorCount: number;
    completeness?: "complete" | "truncated";
    readThroughAt?: number | null;
  }): Promise<void>;
  recordRunFailed(args: {
    tenantId: string;
    occurredAt: number;
    sourceId: string;
    runId: string;
    scheduledFor: number;
    error: string;
    errorCode: string;
    retryable: boolean;
    /**
     * How long the provider asked to be left alone, when it said so. Optional
     * because most failures are not a provider asking for silence, and null is
     * reserved for one that refused without naming a wait.
     */
    retryAfterMs?: number | null;
    /** The run that took this one's place, on an abandonment only. */
    replacedByRunId?: string;
  }): Promise<void>;
  recordAgentsListed(args: {
    tenantId: string;
    occurredAt: number;
    sourceId: string;
    requestId: string;
    requestedAt: number;
    agentCount: number;
  }): Promise<void>;
  recordPeopleListed(args: {
    tenantId: string;
    occurredAt: number;
    sourceId: string;
    requestId: string;
    requestedAt: number;
    directoryPersonCount: number;
    withheldPersonCount: number;
  }): Promise<void>;
  recordPeopleListingRefused(args: {
    tenantId: string;
    occurredAt: number;
    sourceId: string;
    requestId: string;
    requestedAt: number;
    reason: string;
    status: number | null;
  }): Promise<void>;
  recordAgentsListingRefused(args: {
    tenantId: string;
    occurredAt: number;
    sourceId: string;
    requestId: string;
    requestedAt: number;
    reason: string;
    status: number | null;
  }): Promise<void>;
}

export interface IngestionPullDispatchDeps {
  runPort: IngestionPullRunPort;
  agentListingPort: AgentListingPort;
  peopleListingPort: PeopleListingPort;
  /**
   * Late-bound on purpose: the executor is declared while the pipeline is
   * being built, and these are the SAME pipeline's commands — they only
   * exist after `.build()`. The composition root supplies a getter it
   * resolves post-build; dispatch happens long after that.
   */
  commands: () => IngestionPullOutcomeCommands;
  maxAttempts?: number;
  clock?: () => number;
}

/**
 * The `run` intent executor: one pull attempt per dispatch, from the durable
 * cursor the intent carries.
 *
 * At-least-once + idempotent: a redelivered intent re-pulls from the same
 * durable cursor, and the outcome commands carry deterministic idempotency
 * keys, so it cannot double-record.
 */
/**
 * The wait a provider named, read off the error a puller threw.
 *
 * By shape rather than by class, and deliberately so: the outbox reads the
 * same property the same way to space out its own attempts, and the pullers
 * throw an ordinary error carrying it. Requiring a particular error type here
 * would mean a puller can space out its retries and still lose the wait on the
 * way to the connection, which is the exact loss this fixes.
 *
 * Returns null, never undefined, for an error that named nothing: the schema
 * distinguishes a refusal with no wait from a failure written before waits
 * were recorded, and only this path can say which this is.
 */
function providerRetryAfterMs(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const named = Reflect.get(error, "retryAfterMs");
  return typeof named === "number" && Number.isFinite(named) && named > 0
    ? named
    : null;
}

/**
 * Records that this run took over from one that outlived its allowance, when
 * it did, and does nothing when it did not.
 *
 * Runs BEFORE the provider is asked anything: the replaced run ended the
 * moment this one was minted, and until that is written the history shows a
 * run that started and no run that ended, which reads on every screen as a
 * source still working.
 *
 * On EVERY delivery, not only the first. The command's idempotency key is
 * built from the abandoned run, so a redelivery settles onto the write that
 * already happened and costs one deduplicated call. Skipping later attempts
 * saved that call and paid for it with the case that matters: if this write is
 * the thing that failed, the outbox redelivers at a higher attempt and a
 * first-attempt-only guard would never write the abandonment at all, leaving
 * the replaced run open forever.
 */
async function recordAbandonmentIfReplacing({
  commands,
  payload,
  intentContext,
  occurredAt,
}: {
  commands: IngestionPullOutcomeCommands;
  payload: IngestionPullRunIntent;
  intentContext: IntentContext;
  occurredAt: number;
}): Promise<void> {
  if (payload.abandonedRunId === undefined) return;
  await commands.recordRunFailed({
    tenantId: intentContext.projectId,
    occurredAt,
    sourceId: payload.sourceId,
    runId: payload.abandonedRunId,
    scheduledFor: payload.scheduledFor,
    error: `Run abandoned after exceeding its allowed duration; replaced by run ${payload.runId}.`,
    errorCode: "run_abandoned",
    // Nothing will retry the abandoned run — this run IS the retry, from the
    // same durable cursor.
    retryable: false,
    replacedByRunId: payload.runId,
  });
}

export function createIngestionPullRunHandler(
  deps: IngestionPullDispatchDeps,
): IntentExecutor<IngestionPullRunIntent> {
  const maxAttempts = deps.maxAttempts ?? INGESTION_PULL_MAX_ATTEMPTS;
  const clock = deps.clock ?? (() => Date.now());

  return async (
    payload: IngestionPullRunIntent,
    intentContext: IntentContext,
  ) => {
    const commands = deps.commands();
    const pullStartedAtMs = clock();

    await recordAbandonmentIfReplacing({
      commands,
      payload,
      intentContext,
      occurredAt: clock(),
    });

    let result: Awaited<ReturnType<IngestionPullRunPort["run"]>>;
    try {
      result = await deps.runPort.run({
        sourceId: payload.sourceId,
        cursor: payload.cursor,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (isDispatchError(error) && error.retryable === false) {
        // The provider refused the source outright (a key it no longer
        // accepts, for one). Another attempt gets the same answer, and the
        // outbox retires a non-retryable error before the retry ladder
        // reaches the branch below that writes run_failed — so a refusal
        // that is rethrown is never recorded. Record it now, on this
        // attempt, and end the run. The source keeps its schedule: the next
        // wake starts a fresh run, which is what an admin who has since
        // replaced the key needs.
        incrementIngestionPullTotal({ outcome: "failed_final" });
        logger.warn(
          {
            sourceId: payload.sourceId,
            attempt: intentContext.attempt,
            error: detail,
          },
          "Ingestion pull refused by the provider; not retrying this run",
        );
        await commands.recordRunFailed({
          tenantId: intentContext.projectId,
          occurredAt: clock(),
          sourceId: payload.sourceId,
          runId: payload.runId,
          scheduledFor: payload.scheduledFor,
          // The customer sentence is the one the page may show as written;
          // the diagnostic message is the fallback and carries no reply body.
          error: error.customerMessage ?? detail,
          errorCode: "pull_refused",
          retryable: false,
          retryAfterMs: providerRetryAfterMs(error),
        });
        return;
      }
      if (intentContext.attempt < maxAttempts) {
        incrementIngestionPullTotal({ outcome: "failed_retryable" });
        logger.warn(
          {
            sourceId: payload.sourceId,
            attempt: intentContext.attempt,
            error: detail,
          },
          "Ingestion pull failed; retrying from durable cursor",
        );
        throw error;
      }
      // The alertable outcome (ADR-054): retries exhausted, run_failed
      // recorded. failed_retryable above is expected provider noise.
      incrementIngestionPullTotal({ outcome: "failed_final" });
      await commands.recordRunFailed({
        tenantId: intentContext.projectId,
        occurredAt: clock(),
        sourceId: payload.sourceId,
        runId: payload.runId,
        scheduledFor: payload.scheduledFor,
        error: detail,
        errorCode: "pull_failed",
        // Retries are exhausted — nothing will retry THIS run. The next
        // scheduled wake starts a fresh run from the durable cursor.
        retryable: false,
        // The wait leaves with the run rather than dying with it. Every
        // attempt of this run has now been refused, so the next wake is the
        // thing that must not walk back into the window the provider closed,
        // and it reads this off the connection.
        retryAfterMs: providerRetryAfterMs(error),
      });
      return;
    }
    incrementIngestionPullTotal({ outcome: "completed" });
    observeIngestionPullDuration({ durationMs: clock() - pullStartedAtMs });
    // Keep outcome-command failures distinct from provider failures. If this
    // write fails, the outbox redelivers the idempotent effect; it must not
    // turn a successful pull into a run_failed event on the final attempt.
    await commands.recordRunCompleted({
      tenantId: intentContext.projectId,
      occurredAt: clock(),
      sourceId: payload.sourceId,
      runId: payload.runId,
      scheduledFor: payload.scheduledFor,
      ...result,
    });
  };
}

/**
 * Rethrows a listing failure while attempts remain, and returns once they are
 * spent so the caller can record the outcome.
 *
 * Split out because the retry decision and the recording decision are two
 * different judgements: this one is about whether trying again could help.
 */
function retryOrGiveUp({
  error,
  intentContext,
  maxAttempts,
  payload,
  what,
}: {
  error: unknown;
  intentContext: IntentContext;
  maxAttempts: number;
  payload: IngestionPullListingIntent;
  /** Names the list in the log line, so a search can tell the two apart. */
  what: string;
}): void {
  // `errorType` is the constructor-set `name`, which is stable enough to alert
  // and group on without depending on message text. The message is kept
  // alongside it because this is an operator log and the detail is the whole
  // point of the line: the durable event carries a reason code and nothing
  // else, so dropping the message here would leave the terminal failure with
  // no explanation anywhere. That boundary -- message to the log, reason to
  // the event -- is the same one the run handler above draws.
  const context = {
    sourceId: payload.sourceId,
    requestId: payload.requestId,
    attempt: intentContext.attempt,
    errorType: error instanceof Error ? error.name : typeof error,
    error: error instanceof Error ? error.message : String(error),
  };

  // Attempts are spent. The durable event deliberately carries a reason and no
  // message, because a provider's reply can quote a token or a person's name
  // and that event is read by a screen. The log is therefore the only place the
  // detail survives, so the terminal attempt has to write one: returning here
  // silently left the one failure that actually needs explaining with nothing
  // recorded anywhere.
  if (intentContext.attempt >= maxAttempts) {
    logger.warn(context, `${what} listing failed; attempts spent`);
    return;
  }

  logger.warn(context, `${what} listing failed; retrying`);
  throw error;
}

/**
 * `Counts` is whatever the listed arm of one entity's port reports, passed
 * through untouched. It is generic because the two entities do not count the
 * same way: an agent listing has one number, and a people listing has two,
 * since what the provider named and what this deployment stored differ by the
 * erasure check. Flattening both to a single `count` is what made the people
 * event lossy in the first place.
 */
type ListingOutcome<Counts> =
  | { outcome: "listed"; counts: Counts }
  | { outcome: "refused"; reason: string; status: number | null };

interface ListingOutcomeEnvelope {
  tenantId: string;
  occurredAt: number;
  sourceId: string;
  requestId: string;
  requestedAt: number;
}

/**
 * One listing per dispatch, whichever list was asked for.
 *
 * ONE body for agents and people, because the judgement it encodes is the same
 * one and it is the subtle part: a provider that refuses is NOT a failed
 * effect, so it records and returns without retrying, while our own side
 * giving out retries and only then becomes a `listing_failed` refusal. Two
 * copies of that would be two chances to get the distinction wrong, and the
 * one that drifted would quietly retry a provider that already said no.
 *
 * At-least-once + idempotent, like the pull. A redelivered intent re-lists and
 * re-records the same sightings, which the sighting repositories absorb, and
 * the outcome commands carry deterministic idempotency keys, so a redelivery
 * cannot write a second outcome event for one request.
 */
function createListingHandler<Counts>(
  deps: IngestionPullDispatchDeps,
  listing: {
    what: string;
    list: (sourceId: string) => Promise<ListingOutcome<Counts>>;
    recordListed: (
      commands: IngestionPullOutcomeCommands,
      args: ListingOutcomeEnvelope & Counts,
    ) => Promise<void>;
    recordRefused: (
      commands: IngestionPullOutcomeCommands,
      args: ListingOutcomeEnvelope & {
        reason: string;
        status: number | null;
      },
    ) => Promise<void>;
  },
): IntentExecutor<IngestionPullListingIntent> {
  const maxAttempts = deps.maxAttempts ?? INGESTION_PULL_MAX_ATTEMPTS;
  const clock = deps.clock ?? (() => Date.now());

  return async (
    payload: IngestionPullListingIntent,
    intentContext: IntentContext,
  ) => {
    const commands = deps.commands();
    const outcomeEnvelope = {
      tenantId: intentContext.projectId,
      sourceId: payload.sourceId,
      requestId: payload.requestId,
      requestedAt: payload.requestedAt,
    };

    let result: ListingOutcome<Counts>;
    try {
      result = await listing.list(payload.sourceId);
    } catch (error) {
      // Rethrows below the cap so the outbox retries; at the cap it records
      // the one refusal that means "we could not ask" and returns.
      retryOrGiveUp({
        error,
        intentContext,
        maxAttempts,
        payload,
        what: listing.what,
      });
      // The message stayed in the log line and out of the event: a thrown
      // provider error can carry a response body, and this event is read by
      // an admin. The reason code is enough to act on.
      await listing.recordRefused(commands, {
        ...outcomeEnvelope,
        occurredAt: clock(),
        reason: LISTING_FAILED_REASON,
        status: null,
      });
      return;
    }

    if (result.outcome === "refused") {
      await listing.recordRefused(commands, {
        ...outcomeEnvelope,
        occurredAt: clock(),
        reason: result.reason,
        status: result.status,
      });
      return;
    }

    await listing.recordListed(commands, {
      ...outcomeEnvelope,
      occurredAt: clock(),
      ...result.counts,
    });
  };
}

/**
 * The `listAgents` intent executor.
 *
 * Three outcomes reach the log, not two. A provider that refuses is not a
 * failed effect: the listing did its job and found out the answer is no.
 */
export function createAgentListingHandler(
  deps: IngestionPullDispatchDeps,
): IntentExecutor<IngestionPullListingIntent> {
  return createListingHandler<{ agentCount: number }>(deps, {
    what: "Agent",
    list: async (sourceId) => {
      const result = await deps.agentListingPort.list({ sourceId });
      return result.outcome === "refused"
        ? result
        : { outcome: "listed", counts: { agentCount: result.agentCount } };
    },
    recordListed: (commands, args) => commands.recordAgentsListed(args),
    recordRefused: (commands, args) =>
      commands.recordAgentsListingRefused(args),
  });
}

/**
 * The `listPeople` intent executor.
 *
 * Two counts reach the event, not one. What the provider named and what this
 * deployment stored differ by the erasure suppression the service applies
 * before writing, and recording only the survivors would destroy the
 * provider's number at write time: a tenant that erased its whole staff would
 * be indistinguishable from a provider that named nobody.
 */
export function createPeopleListingHandler(
  deps: IngestionPullDispatchDeps,
): IntentExecutor<IngestionPullListingIntent> {
  return createListingHandler<{
    directoryPersonCount: number;
    withheldPersonCount: number;
  }>(deps, {
    what: "People",
    list: async (sourceId) => {
      const result = await deps.peopleListingPort.list({ sourceId });
      return result.outcome === "refused"
        ? result
        : {
            outcome: "listed",
            counts: {
              directoryPersonCount: result.directoryPersonCount,
              withheldPersonCount: result.withheldPersonCount,
            },
          };
    },
    recordListed: (commands, args) => commands.recordPeopleListed(args),
    recordRefused: (commands, args) =>
      commands.recordPeopleListingRefused(args),
  });
}
