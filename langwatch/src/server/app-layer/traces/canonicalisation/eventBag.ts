import type { NormalizedEvent } from "../../../event-sourcing/pipelines/trace-processing/schemas/spans";

export class EventBag {
  private readonly events: NormalizedEvent[];
  private readonly consumed = new Set<number>();

  constructor(events: NormalizedEvent[]) {
    this.events = events;
  }

  /** Read without consuming */
  all(): readonly NormalizedEvent[] {
    return this.events;
  }

  /** Take first event with this name (and mark it consumed) */
  takeFirst(name: string): NormalizedEvent | null {
    for (let i = 0; i < this.events.length; i++) {
      if (this.consumed.has(i)) continue;
      if (this.events[i]?.name === name) {
        this.consumed.add(i);
        return this.events[i] ?? null;
      }
    }
    return null;
  }

  /** Take all events with this name (and mark consumed) */
  takeAll(name: string): NormalizedEvent[] {
    const out: NormalizedEvent[] = [];
    for (let i = 0; i < this.events.length; i++) {
      if (this.consumed.has(i)) continue;
      if (this.events[i]?.name === name) {
        this.consumed.add(i);
        out.push(this.events[i]!);
      }
    }
    return out;
  }

  /** Events that remain after consumption */
  remaining(): NormalizedEvent[] {
    const out: NormalizedEvent[] = [];
    for (let i = 0; i < this.events.length; i++) {
      if (!this.consumed.has(i)) out.push(this.events[i]!);
    }
    return out;
  }
}
