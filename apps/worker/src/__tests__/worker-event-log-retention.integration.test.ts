/**
 * Only customer telemetry expires (Alex, 2026-10-09): an aggregate type the event-log retention
 * policy does not list is kept forever, so a new telemetry pipeline must name its category there.
 * @see specs/data-retention/ingestion-stamping.feature
 */
import { RETENTION_CLASS_BY_AGGREGATE_TYPE } from "@langwatch/data-retention-contract/event-log-retention-policy";
import { describe, expect, it } from "vitest";

import { bootMemoryWorker } from "./worker-memory-boot.fixture.ts";

describe("the worker's event-log retention coverage", () => {
  /** @scenario "Every aggregate type the worker registers is classified" */
  it("lists every registered pipeline's aggregate type in the event-log retention policy", async () => {
    const { runtime, eventing } = await bootMemoryWorker();

    try {
      const unclassified = eventing.definitions
        .map((definition) => definition.metadata.aggregateType)
        .filter(
          (aggregateType) => !Object.hasOwn(RETENTION_CLASS_BY_AGGREGATE_TYPE, aggregateType),
        );
      expect(unclassified).toEqual([]);
    } finally {
      await runtime.stop();
    }
  }, 120_000);
});
