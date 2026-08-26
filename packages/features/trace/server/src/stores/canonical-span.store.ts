import type { CanonicalAttributes, CanonicalEvent } from "@langwatch/trace-contract";
import { AttributeBag } from "./canonical-attribute.store";
import { EventBag } from "./canonical-event.store";

export class SpanDataBag {
  readonly attrs: AttributeBag;
  readonly events: EventBag;

  constructor(spanAttributes: CanonicalAttributes, events: CanonicalEvent[]) {
    this.attrs = new AttributeBag(spanAttributes);
    this.events = new EventBag(events);
  }
}
