// Decides whether a pull request has to carry a `## Deployment Impact`
// writeup, given the files it changed and who opened it.
//
// The deployment-impact workflow triggers on `charts/**`, `services/**`,
// `dev/docs/adr/**`, `dev/docs/best_practices/**`, `platform/app/.env.example`
// and `docs/self-hosting/**`. Those globs match every dependency bump in
// services/langevals, services/aigateway and services/nlpgo, and every chart's
// Chart.lock — so a routine version bump is asked for a writeup about operator
// impact it does not have.
//
// Two tiers, because the files do not carry the same guarantee:
//
//   Lockfiles (uv.lock, pnpm-lock.yaml, go.sum, Cargo.lock, Chart.lock) are
//   auto-generated resolution snapshots. Nothing hand-edits them, so they
//   cannot add an env var, a helm value, or change what `helm install` does.
//   No deployment surface by construction — exempt no matter who authored the
//   pull request.
//
//   Manifests (pyproject.toml, package.json, go.mod, Cargo.toml,
//   requirements*.txt) are hand-edited. Usually still just a version bump, but
//   a person editing one could add a `postinstall` script or change the build
//   system in the same commit. That weaker exemption therefore holds only for
//   a dependency bot's own pull requests.
//
// Authorship is the PR AUTHOR, never `github.actor`. The workflow triggers on
// `edited` as well as `opened`, so `github.actor` is whoever last touched the
// pull request — a maintainer tidying a dependabot PR's description would flip
// the actor away from the bot and silently withdraw the exemption.
//
// Deliberately dependency-free and run with `node --experimental-strip-types`,
// matching guard-path-filters.ts: there is no install step on the runner.
//
// Spec: specs/ci/deployment-impact-check.feature

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Logins whose pull requests get the hand-edited-manifest exemption. */
export const DEPENDENCY_BOTS: readonly string[] = [
  "dependabot[bot]",
  "renovate[bot]",
];

/** Auto-generated resolution snapshots: no deployment surface by construction. */
const LOCKFILES: readonly string[] = [
  "uv.lock",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "go.sum",
  "Cargo.lock",
  "Chart.lock",
];

/** Hand-edited dependency manifests: a version bump, or something more. */
const MANIFESTS: readonly string[] = [
  "pyproject.toml",
  "package.json",
  "go.mod",
  "Cargo.toml",
];

const basename = (path: string): string => path.split("/").pop() ?? path;

const isRequirementsTxt = (name: string): boolean =>
  name.startsWith("requirements") && name.endsWith(".txt");

export type FileKind = "lockfile" | "manifest" | "other";

/** What a single changed path is, by its file name alone. */
export const kindOf = (path: string): FileKind => {
  const name = basename(path);
  if (LOCKFILES.includes(name)) return "lockfile";
  if (MANIFESTS.includes(name) || isRequirementsTxt(name)) return "manifest";
  return "other";
};

export interface Classification {
  /** Every changed file is an auto-generated lockfile. */
  onlyLockfiles: boolean;
  /** Every changed file is a lockfile or a hand-edited manifest. */
  onlyManifests: boolean;
}

/**
 * Names arrive exactly as the API reported them — no trimming. A path may end
 * in a space, and `"charts/x/Chart.lock "` is a DIFFERENT file from
 * `"charts/x/Chart.lock"`; normalising the two together would let an
 * unrecognised file borrow a lockfile's exemption.
 *
 * An empty change set is neither: with nothing to inspect there is nothing to
 * base an exemption on, so it falls through to requiring the writeup rather
 * than passing vacuously.
 */
export const classify = (files: readonly string[]): Classification => {
  if (files.length === 0) return { onlyLockfiles: false, onlyManifests: false };

  const kinds = files.map(kindOf);
  return {
    onlyLockfiles: kinds.every((k) => k === "lockfile"),
    onlyManifests: kinds.every((k) => k === "lockfile" || k === "manifest"),
  };
};

/**
 * Filenames out of `gh api --paginate --slurp`: an array of pages, each an
 * array of file objects. JSON rather than newline-delimited text because a
 * path may legally contain a newline, and line-splitting would turn one such
 * path into two records that classify independently.
 *
 * Fails closed. A guard that cannot read its input must say so rather than
 * wave the pull request through, matching rule R3 in guard-path-filters.ts.
 */
export const parseChangedFiles = (json: string): string[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (cause) {
    throw new Error(`changed-files JSON did not parse: ${String(cause)}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error("changed-files JSON is not an array of pages");
  }

  const entries = parsed.flatMap((page) => (Array.isArray(page) ? page : [page]));
  return entries.map((entry) => {
    const filename = (entry as { filename?: unknown } | null)?.filename;
    if (typeof filename !== "string" || filename === "") {
      throw new Error(
        `changed-files entry has no usable filename: ${JSON.stringify(entry)}`,
      );
    }
    return filename;
  });
};

export const isDependencyBot = (author: string): boolean =>
  DEPENDENCY_BOTS.includes(author);

/** Whether this pull request must carry a `## Deployment Impact` section. */
export const requiresWriteup = ({
  files,
  author,
}: {
  files: readonly string[];
  author: string;
}): boolean => {
  const { onlyLockfiles, onlyManifests } = classify(files);
  if (onlyLockfiles) return false;
  if (onlyManifests && isDependencyBot(author)) return false;
  return true;
};

export const main = ({
  files,
  author,
}: {
  files: readonly string[];
  author: string;
}): string[] => {
  const { onlyLockfiles, onlyManifests } = classify(files);
  return [
    `only_lockfiles=${onlyLockfiles}`,
    `only_manifests=${onlyManifests}`,
    `requires_writeup=${requiresWriteup({ files, author })}`,
  ];
};

const isEntrypoint = (): boolean =>
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntrypoint()) {
  const path = process.argv[2];
  if (path === undefined) {
    throw new Error(
      "usage: guard-deployment-impact.ts <changed-files.json>  (PR_AUTHOR in env)",
    );
  }
  const files = parseChangedFiles(readFileSync(path, "utf8"));
  const outputs = main({ files, author: process.env.PR_AUTHOR ?? "" });
  for (const line of outputs) console.log(line);
}
