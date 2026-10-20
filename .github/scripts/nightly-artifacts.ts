// Downloads the artifact an earlier night left, by name and age, from default-branch runs only;
// why by artifact rather than by workflow run: dev/docs/nightly-suite.md ("Earlier nights").
//   node --experimental-strip-types .github/scripts/nightly-artifacts.ts \
//     --name codebase-health --min-age-days 6 --dir weekago
// Spec: specs/ci/nightly-suite.feature

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface ArtifactRecord {
  id: number;
  name: string;
  expired: boolean;
  created_at: string;
  workflow_run?: { id?: number; head_branch?: string };
}

const DAY_MS = 86_400_000;

/**
 * The newest unexpired artifact from another run on `branch` that is at least
 * `minAgeDays` old, or undefined when there is none.
 */
export const pickArtifact = ({
  artifacts,
  minAgeDays,
  now,
  excludeRunId,
  branch,
}: {
  artifacts: readonly ArtifactRecord[];
  minAgeDays: number;
  now: Date;
  excludeRunId?: number;
  branch: string;
}): ArtifactRecord | undefined => {
  const cutoff = now.getTime() - minAgeDays * DAY_MS;
  return artifacts
    .filter((artifact) => !artifact.expired)
    .filter((artifact) => artifact.workflow_run?.head_branch === branch)
    .filter((artifact) => artifact.workflow_run?.id !== excludeRunId)
    .filter((artifact) => Date.parse(artifact.created_at) <= cutoff)
    .toSorted((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
};

const option = (args: string[], name: string): string | undefined => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : args[at + 1];
};

const isEntrypoint = (): boolean =>
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntrypoint()) {
  const args = process.argv.slice(2);
  const name = option(args, "name");
  const dir = option(args, "dir");
  const repository = process.env.GITHUB_REPOSITORY;
  if (!name || !dir || !repository) {
    console.error(
      "usage: --name <artifact> --min-age-days <n> --dir <dir> (GITHUB_REPOSITORY set)",
    );
    process.exit(2);
  }
  const lines = execFileSync(
    "gh",
    [
      "api",
      "--paginate",
      "-X",
      "GET",
      `repos/${repository}/actions/artifacts`,
      "-f",
      `name=${name}`,
      "-f",
      "per_page=100",
      "--jq",
      ".artifacts[]",
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
    .split("\n")
    .filter(Boolean);
  const picked = pickArtifact({
    artifacts: lines.map((line) => JSON.parse(line) as ArtifactRecord),
    minAgeDays: Number(option(args, "min-age-days") ?? "0"),
    now: new Date(),
    excludeRunId: Number(process.env.GITHUB_RUN_ID ?? "0"),
    branch: option(args, "branch") ?? "main",
  });
  const runId = picked?.workflow_run?.id;
  if (runId === undefined) {
    // An absent night is a normal state (the first nights, an expired artifact):
    // the report shows n/a for it rather than failing.
    console.log(`no ${name} artifact old enough`);
    process.exit(0);
  }
  try {
    execFileSync(
      "gh",
      ["run", "download", String(runId), "--repo", repository, "--name", name, "--dir", dir],
      { stdio: "inherit" },
    );
    console.log(`${name} from run ${runId} (${picked?.created_at}) in ${dir}`);
  } catch {
    console.log(`could not download ${name} from run ${runId}`);
  }
}
