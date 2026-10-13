import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { buildCommit } from "./build-commit.ts";
import type { UpgradeImageVersion } from "./reader.schema.ts";

const SHORT_COMMIT = /^[0-9a-f]{7,40}$/;

let checkoutCommit: string | null | undefined;

/** The stamped build commit, else this checkout's `git rev-parse --short HEAD`, else null. */
export function readBuildCommit(): string | null {
  if (buildCommit) return buildCommit;
  if (checkoutCommit !== undefined) return checkoutCommit;
  try {
    const out = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: dirname(fileURLToPath(import.meta.url)),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2_000,
    }).trim();
    checkoutCommit = SHORT_COMMIT.test(out) ? out : null;
  } catch {
    checkoutCommit = null;
  }
  return checkoutCommit;
}

/** A release image names its release; any other build, the newest it contains and its commit. */
export function imageVersionOf({
  release,
  containsRelease,
  commit,
}: {
  release: string | null;
  containsRelease: string | null;
  commit: string | null;
}): UpgradeImageVersion {
  if (release !== null) return { kind: "release", release };
  return { kind: "development", containsRelease, commit };
}

/** "3.21.0", or "Development build 3.20.1+abc1234" (ADR-173 section 7), never "unreleased". */
export function imageVersionName(version: UpgradeImageVersion): string {
  if (version.kind === "release") return version.release;
  const { containsRelease, commit } = version;
  if (containsRelease === null) return commit ? `Development build ${commit}` : "Development build";
  return `Development build ${containsRelease}${commit ? `+${commit}` : ""}`;
}
