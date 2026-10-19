import { z } from "zod";

import { upgradePhaseNameSchema, upgradePhaseOutcomeSchema } from "./run-phases.ts";

/**
 * The runner's read hint (round 8, U2-LIVE): published on the framework's read-hint channel under
 * a platform scope, never a tenant's, so only the relay that names this scope forwards it. The
 * relay maps it to the upgrade reads it refreshes; nothing polls.
 */
export const UPGRADE_READ_HINT_SCOPE = "platform:upgrade";
export const UPGRADE_READ_HINT_PATH = "upgrade.run";

/** The hint's payload: which run moved, which phase (null once the run finished) and how. */
export const upgradeReadHintSchema = z.object({
  path: z.literal(UPGRADE_READ_HINT_PATH),
  runId: z.string(),
  phase: upgradePhaseNameSchema.nullable(),
  release: z.string().nullable(),
  outcome: upgradePhaseOutcomeSchema,
});
export type UpgradeReadHint = z.infer<typeof upgradeReadHintSchema>;

/** Where the runner hands a hint; the caller publishes it. A refusal never fails a run. */
export type UpgradeReadHintPublish = (hint: UpgradeReadHint) => Promise<unknown>;

/** The read-hint channel's message for a hint: the shape `publishReadHints` writes. */
export function upgradeReadHintMessage({
  hint,
  timestamp,
}: {
  hint: UpgradeReadHint;
  timestamp: number;
}): string {
  return JSON.stringify({
    tenantId: UPGRADE_READ_HINT_SCOPE,
    event: JSON.stringify(upgradeReadHintSchema.parse(hint)),
    timestamp,
  });
}
