import { existsSync } from "node:fs";
import { join } from "node:path";

/** A policy whose anchor file is gone would read as clean; it refuses by name instead. */
export class MissingAnchorError extends Error {
  readonly policy: string;
  readonly anchor: string;

  constructor({ policy, anchor }: { policy: string; anchor: string }) {
    super(`${policy}: its anchor ${anchor} does not exist, so the policy cannot run.`);
    this.name = "MissingAnchorError";
    this.policy = policy;
    this.anchor = anchor;
  }
}

/** The absolute path of a workspace-relative anchor file, or a throw naming the policy. */
export function getAnchor({
  root,
  anchor,
  policy,
}: {
  root: string;
  anchor: string;
  policy: string;
}): string {
  const path = join(root, anchor);

  if (!existsSync(path)) throw new MissingAnchorError({ policy, anchor });

  return path;
}
