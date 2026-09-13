/**
 * Process state is persisted as JSON, and the persistence boundary refuses
 * `undefined` outright rather than letting `JSON.stringify` drop it. A handler
 * that copies an optional field forward with `state.field` therefore has to
 * coalesce it: on a state written before the field existed the key is absent,
 * and naming an absent key writes `undefined`.
 *
 * This is not theoretical. The first pull failure that named no wait, on a
 * source whose state predated cooldowns, threw
 * `Value at $.cooldownUntil is not JSON-safe: undefined` from the subscriber
 * — and kept throwing, because evolve re-runs the same committed event on every
 * retry. The source stayed parked until the code changed.
 *
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 */

import { INGESTION_PULL_EVENT_TYPES } from "@ee/event-sourcing/pipelines/ingestion-pull-processing/schemas/constants";
import { describe, expect, it } from "vitest";
import { ensureJsonSafe } from "~/server/event-sourcing/process-manager/json";

import type { IngestionPullProcessState } from "../ingestionPullProcess.types";
import {
  bootConfigured,
  CONFIGURED_AT,
  envelope,
  evolve,
} from "./listingProcess.fixture";

/**
 * A state row as it was written before cooldowns and listings existed: the
 * optional keys are not null, they are not there at all.
 */
function legacyState(): IngestionPullProcessState {
  const { cooldownUntil, currentAgentsListing, currentPeopleListing, ...rest } =
    bootConfigured().state;
  void cooldownUntil;
  void currentAgentsListing;
  void currentPeopleListing;
  return rest;
}

const LATER = CONFIGURED_AT + 60_000;

describe("given a state written before cooldowns existed", () => {
  describe("when a run fails without naming a wait", () => {
    const result = evolve({
      previousState: {
        ...legacyState(),
        currentRun: { runId: "run-1", scheduledFor: LATER, startedAt: LATER },
      },
      event: envelope({
        eventType: INGESTION_PULL_EVENT_TYPES.RUN_FAILED,
        occurredAt: LATER,
        payload: { sourceId: "source-1", runId: "run-1", retryAfterMs: null },
      }),
      now: LATER,
    });

    it("produces a state the persistence boundary accepts", () => {
      expect(() => ensureJsonSafe(result.state)).not.toThrow();
    });

    it("records the absence of a wait as null, not undefined", () => {
      expect(result.state.cooldownUntil).toBeNull();
    });
  });
});

describe("given a state written before listings existed", () => {
  describe("when a listing outcome arrives that the state is not tracking", () => {
    const result = evolve({
      previousState: legacyState(),
      event: envelope({
        eventType: INGESTION_PULL_EVENT_TYPES.AGENTS_LISTING_REFUSED,
        occurredAt: LATER,
        payload: { sourceId: "source-1", requestId: "stale-request" },
      }),
      now: LATER,
    });

    it("produces a state the persistence boundary accepts", () => {
      expect(() => ensureJsonSafe(result.state)).not.toThrow();
    });

    it("records the free slot as null, not undefined", () => {
      expect(result.state.currentAgentsListing).toBeNull();
    });
  });
});
