import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

interface ReleasePullRequest {
  number: number;
  headBranchName: string;
}

interface ReleaseNoteEntry {
  sha: string;
  pullRequestNumbers: number[];
  start: number;
  end: number;
}

export interface DeduplicationResult {
  content: string;
  removedCommitShas: string[];
}

const RELEASE_PLEASE_BRANCH_PREFIX = "release-please--branches--main--components--";
const RELEASE_HEADER = /^## \[[^\]]+\]/;
const BULLET = /^\* /;
const CHANGELOG_HEADING = /^#{1,6}\s/;
const COMMIT_SHA = /\/commit\/([0-9a-f]{7,64})(?=[)\s])/i;
const PULL_REQUEST_LINK = /\/(?:issues|pull)\/(\d+)(?=[)#\s])/g;
const SUBJECT_PULL_REQUEST = /\(#(\d+)\)\s*$/;

const newestReleaseSection = (lines: string[]): { start: number; end: number } | null => {
  const start = lines.findIndex((line) => RELEASE_HEADER.test(line));
  if (start === -1) return null;

  const nextRelease = lines.findIndex((line, index) => index > start && RELEASE_HEADER.test(line));
  return { start, end: nextRelease === -1 ? lines.length : nextRelease };
};

const entryPullRequestNumbers = (text: string): number[] =>
  [...text.matchAll(PULL_REQUEST_LINK)].map((match) => Number(match[1]));

const entriesIn = ({
  lines,
  start,
  end,
}: {
  lines: string[];
  start: number;
  end: number;
}): ReleaseNoteEntry[] => {
  const entries: ReleaseNoteEntry[] = [];

  for (let index = start + 1; index < end; index++) {
    if (!BULLET.test(lines[index]!)) continue;

    let entryEnd = index + 1;
    while (
      entryEnd < end &&
      !BULLET.test(lines[entryEnd]!) &&
      !CHANGELOG_HEADING.test(lines[entryEnd]!)
    ) {
      entryEnd++;
    }

    const text = lines.slice(index, entryEnd).join("\n");
    const sha = text.match(COMMIT_SHA)?.[1];
    if (sha) {
      entries.push({
        sha: sha.toLowerCase(),
        pullRequestNumbers: entryPullRequestNumbers(text),
        start: index,
        end: entryEnd,
      });
    }

    index = entryEnd - 1;
  }

  return entries;
};

/** Commit SHAs represented by release-note bullets in the newest release. */
export const newestReleaseCommitShas = (content: string): string[] => {
  const lines = content.split("\n");
  const section = newestReleaseSection(lines);
  if (!section) return [];
  return [
    ...new Set(
      entriesIn({ lines, start: section.start, end: section.end }).map((entry) => entry.sha),
    ),
  ];
};

/**
 * Keep one release-note bullet per commit in the newest generated release.
 *
 * release-please can parse both a squash commit subject and a conventional
 * commit line at the beginning of its body. They point at the same SHA, but
 * can carry different wording or even different PR references. Prefer the
 * entry linked to the PR named by the canonical squash subject, then any
 * entry with a PR link, then the first generated entry.
 */
export const dedupeNewestReleaseSection = ({
  content,
  subjectPullRequests,
}: {
  content: string;
  subjectPullRequests: Readonly<Record<string, number | undefined>>;
}): DeduplicationResult => {
  const lines = content.split("\n");
  const section = newestReleaseSection(lines);
  if (!section) return { content, removedCommitShas: [] };

  const bySha = new Map<string, ReleaseNoteEntry[]>();
  for (const entry of entriesIn({ lines, start: section.start, end: section.end })) {
    const group = bySha.get(entry.sha) ?? [];
    group.push(entry);
    bySha.set(entry.sha, group);
  }

  const removedLines = new Set<number>();
  const removedCommitShas: string[] = [];
  for (const [sha, group] of bySha) {
    if (group.length < 2) continue;

    const expectedPullRequest = subjectPullRequests[sha];
    const keep =
      group.find(
        (entry) =>
          expectedPullRequest !== undefined && entry.pullRequestNumbers.includes(expectedPullRequest),
      ) ?? group.find((entry) => entry.pullRequestNumbers.length > 0) ?? group[0]!;

    for (const entry of group) {
      if (entry === keep) continue;
      for (let index = entry.start; index < entry.end; index++) removedLines.add(index);
    }
    removedCommitShas.push(sha);
  }

  if (removedLines.size === 0) return { content, removedCommitShas };
  return {
    content: lines.filter((_line, index) => !removedLines.has(index)).join("\n"),
    removedCommitShas,
  };
};

const run = ({ command, args, cwd }: { command: string; args: string[]; cwd: string }): string =>
  execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

const requireRepository = (): string => {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository || !/^[^/]+\/[^/]+$/.test(repository)) {
    throw new Error("GITHUB_REPOSITORY must be an owner/repository value");
  }
  return repository;
};

const releasePullRequests = (): ReleasePullRequest[] => {
  const raw = process.env.RELEASE_PLEASE_PRS;
  if (!raw) return [];

  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("RELEASE_PLEASE_PRS must be a JSON array");

  return parsed.map((value) => {
    if (
      typeof value !== "object" ||
      value === null ||
      !Number.isInteger((value as ReleasePullRequest).number) ||
      typeof (value as ReleasePullRequest).headBranchName !== "string"
    ) {
      throw new Error("RELEASE_PLEASE_PRS contains an invalid pull request");
    }
    return value as ReleasePullRequest;
  });
};

const stagedChanges = (cwd: string): boolean => {
  const result = spawnSync("git", ["diff", "--cached", "--quiet"], {
    cwd,
    env: process.env,
    stdio: "ignore",
  });
  if (result.status === 0) return false;
  if (result.status === 1) return true;
  throw new Error("Unable to inspect staged changes");
};

const safeRepositoryPath = ({ path, cwd }: { path: string; cwd: string }): string => {
  const absolutePath = resolve(cwd, path);
  if (!absolutePath.startsWith(`${resolve(cwd)}/`)) {
    throw new Error(`Refusing to write outside the repository: ${path}`);
  }
  return absolutePath;
};

export const subjectPullRequestsFor = ({
  commitShas,
  cwd,
  warn = console.warn,
}: {
  commitShas: string[];
  cwd: string;
  warn?: (message: string) => void;
}): Record<string, number | undefined> =>
  Object.fromEntries(
    commitShas.map((sha) => {
      try {
        const subject = run({ command: "git", args: ["show", "-s", "--format=%s", sha], cwd });
        const pullRequest = subject.match(SUBJECT_PULL_REQUEST)?.[1];
        return [sha, pullRequest === undefined ? undefined : Number(pullRequest)];
      } catch {
        warn(`Unable to resolve commit subject for ${sha}; skipping canonical PR lookup.`);
        return [sha, undefined];
      }
    }),
  );

const dedupePullRequest = ({
  pullRequest,
  repository,
  cwd,
}: {
  pullRequest: ReleasePullRequest;
  repository: string;
  cwd: string;
}): void => {
  if (!pullRequest.headBranchName.startsWith(RELEASE_PLEASE_BRANCH_PREFIX)) {
    throw new Error(`Unexpected release-please branch: ${pullRequest.headBranchName}`);
  }

  const details = JSON.parse(
    run({ command: "gh", args: ["api", `repos/${repository}/pulls/${pullRequest.number}`], cwd }),
  ) as { head?: { ref?: string; repo?: { full_name?: string } | null } };
  if (
    details.head?.repo?.full_name !== repository ||
    details.head.ref !== pullRequest.headBranchName
  ) {
    throw new Error(`Release PR #${pullRequest.number} no longer points at its expected branch`);
  }

  run({
    command: "git",
    args: [
      "fetch",
      "--no-tags",
      "origin",
      `+refs/heads/${pullRequest.headBranchName}:refs/remotes/origin/${pullRequest.headBranchName}`,
    ],
    cwd,
  });
  run({ command: "git", args: ["switch", "--detach", `origin/${pullRequest.headBranchName}`], cwd });

  const files = JSON.parse(
    run({
      command: "gh",
      args: ["pr", "view", String(pullRequest.number), "--repo", repository, "--json", "files"],
      cwd,
    }),
  ) as { files?: Array<{ path?: string }> };
  const changelogs = (files.files ?? [])
    .map((file) => file.path)
    .filter((path): path is string => typeof path === "string" && path.endsWith("CHANGELOG.md"));

  const changedPaths: string[] = [];
  for (const path of changelogs) {
    const absolutePath = safeRepositoryPath({ path, cwd });
    const content = readFileSync(absolutePath, "utf8");
    const subjects = subjectPullRequestsFor({
      commitShas: newestReleaseCommitShas(content),
      cwd,
    });
    const result = dedupeNewestReleaseSection({ content, subjectPullRequests: subjects });
    if (result.content === content) continue;

    writeFileSync(absolutePath, result.content);
    changedPaths.push(path);
    console.info(
      `Release PR #${pullRequest.number}: removed duplicate entries for ${result.removedCommitShas.join(", ")}`,
    );
  }

  if (changedPaths.length === 0) return;

  run({ command: "git", args: ["add", "--", ...changedPaths], cwd });
  if (!stagedChanges(cwd)) return;

  run({ command: "git", args: ["config", "user.name", "github-actions[bot]"], cwd });
  run({
    command: "git",
    args: ["config", "user.email", "github-actions[bot]@users.noreply.github.com"],
    cwd,
  });
  run({ command: "git", args: ["commit", "-m", "chore(release): dedupe generated changelog"], cwd });
  run({ command: "git", args: ["push", "origin", `HEAD:refs/heads/${pullRequest.headBranchName}`], cwd });
};

export const main = (): void => {
  const cwd = process.cwd();
  const repository = requireRepository();
  for (const pullRequest of releasePullRequests()) {
    dedupePullRequest({ pullRequest, repository, cwd });
  }
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
