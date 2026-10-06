import { z } from "zod";

import type { UpgradeStepStatus } from "./ledger.ts";

/**
 * One declared event upcast as the ledger records it (Alex, 2026-10-06): a background step whose
 * rewrite makes the upcast unnecessary. `id` is eventing's `upcastStepId`; the report is what ops
 * shows. Spec: packages/eventing/specs/event-upcast.feature.
 */
export const upcastStepInputSchema = z.object({
  id: z.string().startsWith("upcast:"),
  storedEvents: z.number().int().nonnegative(),
  report: z.record(z.string(), z.unknown()),
});
export type UpcastStepInput = z.infer<typeof upcastStepInputSchema>;

/** Level-triggered: pending while any stored event still needs the upcast, done once none does. */
export function upcastStepStatus({ storedEvents }: { storedEvents: number }): UpgradeStepStatus {
  return storedEvents > 0 ? "pending" : "done";
}
