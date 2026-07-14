/**
 * SeedAction wrapper around the existing seed-bird-eye script.
 *
 * The wrapper applies production-shape defaults (30-day dashboard
 * window, 480-row volume, anomaly alert included) and pulls the target
 * organization id from the runner's scope-asserted Organization handle,
 * so the underlying script cannot accidentally seed a non-allowlisted
 * org even if seed-bird-eye's own --org-id flag is passed elsewhere.
 *
 * In dry-run mode the action returns a `skipped` outcome without
 * invoking the underlying runner, so a developer running
 * `pnpm tsx seed-demo.ts` (no --execute) gets a quick read of intent
 * without 480-row CH inserts.
 */

import { runSeedBirdEye } from "../seed-bird-eye";
import type {
  SeedAction,
  SeedActionContext,
  SeedActionOutcome,
} from "../_lib/seedRunner";

const DEFAULT_DASHBOARD_DAYS = 30;
const DEFAULT_ROWS = 480;

export const seedBirdEye: SeedAction = {
  name: "seedBirdEye",
  async run({ organization, execute }: SeedActionContext): Promise<SeedActionOutcome> {
    if (!execute) {
      return {
        status: "skipped",
        reason: `dry-run: would seed bird-eye fixture (~${DEFAULT_ROWS} rows over ${DEFAULT_DASHBOARD_DAYS * 2} days, 4 teams, anomaly alert)`,
      };
    }

    const summary = await runSeedBirdEye({
      organizationId: organization.id,
      days: DEFAULT_DASHBOARD_DAYS,
      rows: DEFAULT_ROWS,
      withAnomaly: true,
    });

    return {
      status: "succeeded",
      summary: `seeded ${summary.rowsInserted} rows ($${summary.totalCostUsd.toFixed(4)} synthetic spend) across ${summary.sources.length} sources`,
    };
  },
};
