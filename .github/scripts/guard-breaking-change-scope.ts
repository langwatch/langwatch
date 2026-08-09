#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const defaultRepoRoot = ".";
const configFile = ".github/release-please-config.json";
const manifestFile = ".github/.release-please-manifest.json";
const acknowledgementLabel = "multi-component-major";
const rootPath = ".";

// A conventional-commit header marks a break with `!` before the colon; a body
// marks one with a `BREAKING CHANGE:`/`BREAKING-CHANGE:` footer. Squash bodies
// list the branch commits as bullets, so a header can arrive list-prefixed.
const breakingHeaderPattern = /^(?:[*-]\s+)?[a-zA-Z]+(?:\([^)]*\))?!:/m;
const breakingFooterPattern = /^BREAKING[ -]CHANGE:/m;

export type ReleaseComponent = {
  /** Package path as release-please keys it, e.g. `sdks/typescript` or `.`. */
  path: string;
  /** Component name that ends up in the tag and the release PR title. */
  name: string;
  excludePaths: string[];
};

type ReleasePleaseConfig = {
  packages?: Record<
    string,
    { component?: string; "exclude-paths"?: string[] } | undefined
  >;
};

/**
 * release-please matches a file against a package path by directory prefix
 * only, in `util/commit-exclude.ts` and `util/commit-split.ts` alike. The root
 * package is relevant to every file.
 */
const isUnder = (file: string, path: string): boolean =>
  path === rootPath || file.indexOf(`${path}/`) === 0;

export const releaseComponents = (
  config: ReleasePleaseConfig,
): ReleaseComponent[] =>
  Object.entries(config.packages ?? {}).map(([path, packageConfig]) => ({
    path,
    name: packageConfig?.component ?? path,
    excludePaths: (packageConfig?.["exclude-paths"] ?? []).map((excluded) =>
      excluded.replace(/^\/+|\/+$/g, ""),
    ),
  }));

export const carriesBreakingChange = (messages: string[]): boolean =>
  messages.some(
    (message) =>
      breakingHeaderPattern.test(message) || breakingFooterPattern.test(message),
  );

/**
 * A component is bumped when the change touches at least one of its files that
 * no `exclude-paths` entry covers. release-please drops a commit from a
 * component only when *every* touched file of that component is excluded.
 */
const isBumped = (component: ReleaseComponent, files: string[]): boolean => {
  const owned = files.filter((file) => isUnder(file, component.path));
  return (
    owned.length > 0 &&
    !owned.every((file) =>
      component.excludePaths.some((excluded) => isUnder(file, excluded)),
    )
  );
};

/**
 * Non-root packages are matched longest path first so that a nested package
 * wins over its parent, and a file owned by one never counts for another.
 */
export const bumpedComponents = (
  files: string[],
  components: ReleaseComponent[],
): ReleaseComponent[] => {
  const nested = components
    .filter((component) => component.path !== rootPath)
    .sort((a, b) => b.path.length - a.path.length);

  return components.filter((component) => {
    if (component.path === rootPath) {
      return isBumped(component, files);
    }

    const owned = files.filter(
      (file) =>
        nested.find((candidate) => isUnder(file, candidate.path))?.path ===
        component.path,
    );
    return isBumped(component, owned);
  });
};

const shimPath = (component: ReleaseComponent): string =>
  component.path === rootPath
    ? ".release-please-shim"
    : `${component.path}/.release-please-shim`;

const readLines = (path: string): string[] =>
  readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");

const readJson = <T>(path: string): T =>
  JSON.parse(readFileSync(path, "utf8")) as T;

const report = (
  bumped: ReleaseComponent[],
  versions: Record<string, string>,
): void => {
  console.error(
    "This pull request carries a breaking-change marker and touches more than",
  );
  console.error("one release component. release-please splits commits by path");
  console.error("but applies the whole commit message to every component the");
  console.error("commit touched, so all of these go to a major:");
  console.error("");
  for (const component of bumped) {
    const current = versions[component.path] ?? "unknown";
    console.error(`- ${component.name} (${component.path}), now ${current}`);
  }
  console.error("");
  console.error("If the break really does apply to all of them, add the");
  console.error(`\`${acknowledgementLabel}\` label and this check passes.`);
  console.error("");
  console.error("Otherwise pick one:");
  console.error("");
  console.error("1. Split the change so the breaking commit touches one");
  console.error("   component, which is the cheaper fix before merge.");
  console.error("2. Keep it together and pin the components that must not go");
  console.error("   major. Add a follow-up commit per component that edits");
  console.error("   only that component's shim and carries one footer:");
  console.error("");
  for (const component of bumped) {
    console.error(`   ${shimPath(component)}   +   Release-As: <x.y.z>`);
  }
  console.error("");
  console.error("See dev/docs/RELEASES.md for the whole procedure.");
};

const main = (): number => {
  const [repoRootArg, filesArg, messagesArg] = process.argv.slice(2);
  const repoRoot = repoRootArg ?? defaultRepoRoot;
  if (!filesArg || !messagesArg) {
    console.error(
      "usage: guard-breaking-change-scope.ts <repo-root> <changed-files> <commit-messages>",
    );
    return 2;
  }

  const messages = readLines(messagesArg).map(
    (line) => JSON.parse(line) as string,
  );
  if (!carriesBreakingChange(messages)) {
    console.log("no breaking-change marker, release scope check skipped");
    return 0;
  }

  const files = readLines(filesArg);
  const components = releaseComponents(
    readJson<ReleasePleaseConfig>(resolve(repoRoot, configFile)),
  );
  const bumped = bumpedComponents(files, components);

  if (bumped.length <= 1) {
    const scope = bumped[0]?.name ?? "no release component";
    console.log(`breaking change scoped to ${scope}`);
    return 0;
  }

  const versions = readJson<Record<string, string>>(
    resolve(repoRoot, manifestFile),
  );
  report(bumped, versions);
  return 1;
};

const isEntrypoint = (): boolean =>
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntrypoint()) {
  process.exitCode = main();
}
