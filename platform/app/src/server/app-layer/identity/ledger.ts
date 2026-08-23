/**
 * The identity ledger writer: the app's implementation of
 * `@langwatch/identity-server`'s IdentityLedger port, and the calling-path
 * dispatch ADR-101 §2 pins — envelope, the durable ClickHouse append landed
 * WAITED, the fold applied to the `Identifier` projection on the calling
 * path, and GroupQueue staging LAST and best-effort. Staging exists for the
 * convergence re-apply, and a failed staging is a metric, never a failed
 * ceremony. This is deliberately the reverse of the ledger's merged
 * revocation path (#7329): nothing between the caller and the durable fact
 * depends on Redis.
 *
 * Idempotency is what makes the redundancy safe, and the heads are what
 * make it cheap: the staged re-run runs the same guards against a
 * projection the calling path already folded, sees the fact it would state,
 * and emits nothing — no second event_log row (the store's dedupe is
 * read-side; a restated row is still a row written). Only when the
 * calling-path apply failed after the append is the projection behind, and
 * then the re-run restates the fact — same deterministic ids, same
 * idempotency keys, deduped on read — and the cursor-guarded fold repairs
 * the projection. Failing that, the aggregate's next event or replay does.
 *
 * Like the grants ledger (authz/ledger.ts), the pipeline handle is resolved
 * lazily off the App: better-auth constructs its adapter at module load,
 * before any App exists, and a bare script that never composes one must
 * still be able to import the runtime.
 */
import {
  ATTACH_IDENTIFIER_COMMAND_TYPE,
  DETACH_IDENTIFIER_COMMAND_TYPE,
  ERASE_USER_COMMAND_TYPE,
  type IdentityCommand,
  type IdentityCommandType,
  type IdentityFact,
  type IdentityFactInput,
  MARK_PRIMARY_COMMAND_TYPE,
  VERIFY_IDENTIFIER_COMMAND_TYPE,
} from "@langwatch/identity";
import type { IdentityLedger } from "@langwatch/identity-server";
import { createLogger } from "@langwatch/observability";
import { tryGetApp } from "~/server/app-layer/app";
import { createTenantId } from "~/server/event-sourcing";
import type { AggregateType } from "~/server/event-sourcing/domain/aggregateType";
import { identityEventsFor } from "~/server/event-sourcing/pipelines/identity/envelope";
import {
  type IdentityFoldState,
  IdentityStateFoldProjection,
} from "~/server/event-sourcing/pipelines/identity/projections/identityState.foldProjection";
import {
  IDENTITY_PIPELINE_NAME,
  USER_IDENTITY_AGGREGATE_TYPE,
} from "~/server/event-sourcing/pipelines/identity/schemas/constants";
import type { IdentityEvent } from "~/server/event-sourcing/pipelines/identity/schemas/events";
import type {
  StateProjectionStore,
  StoredProjection,
} from "~/server/event-sourcing/projections/stateProjection.types";
import type { EventStore } from "~/server/event-sourcing/stores/eventStore.types";
import { withinBudget } from "../_shared/within-budget";
import {
  identityCallingPathApplyDurationSeconds,
  identityCallingPathApplyFailuresTotal,
  identityStagingDroppedTotal,
} from "./metrics";

const logger = createLogger("langwatch:identity:ledger");

/** How long a ceremony waits for the App handle before the append gives up. */
const IDENTITY_APP_HANDLE_WAIT_MS = 5_000;

/**
 * The budget for the best-effort GroupQueue staging leg (D02 seam a). The
 * append and the calling-path apply have already landed when staging runs,
 * so the only thing a hung Redis could still cost is the CALLER's latency —
 * this bound is the ceiling on that. An overrun is a drop like any other:
 * metric + warn, the cursor-guarded fold converges later.
 */
export const IDENTITY_STAGING_TIMEOUT_MS = 2_000;

export type IdentityStagedSender = {
  send(data: unknown): Promise<unknown>;
};

const SENDER_NAME_BY_COMMAND: Record<IdentityCommandType, string> = {
  [ATTACH_IDENTIFIER_COMMAND_TYPE]: "attachIdentifier",
  [VERIFY_IDENTIFIER_COMMAND_TYPE]: "verifyIdentifier",
  [MARK_PRIMARY_COMMAND_TYPE]: "markPrimary",
  [DETACH_IDENTIFIER_COMMAND_TYPE]: "detachIdentifier",
  [ERASE_USER_COMMAND_TYPE]: "eraseUser",
};

async function resolveEventStore(): Promise<EventStore<IdentityEvent>> {
  const deadline = Date.now() + IDENTITY_APP_HANDLE_WAIT_MS;
  let app = tryGetApp();
  while (!app && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    app = tryGetApp();
  }
  const eventStore = app?.eventSourcing?.isEnabled
    ? app.eventSourcing.getEventStore<IdentityEvent>()
    : undefined;
  if (!eventStore) {
    // A plain Error on purpose (error doctrine): the caller cannot act on an
    // unavailable event stack, and the adapter degrades the ceremony to a
    // retryable failure with a trace id.
    throw new Error(
      "identity ledger cannot append: the event-sourcing stack is unavailable",
    );
  }
  return eventStore;
}

function resolveStagedSender(name: string): IdentityStagedSender | null {
  const app = tryGetApp();
  if (!app?.eventSourcing?.isEnabled) return null;
  try {
    const pipeline = app.eventSourcing.getPipeline(
      IDENTITY_PIPELINE_NAME as never,
    ) as unknown as { commands: Record<string, IdentityStagedSender> };
    return pipeline.commands[name] ?? null;
  } catch {
    return null;
  }
}

