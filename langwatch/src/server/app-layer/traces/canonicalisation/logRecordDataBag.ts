import type { NormalizedAttributes } from "../../../event-sourcing/pipelines/trace-processing/schemas/spans";
import { AttributeBag } from "./attributeBag";

/**
 * Mirror of SpanDataBag for log records. Wraps the log record's
 * attribute map so the canonical extractor pipeline can claim
 * (`take`) keys the same way it does for spans. Log records don't
 * carry their own event array (their `body` is the only narrative
 * field, and `attributes` already carries everything an extractor
 * needs), so this bag is a thin AttributeBag wrapper plus the
 * scope name + body, which extractors gate detection on.
 */
export class LogRecordDataBag {
  readonly attrs: AttributeBag;

  constructor(
    public readonly scopeName: string,
    public readonly body: string,
    attributes: NormalizedAttributes,
  ) {
    this.attrs = new AttributeBag(attributes);
  }
}
