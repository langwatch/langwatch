/**
 * @vitest-environment node
 * @see specs/ai-gateway/worker-gateway-spend-conversion.feature
 * The worker's installed list booted over `memoryStores()` wholly (ARCHITECTURE.md §7, §13): the
 * routing keys the process registers for the queue, read off the eventing it hosts.
 */
import { afterEach, describe, expect, it } from "vitest";

import { bootMemoryWorker } from "./worker-memory-boot.fixture.ts";

/** Spend's seven keys, as the byte-frozen job registry lists them. */
const SPEND_KEYS = [
  "gateway_spend_processing:projection:gatewaySpend",
  "gateway_spend_processing:projectionRebuild:gatewaySpend",
  "gateway_spend_processing:subscriber:pm:gatewayDebits",
  "gateway_spend_processing:command:admitSpend",
  "gateway_spend_processing:command:confirmSpend",
  "gateway_spend_processing:command:failSpend",
  "gateway_spend_processing:command:settleSpend",
] as const;

/** Governance's three: its two signal commands and webhook's governance delivery process. */
const GOVERNANCE_KEYS = [
  "governance_events_processing:command:recordVkLifecycle",
  "governance_events_processing:command:recordBudgetCrossing",
  "webhook_delivery:subscriber:pm:governanceEventsDelivery",
] as const;

let booted: Awaited<ReturnType<typeof bootMemoryWorker>> | undefined;

afterEach(async () => {
  await booted?.runtime.stop();
  booted = void 0;
});

describe("given the worker's installed list booted over memory stores", () => {
  describe("when the gateway spend and governance pipelines are mounted", () => {
    /** @scenario "The worker mounts every gateway spend and governance routing key" */
    it("claims exactly the seven spend keys and the three governance keys", async () => {
      booted = await bootMemoryWorker();
      const claimed = [...booted.eventing.globalJobRegistry.keys()];

      for (const key of [...SPEND_KEYS, ...GOVERNANCE_KEYS]) {
        expect(claimed, key).toContain(key);
      }
      expect(
        claimed.filter((key) => key.startsWith("gateway_spend_processing:")).toSorted(),
      ).toEqual([...SPEND_KEYS].toSorted());
      expect(
        claimed.filter((key) => key.startsWith("governance_events_processing:")).toSorted(),
      ).toEqual(
        GOVERNANCE_KEYS.filter((key) => key.startsWith("governance_events_processing:")).toSorted(),
      );
    });
  });
});
