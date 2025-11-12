import { describe, it } from "vitest";

describe("enqueueClickHouseSpans", () => {
  it.todo("converts traces into ReadableSpan records");
  it.todo("enqueues ClickHouse jobs when spans are present");
  it.todo("skips enqueue when no spans are mapped");
  it.todo("propagates errors from repository failures");
});
