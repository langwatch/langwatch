import { z } from "zod";

import type { UpgradeStatus } from "./reader.schema.ts";

/** One preflight row in the checkup's verdict shape (upgrade-ui plan 6.1.3). */
export const upgradePreflightRowSchema = z.object({
  id: z.enum(["floor", "failed-steps", "lease", "backup"]),
  name: z.string(),
  outcome: z.enum(["verified", "refused", "unchecked"]),
  detail: z.string().optional(),
  fix: z.string().optional(),
  docsPath: z.string().optional(),
});
export type UpgradePreflightRow = z.infer<typeof upgradePreflightRowSchema>;

const UPGRADE_DOCS_PATH = "/self-hosting/upgrade";

/** What can be told before an upgrade from the status alone; a backup never can. */
export function preflightFrom({ status }: { status: UpgradeStatus }): UpgradePreflightRow[] {
  const belowFloor =
    status.reason === "installed-below-floor" || status.reason === "image-below-ledger-floor";
  const failed = [...status.failedStepIds];
  if (status.failedTargets > 0) failed.push(`${status.failedTargets} failed target(s)`);
  const { lease } = status;
  return [
    belowFloor
      ? {
          id: "floor",
          name: "Installed release at or above the floor",
          outcome: "refused",
          detail: status.summary,
          fix: `upgrade to the LTS floor ${status.floor ?? "named in the upgrade docs"} first`,
          docsPath: UPGRADE_DOCS_PATH,
        }
      : { id: "floor", name: "Installed release at or above the floor", outcome: "verified" },
    failed.length > 0
      ? {
          id: "failed-steps",
          name: "No failed step",
          outcome: "refused",
          detail: failed.join(", "),
          fix: "fix and re-run the failed steps; `pnpm task upgrade status` names each error",
        }
      : { id: "failed-steps", name: "No failed step", outcome: "verified" },
    lease
      ? {
          id: "lease",
          name: "No upgrade in progress",
          outcome: "refused",
          detail: `${lease.owner ?? "a runner"} on ${lease.host ?? "an unknown host"} holds the lease`,
          fix: "wait for that upgrade to finish, or for its lease to expire",
        }
      : { id: "lease", name: "No upgrade in progress", outcome: "verified" },
    {
      id: "backup",
      name: "Recent backup",
      outcome: "unchecked",
      detail: "an upgrade cannot tell whether the databases were backed up",
      fix: "take a backup of Postgres and ClickHouse before upgrading",
      docsPath: UPGRADE_DOCS_PATH,
    },
  ];
}
