import { existsSync } from "node:fs";
import { join } from "node:path";

import type { PackageManifest } from "../types.ts";

const PLAN_DIRECTORY = "dev/docs/plans/";

/**
 * Whether a process package records itself as staged: its package.json names, under `staged`,
 * the plan in dev/docs/plans/ it waits on, and that plan exists. A staged module is designed,
 * not built, so the shape policies do not ask it for an app, an installer or a service yet.
 */
export function isStagedModule({
  root,
  manifest,
}: {
  root: string;
  manifest: PackageManifest;
}): boolean {
  const plan = manifest.staged;
  if (typeof plan !== "string" || !plan.startsWith(PLAN_DIRECTORY)) return false;

  return existsSync(join(root, plan));
}
