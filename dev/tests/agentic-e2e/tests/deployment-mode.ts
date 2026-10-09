import { execFileSync } from "node:child_process";

/**
 * The deployment mode the stack under test runs (specs/setup/deployment-modes.feature).
 * CI passes dev/tests/modes/<mode>.env to the runner, so LANGWATCH_DEPLOYMENT_MODE answers;
 * locally haven's status record does, including a root .env override of a mode variable.
 */
export function effectiveDeploymentMode(): string {
  const fromEnv = process.env.LANGWATCH_DEPLOYMENT_MODE;
  if (fromEnv) return fromEnv;
  const worktree = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();
  const status = JSON.parse(execFileSync("haven", ["status", "--json"], { encoding: "utf8" })) as {
    stacks?: { worktreeDir: string; effectiveMode?: string }[];
  };
  const stack = status.stacks?.find((s) => s.worktreeDir === worktree);
  return stack?.effectiveMode ?? "none";
}

/** Refuses the journey when the stack is not in the mode it requires. */
export function requireDeploymentMode({ mode }: { mode: string }): void {
  const effective = effectiveDeploymentMode();
  if (effective !== mode) {
    throw new Error(
      `journey requires deployment mode ${mode}; the stack runs ${effective} (haven up --mode ${mode})`,
    );
  }
}
