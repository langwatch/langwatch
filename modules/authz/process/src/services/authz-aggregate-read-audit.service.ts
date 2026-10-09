import type { EventingCommandSender } from "@langwatch/eventing";

import type { RecordAggregateReadCommandData } from "../eventing/authz-aggregate-read.events.ts";

/** One user's read of an aggregate: who, in which organization, of which aggregate. */
export type AggregateRead = Readonly<{
  actorUserId: string;
  organizationId: string;
  aggregateProjectId: string;
}>;

type AggregateReadSender = Pick<EventingCommandSender<RecordAggregateReadCommandData>, "send">;

/** ADR-177 decision 9: one audit row per actor and aggregate per five minutes. */
export const AGGREGATE_READ_AUDIT_WINDOW_MS = 5 * 60 * 1000;

/** Bound on remembered pairs; only caps memory, the window does the rest. */
const MAX_REMEMBERED_READS = 10_000;

/**
 * Records `lw.authz.aggregate_read` behind a per-process window: repeat and concurrent reads of a
 * pair send once; a failed send is passed on and not remembered. Governance's write is the guard
 * across processes.
 */
export class AuthzAggregateReadAuditService {
  static create({
    windowMs = AGGREGATE_READ_AUDIT_WINDOW_MS,
    now = Date.now,
  }: { windowMs?: number; now?: () => number } = {}): AuthzAggregateReadAuditService {
    return new AuthzAggregateReadAuditService(windowMs, now);
  }

  #sender: AggregateReadSender | undefined;
  /** Pair key to the time its window closes. */
  readonly #recorded = new Map<string, number>();
  readonly #inFlight = new Map<string, Promise<void>>();

  private constructor(
    private readonly windowMs: number,
    private readonly now: () => number,
  ) {}

  connect(sender: AggregateReadSender): void {
    this.#sender = sender;
  }

  async record(read: AggregateRead): Promise<void> {
    const key = `${read.actorUserId}\u0000${read.aggregateProjectId}`;
    const closesAt = this.#recorded.get(key);
    if (closesAt !== undefined) {
      if (this.now() < closesAt) return;
      this.#recorded.delete(key);
    }
    const pending = this.#inFlight.get(key);
    if (pending) return pending;

    const flight = this.send(read)
      .then(() => this.remember(key))
      .finally(() => this.#inFlight.delete(key));
    this.#inFlight.set(key, flight);
    return flight;
  }

  private async send(read: AggregateRead): Promise<void> {
    const sender = this.#sender;
    if (!sender) throw new Error("authz_aggregate_read is not registered in this process");
    await sender.send({ ...read, tenantId: read.organizationId, occurredAt: this.now() });
  }

  private remember(key: string): void {
    if (this.#recorded.size >= MAX_REMEMBERED_READS) {
      const oldest = this.#recorded.keys().next().value;
      if (oldest !== undefined) this.#recorded.delete(oldest);
    }
    this.#recorded.set(key, this.now() + this.windowMs);
  }
}