export interface IdentityLedgerWriterDeps {
  projectionStore: StateProjectionStore<IdentityFoldState>;
  /** Production resolves the App's event store lazily; tests hand one in. */
  eventStore?: () => Promise<EventStore<IdentityEvent>>;
  stagedSender?: (name: string) => IdentityStagedSender | null;
  /** The staging leg's budget; production uses IDENTITY_STAGING_TIMEOUT_MS. */
  stagingTimeoutMs?: number;
}

export class IdentityLedgerWriter implements IdentityLedger {
  private readonly projection: IdentityStateFoldProjection;
  private readonly projectionStore: StateProjectionStore<IdentityFoldState>;
  private readonly eventStore: () => Promise<EventStore<IdentityEvent>>;
  private readonly stagedSender: (name: string) => IdentityStagedSender | null;
  private readonly stagingTimeoutMs: number;

  constructor(deps: IdentityLedgerWriterDeps) {
    this.projectionStore = deps.projectionStore;
    this.projection = new IdentityStateFoldProjection({
      store: deps.projectionStore,
    });
    this.eventStore = deps.eventStore ?? resolveEventStore;
    this.stagedSender = deps.stagedSender ?? resolveStagedSender;
    this.stagingTimeoutMs =
      deps.stagingTimeoutMs ?? IDENTITY_STAGING_TIMEOUT_MS;
  }

  async commit({
    command,
    facts,
  }: {
    command: IdentityCommand;
    facts: IdentityFactInput[];
  }): Promise<IdentityFact[]> {
    const events = identityEventsFor({ command, facts });
    if (events.length === 0) return [];
    const { userId, tenantId } = command.data;

    // 1. The durable append, waited — the fact lands with no Redis between.
    const eventStore = await this.eventStore();
    await eventStore.storeEvents(
      events,
      { tenantId: createTenantId(tenantId) },
      USER_IDENTITY_AGGREGATE_TYPE as AggregateType,
    );

    // 2. The calling-path fold apply — read-your-writes for the ceremony.
    const applyTimer = identityCallingPathApplyDurationSeconds.startTimer();
    try {
      await this.applyOnCallingPath({ userId, tenantId, events });
    } catch (error) {
      identityCallingPathApplyFailuresTotal.inc();
      logger.warn(
        { userId, commandType: command.type, error },
        "calling-path apply failed after the durable append; the projection converges via staging or replay",
      );
    } finally {
      applyTimer();
    }

    // 3. Staging LAST, best-effort — the convergence re-apply. Bounded (D02
    // seam a): a hung Redis may cost the caller at most the staging budget,
    // never an unbounded wait, and an overrun is a drop like any error here.
    // A missing sender is NOT a Redis drop — it is a wiring defect, counted
    // under its own reason so the two cannot masquerade as one another.
    const senderName = SENDER_NAME_BY_COMMAND[command.type];
    const sender = this.stagedSender(senderName);
    if (!sender) {
      identityStagingDroppedTotal.inc({ reason: "sender_unavailable" });
      logger.error(
        { userId, commandType: command.type, senderName },
        "identity pipeline sender unavailable: staging skipped — a wiring defect, not a Redis drop",
      );
      return events;
    }
    try {
      await withinBudget({
        work: sender.send(command.data),
        timeoutMs: this.stagingTimeoutMs,
        onTimeout: () =>
          new Error(
            `identity staging exceeded its ${this.stagingTimeoutMs}ms budget; dropped`,
          ),
      });
    } catch (error) {
      identityStagingDroppedTotal.inc({ reason: "redis_drop" });
      logger.warn(
        { userId, commandType: command.type, error },
        "identity command staging dropped after the durable append; convergence deferred to the next event or replay",
      );
    }

    return events;
  }

  private async applyOnCallingPath({
    userId,
    tenantId,
    events,
  }: {
    userId: string;
    tenantId: string;
    events: IdentityEvent[];
  }): Promise<void> {
    // The same field the append leg keys on — the pipeline defines
    // tenantId = userId by design, and both legs must read the same source.
    const context = { aggregateId: userId, tenantId: createTenantId(tenantId) };
    const stored = await this.projectionStore.load(userId, context);

    let state = stored?.state ?? this.projection.init();
    let cursor = stored?.cursor ?? { acceptedAt: 0, eventId: "" };
    let occurredAt = stored?.occurredAt ?? 0;
    let advanced = false;

    for (const event of events) {
      // Cursor guard: an event the queue's fold already committed re-applies
      // as a no-op and must not rewind the cursor.
      if (
        event.createdAt < cursor.acceptedAt ||
        (event.createdAt === cursor.acceptedAt && event.id <= cursor.eventId)
      ) {
        continue;
      }
      state = this.projection.apply(state, event);
      cursor = { acceptedAt: event.createdAt, eventId: event.id };
      occurredAt = Math.max(occurredAt, event.occurredAt);
      advanced = true;
    }
    if (!advanced) return;

    const now = Date.now();
    const projection: StoredProjection<IdentityFoldState> = {
      state,
      cursor,
      occurredAt,
      createdAt: stored?.createdAt ?? now,
      updatedAt: now,
      version: this.projection.version,
    };
    await this.projectionStore.store(projection, context);
  }
}
