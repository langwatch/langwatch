import { describe, expect, it } from "vitest";
import * as automations from "../index";

/**
 * A barrel that re-exports a name nothing actually exports resolves to
 * `undefined` at import time without a type checker catching it (this
 * pipeline hit exactly that with `MAX_PENDING_MATCHES` during development —
 * see `triggerSettlement.ts`). This test is the runtime backstop: every
 * value export from `index.ts` must actually be defined.
 */
describe("automations pipeline public surface", () => {
  it("exports no accidental undefined bindings", () => {
    const undefinedExports = Object.entries(automations)
      .filter(([, value]) => value === undefined)
      .map(([name]) => name);

    expect(undefinedExports).toEqual([]);
  });

  it("re-exports the pipeline factory and the three process-manager names", () => {
    expect(typeof automations.createAutomationsPipeline).toBe("function");
    expect(automations.TRIGGER_SETTLEMENT_PROCESS_NAME).toBe("triggerSettlement");
    expect(automations.GRAPH_ALERT_SWEEP_PROCESS_NAME).toBe("graphAlertSweep");
    expect(automations.WEBHOOK_DELIVERY_PRUNE_PROCESS_NAME).toBe("webhookDeliveryPrune");
  });
});
