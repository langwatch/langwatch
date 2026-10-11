/**
 * An upgrade step's queue work carries the key the worker's upgrade-step consumer lists groups
 * under, so every job it sends, and every job those cause, runs ahead of a backlog.
 * Spec: specs/upgrade/background-steps.feature.
 */
import { EVENTING_QUEUE_NAME } from "@langwatch/eventing";
import { getJobContextMetadata, runWithContext } from "@langwatch/observability/context";
import { describe, expect, it } from "vitest";

import { runAsUpgradeStepWork, upgradeStepGroupsKey } from "../upgrade-step-dispatch.ts";

describe("runAsUpgradeStepWork", () => {
  describe("given a step run inside a request's context", () => {
    /** @scenario "Queue work an upgrade step sends is listed for the upgrade-step consumer" */
    it("names the upgrade-step list of eventing's queue and keeps the context around it", async () => {
      const metadata = await runWithContext({ organizationId: "org-1" }, () =>
        runAsUpgradeStepWork(async () => getJobContextMetadata()),
      );

      expect(metadata).toMatchObject({
        organizationId: "org-1",
        queueDispatchScopeKey: `${EVENTING_QUEUE_NAME}:gq:upgrade-steps`,
      });
      expect(upgradeStepGroupsKey({ queueName: EVENTING_QUEUE_NAME })).toBe(
        metadata.queueDispatchScopeKey,
      );
    });
  });
});
