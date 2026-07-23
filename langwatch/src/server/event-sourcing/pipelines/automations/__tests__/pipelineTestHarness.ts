import type { ProcessManagerDefinition } from "~/server/event-sourcing/pipeline/processManagerDefinition";
import {
  createAutomationsPipeline,
  type AutomationsPipelineDeps,
} from "../pipeline";

/** Pull one process-manager definition out of the real automations pipeline
 *  with inert stub deps — the PM topology lives inline in `pipeline.ts`
 *  (ADR-052), so tests exercise the exact registered definition instead of
 *  re-assembling their own. Override only the deps the test asserts on. */
export function automationProcessDefinition({
  name,
  deps = {},
}: {
  name: "triggerSettlement" | "graphAlertSweep" | "webhookDeliveryPrune";
  deps?: Partial<AutomationsPipelineDeps>;
}): ProcessManagerDefinition {
  const pipeline = createAutomationsPipeline({
    dispatch: {} as AutomationsPipelineDeps["dispatch"],
    sweep: {
      decideSweepCandidates: async () => [],
      evaluateGraphTrigger: async () => {
        // inert stub
      },
      deleteDispatchedBefore: async () => 0,
    },
    prune: {
      pruneExpired: async () => 0,
      deleteDispatchedBefore: async () => 0,
    },
    ...deps,
  });
  const definition = pipeline.processManagers.get(name);
  if (!definition) throw new Error(`Unknown process manager: ${name}`);
  return definition;
}
