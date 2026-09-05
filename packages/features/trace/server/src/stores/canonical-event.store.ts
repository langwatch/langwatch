import type { CanonicalEvent } from "@langwatch/trace-contract";

export class EventBag {
  private readonly events: CanonicalEvent[];
  private readonly consumed = new Set<number>();

  constructor(events: CanonicalEvent[]) {
    this.events = events;
  }

  /** Read without consuming */
  all(): readonly CanonicalEvent[] {
    return this.events;
  }

  /** Take first event with this name (and mark it consumed) */
  tryTakeFirst(name: string): CanonicalEvent | null {
    for (let i = 0; i < this.events.length; i++) {
      if (this.consumed.has(i)) continue;
      const event = this.events[i];
      if (event?.name === name) {
        this.consumed.add(i);
        return event;
      }
    }
    return null;
  }

  /** Take all events with this name (and mark consumed) */
  takeAll(name: string): CanonicalEvent[] {
    const out: CanonicalEvent[] = [];
    for (let i = 0; i < this.events.length; i++) {
      if (this.consumed.has(i)) continue;
      const event = this.events[i];
      if (event?.name === name) {
        this.consumed.add(i);
        out.push(event);
      }
    }
    return out;
  }

  /** Take all events matching any of the given names, preserving original order */
  takeAllByNames(names: readonly string[]): CanonicalEvent[] {
    const nameSet = new Set(names);
    const out: CanonicalEvent[] = [];
    for (let i = 0; i < this.events.length; i++) {
      if (this.consumed.has(i)) continue;
      const event = this.events[i];
      if (event !== void 0 && nameSet.has(event.name)) {
        this.consumed.add(i);
        out.push(event);
      }
    }
    return out;
  }

  /** Events that remain after consumption */
  remaining(): CanonicalEvent[] {
    const out: CanonicalEvent[] = [];
    for (let i = 0; i < this.events.length; i++) {
      const event = this.events[i];
      if (!this.consumed.has(i) && event !== void 0) out.push(event);
    }
    return out;
  }
}
