/**
 * The identity pipeline's calling-path dispatch (ADR-101 §2, the pinned
 * order): guards veto first, the durable ClickHouse append lands WAITED,
 * the fold applies to the `Identifier` projection on the calling path, and
 * GroupQueue staging runs LAST and best-effort — staging exists for the
 * convergence re-apply, and a failed staging is a metric, never a failed
 * ceremony. This is deliberately the reverse of the ledger's merged
 * revocation path (#7329): nothing between the caller and the durable fact
 * depends on Redis.
 *
 * Idempotency is what makes the redundancy safe: the staged re-run of the
 * same command re-derives the same deterministic ids and idempotency keys
 * (the event store dedupes), and the cursor-guarded fold re-applies as a
 * no-op. A calling-path apply that fails after the append leaves the fact
 * durable; staging, the aggregate's next event, or replay repairs the
 * projection.
 */

import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import type { ZodType } from "zod";
import type { PrismaClient } from "~/generated/prisma/client";
import { tryGetApp } from "~/server/app-layer/app";
import { createTenantId } from "~/server/event-sourcing";
import type {
  Command,
  CommandHandler,
} from "~/server/event-sourcing/commands/command";
import type { AggregateType } from "~/server/event-sourcing/domain/aggregateType";
import {
  AttachIdentifierCommand,
  DetachIdentifierCommand,
  EraseUserCommand,
  type IdentityGuardReads,
  MarkPrimaryCommand,
  VerifyIdentifierCommand,
} from "~/server/event-sourcing/pipelines/identity/commands/identityCommands";
import type { IdentityFoldState } from "~/server/event-sourcing/pipelines/identity/projections/identityState.foldProjection";
import { IdentityStateFoldProjection } from "~/server/event-sourcing/pipelines/identity/projections/identityState.foldProjection";
import {
  type AttachIdentifierCommandData,
  attachIdentifierCommandDataSchema,
  type DetachIdentifierCommandData,
  detachIdentifierCommandDataSchema,
  type EraseUserCommandData,
  eraseUserCommandDataSchema,
  type MarkPrimaryCommandData,
  markPrimaryCommandDataSchema,
  type VerifyIdentifierCommandData,
  verifyIdentifierCommandDataSchema,
} from "~/server/event-sourcing/pipelines/identity/schemas/commands";
import {
  ATTACH_IDENTIFIER_COMMAND_TYPE,
  DETACH_IDENTIFIER_COMMAND_TYPE,
  ERASE_USER_COMMAND_TYPE,
  IDENTITY_PIPELINE_NAME,
  MARK_PRIMARY_COMMAND_TYPE,
  USER_IDENTITY_AGGREGATE_TYPE,
  VERIFY_IDENTIFIER_COMMAND_TYPE,
} from "~/server/event-sourcing/pipelines/identity/schemas/constants";
import type { IdentityEvent } from "~/server/event-sourcing/pipelines/identity/schemas/events";
import type {
  StateProjectionStore,
  StoredProjection,
} from "~/server/event-sourcing/projections/stateProjection.types";
import type { EventStore } from "~/server/event-sourcing/stores/eventStore.types";
import { prisma as appPrisma } from "../../db";
import {
  identityCallingPathApplyDurationSeconds,
  identityCallingPathApplyFailuresTotal,
  identityStagingDroppedTotal,
} from "./metrics";
import { PrismaIdentityGuardReads } from "./repositories/identity-guard-reads.prisma.repository";
import { PrismaIdentityProjectionRepository } from "./repositories/identity-projection.prisma.repository";

const logger = createLogger("langwatch:identity:ceremonies");

export const IDENTITY_APP_HANDLE_WAIT_MS = 5_000;

/**
 * The budget for the best-effort GroupQueue staging leg (D02 seam a). The
 * append and the calling-path apply have already landed when staging runs,
 * so the only thing a hung Redis could still cost is the CALLER's latency —
 * this bound is the ceiling on that. An overrun is a drop like any other:
 * metric + warn, the cursor-guarded fold converges later.
 */
