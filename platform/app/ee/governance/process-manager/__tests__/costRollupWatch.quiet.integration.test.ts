// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * Who is never checked, and what a deployment holding no summary does.
 *
 * The whole point of replacing the nightly job is that the cost of checking
 * scales with how much money moved rather than with how many customers there
 * are, and every scenario here is a way of asking for a comparison that should
 * never have been asked for. Each drives the production sweep over the shared
 * Postgres rather than a hand-aimed wake, because "nobody armed anything" is
 * only meaningful against a scan that would have found it.
 *
 * Spec: specs/governance/cost-rollup-watch.feature
 * Decision: ADR-128.
 */

import { createPulledUsageProcessingPipeline } from "@ee/event-sourcing/pipelines/pulled-usage-processing/pipeline";
import type { PulledUsageProcessingEvent } from "@ee/event-sourcing/pipelines/pulled-usage-processing/schemas/events";
import { GOVERNANCE_COST_SOURCE } from "@ee/governance/projections/governanceCostRollup.constants";
import { describe, expect, it } from "vitest";
import { GATEWAY_SPEND_PROCESSING_EVENT_TYPES } from "~/server/event-sourcing/pipelines/gateway-spend-processing/schemas/constants";
import { ProcessRuntime } from "~/server/event-sourcing/process-manager/processRuntime";

import { COST_ROLLUP_WATCH_PROCESS_NAME } from "../costRollupWatch.process";
import { createWatchHarness } from "./costRollupWatch.integration.harness";
import {
  TODAY,
  TONIGHT,
  YESTERDAY,
  YESTERDAY_MS,
} from "./costRollupWatch.summary.fixtures";

const h = createWatchHarness({ tenantPrefix: "proj-gov-quiet" });

describe("leaving quiet organizations alone", () => {
  describe("given an organization with no pulled charges at all", () => {
    /** @scenario An organization that has never pulled a bill has nothing armed */
    it("has no check of its own and is never compared", async () => {
      const quiet = `${h.tenant}-quiet`;
      // Another organization's charge, so the sweep below has real work.
      await h.record(h.charge());

      h.clock = TONIGHT;
      await h.sweepDueChecks();
      await h.drainOutbox();

      expect(await h.instanceOf(quiet)).toBeNull();
      expect(h.daysComparedFor(quiet)).toEqual([]);
    });
  });

  describe("given an organization whose requests went through the gateway", () => {
    /** @scenario Gateway spend does not mark a day */
    it("never routes gateway spend to the check and compares no gateway lane", async () => {
      // The routing IS the generated subscriber's event list: a gateway spend
      // event is never delivered to this process, so there is nothing for it
      // to mark a day from.
      const runtime = new ProcessRuntime({
        store: h.store,
        consumersEnabled: false,
      });
      const { subscribers } =
        runtime.registerPipeline<PulledUsageProcessingEvent>({
          pipelineName: "pulled-usage-processing",
          processManagers: new Map([
            [COST_ROLLUP_WATCH_PROCESS_NAME, h.definition()],
          ]),
        });
      const watch = subscribers.find(
        (subscriber) =>
          subscriber.name === `pm:${COST_ROLLUP_WATCH_PROCESS_NAME}`,
      );
      if (!watch) throw new Error("the runtime generated no watch subscriber");
      expect(
        watch.eventTypes.filter((type) =>
          (GATEWAY_SPEND_PROCESSING_EVENT_TYPES as readonly string[]).includes(
            type,
          ),
        ),
      ).toEqual([]);
      await runtime.stop();

      await h.record(h.charge());
      h.clock = TONIGHT;
      await h.sweepDueChecks();
      await h.drainOutbox();

      expect(h.comparisonsWithSource(GOVERNANCE_COST_SOURCE.GATEWAY)).toEqual(
        [],
      );
    });
  });

  describe("given a day that was compared and has received nothing since", () => {
    /** @scenario A quiet day is never re-checked on its own */
    it("is not compared again at a later check", async () => {
      await h.record(h.charge());
      await h.runDueCheck();
      await h.drainOutbox();
      expect(h.daysComparedFor()).toEqual([TODAY]);

      // A later check comes due, armed by a charge on another day only.
      h.clock = TONIGHT + 3_600_000;
      await h.record(h.charge({ occurredAtMs: YESTERDAY_MS }));
      await h.runDueCheck();
      await h.drainOutbox();

      expect(h.daysComparedFor()).toEqual([TODAY, YESTERDAY]);
    });
  });
});

describe("mounting the check only where a summary exists", () => {
  describe("given a deployment where the cost summary store is not configured", () => {
    /** @scenario A deployment that holds no summary at all asks for no comparisons */
    it("mounts nothing, so no comparison is asked for and none dies", async () => {
      const pipeline = createPulledUsageProcessingPipeline({});
      expect(pipeline.processManagers.has(COST_ROLLUP_WATCH_PROCESS_NAME)).toBe(
        false,
      );

      // The runtime generates subscribers from the pipeline's declaration, so
      // a pipeline that mounts nothing routes charges nowhere.
      const runtime = new ProcessRuntime({
        store: h.store,
        consumersEnabled: false,
      });
      const { subscribers } =
        runtime.registerPipeline<PulledUsageProcessingEvent>({
          pipelineName: "pulled-usage-processing",
          processManagers: pipeline.processManagers,
        });
      expect(subscribers.map((subscriber) => subscriber.name)).not.toContain(
        `pm:${COST_ROLLUP_WATCH_PROCESS_NAME}`,
      );
      await runtime.stop();

      h.clock = TONIGHT;
      await h.sweepDueChecks();
      await h.drainOutbox();

      expect(await h.instanceOf()).toBeNull();
      // Neither failure mode: no comparison asked for, and none dead.
      expect(await h.messagesFor()).toEqual([]);
      expect(h.daysComparedFor()).toEqual([]);
    });
  });
});
