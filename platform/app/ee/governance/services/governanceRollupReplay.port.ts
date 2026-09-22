// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The erasure's way of asking for the money days to be rebuilt (ADR-128 §9
 * step 4).
 *
 * There is exactly one supported way to run a replay in this system — the ops
 * `ReplayService`, which holds the replay lock, records the run in history, and
 * can be watched and cancelled from the ops screen. This adapter goes through
 * it rather than driving `createReplayRuntime` itself, because a second
 * orchestration path would take no lock and could therefore run concurrently
 * with an operator's rebuild of the same projection.
 *
 * `fullRebuild` is on, and has to be: the erasure has just deleted the rows for
 * the days it is asking for, and a resume would find this projection's markers
 * from an earlier run still vouching for them and skip every aggregate — a run
 * that reports success and rebuilds nothing. Safe here for the same reason: the
 * rollup is a fold, so a rebuilt cell is written by key rather than added to.
 *
 * Fire-and-forget, like every other caller of `startReplay`. The rebuild takes
 * as long as it takes, and the erasure's own guarantee is that the rows are
 * gone — not that they are already back.
 *
 * Spec: specs/governance/governance-identity-and-erasure.feature
 */
import { createLogger } from "@langwatch/observability";

import { GOVERNANCE_COST_ROLLUP_PROJECTION_NAME } from "../projections/governanceCostRollup.constants";
import type { RollupReplayPort } from "./identityErasure.service";

const logger = createLogger("langwatch:governance:rollup-replay-port");

/**
 * Builds the port over the App's ops replay service.
 *
 * Takes a getter rather than the service, because this is constructed while the
 * App is still being composed and the ops group does not exist yet. Resolved at
 * call time, which is minutes-to-months later.
 */
export function createGovernanceRollupReplayPort(
  replayService: () => {
    startReplay(params: {
      projectionNames: string[];
      since: string;
      tenantIds: string[];
      fullRebuild?: boolean;
      description: string;
      userName: string;
    }): Promise<{ runId: string }>;
  },
): RollupReplayPort {
  return {
    replaySince: async ({ tenantIds, since }) => {
      const { runId } = await replayService().startReplay({
        projectionNames: [GOVERNANCE_COST_ROLLUP_PROJECTION_NAME],
        since,
        tenantIds,
        fullRebuild: true,
        description: `Governance identity erasure: rebuilding daily cost rows from ${since}`,
        userName: "governance-identity-erasure",
      });
      logger.info(
        { runId, since, tenantIds },
        "Erasure asked for the daily cost rows to be rebuilt; the identifier is already gone from them",
      );
    },
  };
}