export const IDENTITY_STAGING_TIMEOUT_MS = 2_000;

function stagingWithinBudget(
  work: Promise<unknown>,
  timeoutMs: number,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            `identity staging exceeded its ${timeoutMs}ms budget; dropped`,
          ),
        ),
      timeoutMs,
    );
    timer.unref?.();
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error as Error);
      },
    );
  });
}

/** Ceremony paths mint a random command id; retries reuse it. */
export function newIdentityCommandId(): string {
  return generate("idcmd").toString();
}

async function resolveEventStore(options?: {
  waitMs?: number;
}): Promise<EventStore<IdentityEvent>> {
  const waitMs = options?.waitMs ?? IDENTITY_APP_HANDLE_WAIT_MS;
  const deadline = Date.now() + waitMs;
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
      "identity ceremonies cannot append: the event-sourcing stack is unavailable",
    );
  }
  return eventStore;
}

type StagedSender = {
  send(data: unknown): Promise<unknown>;
};

function resolveStagedSender(name: string): StagedSender | null {
  const app = tryGetApp();
  if (!app?.eventSourcing?.isEnabled) return null;
  try {
    const pipeline = app.eventSourcing.getPipeline(
      IDENTITY_PIPELINE_NAME as never,
    ) as unknown as { commands: Record<string, StagedSender> };
    return pipeline.commands[name] ?? null;
  } catch {
    return null;
  }
}

export interface IdentityCeremoniesDeps {
  prisma?: PrismaClient;
  guardReads?: IdentityGuardReads;
  projectionStore?: StateProjectionStore<IdentityFoldState>;
  eventStore?: () => Promise<EventStore<IdentityEvent>>;
  stagedSender?: (name: string) => StagedSender | null;
  /** The staging leg's budget; production uses IDENTITY_STAGING_TIMEOUT_MS. */
  stagingTimeoutMs?: number;
}

interface CeremonyVerb<Data> {
  schema: ZodType<Data>;
  commandType: string;
  senderName: string;
  handler: CommandHandler<Command<Data>, IdentityEvent>;
}

export class IdentityCeremonies {
  private readonly projection: IdentityStateFoldProjection;
  private readonly projectionStore: StateProjectionStore<IdentityFoldState>;
  private readonly eventStore: () => Promise<EventStore<IdentityEvent>>;
  private readonly stagedSender: (name: string) => StagedSender | null;
  private readonly stagingTimeoutMs: number;
  private readonly verbs: {
    attachIdentifier: CeremonyVerb<AttachIdentifierCommandData>;
    verifyIdentifier: CeremonyVerb<VerifyIdentifierCommandData>;
    markPrimary: CeremonyVerb<MarkPrimaryCommandData>;
    detachIdentifier: CeremonyVerb<DetachIdentifierCommandData>;
    eraseUser: CeremonyVerb<EraseUserCommandData>;
  };

  constructor(deps: IdentityCeremoniesDeps = {}) {
    const prisma = deps.prisma ?? appPrisma;
    const guardReads = deps.guardReads ?? new PrismaIdentityGuardReads(prisma);
    this.projectionStore =
      deps.projectionStore ?? new PrismaIdentityProjectionRepository(prisma);
    this.projection = new IdentityStateFoldProjection({
      store: this.projectionStore,
    });
    this.eventStore = deps.eventStore ?? resolveEventStore;
    this.stagedSender = deps.stagedSender ?? resolveStagedSender;
    this.stagingTimeoutMs =
      deps.stagingTimeoutMs ?? IDENTITY_STAGING_TIMEOUT_MS;
    this.verbs = {
      attachIdentifier: {
        schema:
          attachIdentifierCommandDataSchema as ZodType<AttachIdentifierCommandData>,
        commandType: ATTACH_IDENTIFIER_COMMAND_TYPE,
        senderName: "attachIdentifier",
        handler: new AttachIdentifierCommand(guardReads),
      },
      verifyIdentifier: {
        schema:
          verifyIdentifierCommandDataSchema as ZodType<VerifyIdentifierCommandData>,
        commandType: VERIFY_IDENTIFIER_COMMAND_TYPE,
        senderName: "verifyIdentifier",
        handler: new VerifyIdentifierCommand(guardReads),
      },
      markPrimary: {
        schema: markPrimaryCommandDataSchema as ZodType<MarkPrimaryCommandData>,
        commandType: MARK_PRIMARY_COMMAND_TYPE,
        senderName: "markPrimary",
        handler: new MarkPrimaryCommand(guardReads),
      },
      detachIdentifier: {
        schema:
          detachIdentifierCommandDataSchema as ZodType<DetachIdentifierCommandData>,
        commandType: DETACH_IDENTIFIER_COMMAND_TYPE,
        senderName: "detachIdentifier",
        handler: new DetachIdentifierCommand(guardReads),
      },
      eraseUser: {
        schema: eraseUserCommandDataSchema as ZodType<EraseUserCommandData>,
        commandType: ERASE_USER_COMMAND_TYPE,
        senderName: "eraseUser",
        handler: new EraseUserCommand(guardReads),
      },
    };
  }

