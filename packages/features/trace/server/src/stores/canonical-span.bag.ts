import type { CanonicalAttributes, CanonicalEvent } from "@langwatch/trace-contract";
import { AttributeBag } from "./canonical-attribute.bag";
import { EventBag } from "./canonical-event.bag";

export class SpanDataBag {
  readonly attrs: AttributeBag;
  readonly events: EventBag;

  constructor(spanAttributes: CanonicalAttributes, events: CanonicalEvent[]) {
    this.attrs = new AttributeBag(spanAttributes);
    this.events = new EventBag(events);
  }
}
