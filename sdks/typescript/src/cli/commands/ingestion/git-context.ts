/**
 * The git half of `langwatch ingest hook <tool>`: what a session's directory
 * says about the code it is working on.
 *
 * Separate from the command because it is the only part that shells out, and
 * because every branch here answers the same question the command asks once
 * ("which checkout is this?") rather than anything about hooks, telemetry or
 * state. The command injects the runner, so its tests never spawn git.
 *
 * Spec: specs/ai-governance/cli-wrappers/session-context-hook.feature
 */

import { spawnSync } from "node:child_process";
import * as path from "node:path";

import {
  parseGitRemoteUrl,
  type SessionContext,
} from "@/cli/utils/governance/session-context";

/** How long a single git invocation may take. */
const GIT_TIMEOUT_MS = 2_000;

/** Runs one git command in a directory. Trimmed stdout, or null on any failure. */
export type GitRunner = (args: { args: string[]; cwd: string }) => string | null;

/** The git identity of `directory`, or null when it is not a repository we can name. */
export function readSessionContext({
  directory,
  runGit,
}: {
  directory: string;
  runGit: GitRunner;
}): SessionContext | null {
  const remote = runGit({
    args: ["remote", "get-url", "origin"],
    cwd: directory,
  });
  const repository = remote === null ? null : parseGitRemoteUrl(remote);
  if (!repository) return null;

  // Empty on a detached HEAD, which is a state to omit rather than invent.
  const branch = runGit({ args: ["branch", "--show-current"], cwd: directory });
  const worktree = readWorktreeName({ directory, runGit });

  return {
    repository,
    ...(branch ? { branch } : {}),
    ...(worktree ? { worktree } : {}),
  };
}

/** Runs git in `cwd`, bounded, and reports failure as null rather than throwing. */
export function runGitCommand({
  args,
  cwd,
}: {
  args: string[];
  cwd: string;
}): string | null {
  try {
    const result = spawnSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      timeout: GIT_TIMEOUT_MS,
    });
    if (result.status !== 0 || typeof result.stdout !== "string") return null;
    const output = result.stdout.trim();
    return output === "" ? null : output;
  } catch {
    return null;
  }
}

/**
 * The name of the linked worktree `directory` sits in, or undefined in the
 * main checkout. A linked worktree is exactly the case where the per-worktree
 * git dir differs from the common one; its name is the directory it is
 * checked out into, which is what people call it.
 */
function readWorktreeName({
  directory,
  runGit,
}: {
  directory: string;
  runGit: GitRunner;
}): string | undefined {
  const gitDir = runGit({ args: ["rev-parse", "--git-dir"], cwd: directory });
  const commonDir = runGit({
    args: ["rev-parse", "--git-common-dir"],
    cwd: directory,
  });
  if (!gitDir || !commonDir) return undefined;
  // Both may come back relative to the directory, so resolve before comparing.
  if (path.resolve(directory, gitDir) === path.resolve(directory, commonDir)) {
    return undefined;
  }

  const topLevel = runGit({
    args: ["rev-parse", "--show-toplevel"],
    cwd: directory,
  });
  return topLevel ? path.basename(topLevel) : undefined;
}
