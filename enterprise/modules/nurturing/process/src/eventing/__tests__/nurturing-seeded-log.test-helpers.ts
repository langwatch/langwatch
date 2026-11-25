// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  aggregateKey,
  type CutoffInfo,
  type OccurredAtBounds,
  type ReplayEvent,
  type ReplayEventSource,
} from "@langwatch/eventing";

type Discovered = Awaited<ReturnType<ReplayEventSource["discoverAffectedAggregates"]>>[number];
type Matching = { eventTypes: readonly string[]; sinceMs?: number; tenantId?: string };
type OfAggregates = { tenantId: string; aggregateIds: string[]; eventTypes: readonly string[] };

/**
 * The owners' logs as the replay engine reads them, listing the tenants holding a lane's events
 * (so tenants replay one at a time, sorted). `onDiscovered` runs after each discovery: a test
 * appends a fact there to land it after a pass's cursor.
 */
export class NurturingSeededLog implements ReplayEventSource {
  onDiscovered: () => void = () => undefined;
  constructor(readonly events: ReplayEvent[]) {}

  private matching({ eventTypes, sinceMs, tenantId }: Matching): ReplayEvent[] {
    return this.events.filter(
      (event) =>
        eventTypes.includes(event.type) &&
        (sinceMs === undefined || event.timestamp >= sinceMs) &&
        (tenantId === undefined || event.tenantId === tenantId),
    );
  }

  private ofAggregates(input: OfAggregates): ReplayEvent[] {
    return this.matching(input)
      .filter((event) => input.aggregateIds.includes(event.aggregateId))
      .toSorted((a, b) => a.timestamp - b.timestamp);
  }

  async discoverTenants(input: Matching): Promise<string[]> {
    return [...new Set(this.matching(input).map((event) => event.tenantId))].toSorted();
  }

  async discoverAffectedAggregates(input: Matching): Promise<Discovered[]> {
    const byKey = new Map<string, Discovered>();
    for (const event of this.matching(input)) {
      byKey.set(aggregateKey(event), {
        tenantId: event.tenantId,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        eventTypes: [event.type],
      });
    }
    this.onDiscovered();
    return [...byKey.values()];
  }

  async countEventsForAggregates(input: Matching): Promise<number> {
    return this.matching(input).length;
  }

  async getBoundedCutoffs(
    input: OfAggregates,
  ): Promise<{ cutoffs: Map<string, CutoffInfo>; occurredAtBounds: OccurredAtBounds | undefined }> {
    const cutoffs = new Map<string, CutoffInfo>();
    const selected = this.ofAggregates(input);
    for (const event of selected) {
      const current = cutoffs.get(aggregateKey(event));
      if (!current || event.timestamp > current.timestamp) {
        cutoffs.set(aggregateKey(event), { timestamp: event.timestamp, eventId: event.id });
      }
    }
    if (selected.length === 0) return { cutoffs, occurredAtBounds: undefined };
    const occurred = selected.map((event) => event.occurredAt);
    return {
      cutoffs,
      occurredAtBounds: { minMs: Math.min(...occurred), maxMs: Math.max(...occurred) },
    };
  }

  async streamEventsForAggregates(
    input: OfAggregates & {
      cutoffs: Map<string, CutoffInfo>;
      onEvent: (event: ReplayEvent) => void | Promise<void>;
    },
  ): Promise<{ eventsApplied: number }> {
    const selected = this.ofAggregates(input).filter((event) => {
      const cutoff = input.cutoffs.get(aggregateKey(event));
      return cutoff !== undefined && event.timestamp <= cutoff.timestamp;
    });
    for (const event of selected) await input.onEvent(event);
    return { eventsApplied: selected.length };
  }

  async loadAggregateEvents(
    input: OfAggregates & { maxCutoff: CutoffInfo; cursor?: CutoffInfo; batchSize: number },
  ): Promise<ReplayEvent[]> {
    return this.ofAggregates(input)
      .filter((event) => event.timestamp <= input.maxCutoff.timestamp)
      .filter((event) => input.cursor === undefined || event.timestamp > input.cursor.timestamp)
      .slice(0, input.batchSize);
  }
}