  attachIdentifier(data: AttachIdentifierCommandData) {
    return this.dispatch(this.verbs.attachIdentifier, data);
  }

  verifyIdentifier(data: VerifyIdentifierCommandData) {
    return this.dispatch(this.verbs.verifyIdentifier, data);
  }

  markPrimary(data: MarkPrimaryCommandData) {
    return this.dispatch(this.verbs.markPrimary, data);
  }

  detachIdentifier(data: DetachIdentifierCommandData) {
    return this.dispatch(this.verbs.detachIdentifier, data);
  }

  eraseUser(data: EraseUserCommandData) {
    return this.dispatch(this.verbs.eraseUser, data);
  }

  private async dispatch<Data extends { userId: string; tenantId: string }>(
    verb: CeremonyVerb<Data>,
    rawData: Data,
  ): Promise<IdentityEvent[]> {
    const data = verb.schema.parse(rawData);
    const command = {
      tenantId: createTenantId(data.tenantId),
      aggregateId: data.userId,
      type: verb.commandType,
      data,
    } as Command<Data>;

    // 1. Guards veto before any row or event exists.
    const events = await verb.handler.handle(command);
    if (events.length === 0) return events;

    // 2. The durable append, waited — the fact lands with no Redis between.
    const eventStore = await this.eventStore();
    await eventStore.storeEvents(
      events,
      { tenantId: createTenantId(data.tenantId) },
      USER_IDENTITY_AGGREGATE_TYPE as AggregateType,
    );

    // 3. The calling-path fold apply — read-your-writes for the ceremony.
    const applyTimer = identityCallingPathApplyDurationSeconds.startTimer();
    try {
      await this.applyOnCallingPath({ userId: data.userId, events });
    } catch (error) {
      identityCallingPathApplyFailuresTotal.inc();
      logger.warn(
        { userId: data.userId, commandType: verb.commandType, error },
        "calling-path apply failed after the durable append; the projection converges via staging or replay",
      );
    } finally {
      applyTimer();
    }

    // 4. Staging LAST, best-effort — the convergence re-apply. Bounded (D02
    // seam a): a hung Redis may cost the caller at most the staging budget,
    // never an unbounded wait, and an overrun is a drop like any error here.
    try {
      const sender = this.stagedSender(verb.senderName);
      if (!sender) throw new Error("identity pipeline sender unavailable");
      await stagingWithinBudget(sender.send(data), this.stagingTimeoutMs);
    } catch (error) {
      identityStagingDroppedTotal.inc();
      logger.warn(
        { userId: data.userId, commandType: verb.commandType, error },
        "identity command staging dropped after the durable append; convergence deferred to the next event or replay",
      );
    }

    return events;
  }

  private async applyOnCallingPath({
    userId,
    events,
  }: {
    userId: string;
    events: IdentityEvent[];
  }): Promise<void> {
    const context = {
      aggregateId: userId,
      tenantId: createTenantId(userId),
    };
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
