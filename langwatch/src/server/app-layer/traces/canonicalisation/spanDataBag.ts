import type { NormalizedAttributes, NormalizedSpan } from "../../../event-sourcing/pipelines/trace-processing/schemas/spans";
import { AttributeBag } from "./attributeBag";
import { EventBag } from "./eventBag";

export class SpanDataBag {
  readonly attrs: AttributeBag;
  readonly events: EventBag;

  constructor(
    spanAttributes: NormalizedAttributes,
    events: NormalizedSpan["events"],
  ) {
    this.attrs = new AttributeBag(spanAttributes);
    this.events = new EventBag(events);
  }
}
