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
 * An empty change set is neither: with nothing to inspect there is nothing to
 * base an exemption on, so it falls through to requiring the writeup rather
 * than passing vacuously.
 */
export const classify = (files: readonly string[]): Classification => {
  const paths = files.map((f) => f.trim()).filter((f) => f !== "");
  if (paths.length === 0) return { onlyLockfiles: false, onlyManifests: false };

  const kinds = paths.map(kindOf);
  return {
    onlyLockfiles: kinds.every((k) => k === "lockfile"),
    onlyManifests: kinds.every((k) => k === "lockfile" || k === "manifest"),
  };
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
  const author = process.env.PR_AUTHOR ?? "";
  const files = (process.env.CHANGED_FILES ?? "").split("\n");
  const outputs = main({ files, author });
  for (const line of outputs) console.log(line);
}
