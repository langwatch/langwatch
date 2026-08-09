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

// A pin is the remediation this guard prints: one commit per component that
// edits only that component's shim and carries one `Release-As:` footer.
// release-please reads the footer per commit and routes it by the paths that
// commit touched, so the shim edit and the footer are one mechanism. The guard
// sees files per pull request rather than per commit, so it binds the two by
// version: the footer has to name the version the shim records.
const releaseAsPattern = /^[ \t]*Release-As:[ \t]*v?(\S+)[ \t]*$/gim;
const shimNextPattern = /next:[ \t]*v?(\S+)/i;

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

export const shimPath = (component: ReleaseComponent): string =>
  component.path === rootPath
    ? ".release-please-shim"
    : `${component.path}/.release-please-shim`;

/** Every `Release-As:` footer version the pull request carries, in order. */
export const releaseAsVersions = (messages: string[]): string[] =>
  messages.flatMap((message) =>
    [...message.matchAll(releaseAsPattern)]
      .map((match) => match[1])
      .filter((version): version is string => version !== undefined),
  );

/** The version a shim records for its component, written as `next: <x.y.z>`. */
export const shimVersion = (content: string): string | undefined =>
  shimNextPattern.exec(content)?.[1];

export type ComponentPin = {
  component: ReleaseComponent;
  /** The one file a pin for this component has to touch. */
  shim: string;
  /** Whether the pull request changes that shim. */
  shimChanged: boolean;
  /** Version the shim records at the pull request head, when it is readable. */
  recorded?: string;
  /** Version a footer confirms, which is what exempts the component. */
  pinned?: string;
};

/**
 * A component counts as pinned only with both halves in place. A shim edit
 * alone moves nothing, since release-please reads the version off the footer;
 * a footer alone cannot be attributed to a component, since only the paths a
 * commit touched route it. The version recorded in the shim binds them.
 */
export const componentPins = ({
  components,
  files,
  footerVersions,
  readShim,
}: {
  components: ReleaseComponent[];
  files: string[];
  footerVersions: string[];
  readShim: (path: string) => string | undefined;
}): ComponentPin[] =>
  components.map((component) => {
    const shim = shimPath(component);
    if (!files.includes(shim)) {
      return { component, shim, shimChanged: false };
    }

    const recorded = shimVersion(readShim(shim) ?? "");
    const pinned =
      recorded !== undefined && footerVersions.includes(recorded)
        ? recorded
        : undefined;
    return { component, shim, shimChanged: true, recorded, pinned };
  });

const readLines = (path: string): string[] =>
  readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");

const readJson = <T>(path: string): T =>
  JSON.parse(readFileSync(path, "utf8")) as T;

/**
 * A shim the pull request deletes, or one under a path this checkout does not
 * have, reads as no pin rather than as a crash.
 */
const readShimFile = (path: string): string | undefined => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
};

const unique = (values: string[]): string[] => [...new Set(values)];

/**
 * Says which components the guard let past and at which version, so a passing
 * run still shows what it accepted.
 */
const reportAcceptedPins = (pins: ComponentPin[]): void => {
  for (const pin of pins) {
    if (pin.pinned === undefined) continue;
    console.log(
      `${pin.component.name} pinned to ${pin.pinned} by ${pin.shim}`,
    );
  }
};

/**
 * Names the half of a pin that is missing. A shim edit without its footer is
 * the likeliest way to follow the procedure and still not pin anything, and a
 * footer whose version drifted from the shim looks identical from here.
 */
const reportHalfDonePins = ({
  pins,
  footerVersions,
}: {
  pins: ComponentPin[];
  footerVersions: string[];
}): void => {
  const halfDone = pins.filter(
    (pin) => pin.pinned === undefined && pin.shimChanged,
  );

  if (halfDone.length > 0) {
    console.error("A pin takes both halves: the shim edit, which is what");
    console.error("routes the footer to one component, and a `Release-As:`");
    console.error("footer naming the version that shim records. These have");
    console.error("the shim edit and no footer to go with it:");
    console.error("");
    for (const pin of halfDone) {
      if (pin.recorded === undefined) {
        console.error(`- ${pin.shim} changed but records no`);
        console.error("  `next: <x.y.z>` version, so no footer can bind to it.");
        continue;
      }
      console.error(`- ${pin.shim} records next: ${pin.recorded},`);
      console.error(`  and no commit carries \`Release-As: ${pin.recorded}\`.`);
    }
    if (footerVersions.length > 0) {
      console.error("");
      console.error(
        `Footers on this pull request: ${unique(footerVersions).join(", ")}.`,
      );
    }
    console.error("");
    return;
  }

  if (footerVersions.length > 0 && !pins.some((pin) => pin.shimChanged)) {
    console.error(
      `This pull request carries \`Release-As:\` footers (${unique(footerVersions).join(", ")})`,
    );
    console.error("but changes no shim, so nothing routes them to a");
    console.error("component and every one of them reaches all of them.");
    console.error("");
  }
};

const report = ({
  pins,
  versions,
  footerVersions,
}: {
  pins: ComponentPin[];
  /** Current version per component path, from the release-please manifest. */
  versions: Record<string, string>;
  footerVersions: string[];
}): void => {
  console.error(
    "This pull request carries a breaking-change marker and touches more than",
  );
  console.error("one release component. release-please splits commits by path");
  console.error("but applies the whole commit message to every component the");
  console.error("commit touched, so every one of these that is not pinned");
  console.error("goes to a major:");
  console.error("");
  for (const pin of pins) {
    const current = versions[pin.component.path] ?? "unknown";
    const pinned = pin.pinned === undefined ? "" : `, pinned to ${pin.pinned}`;
    console.error(
      `- ${pin.component.name} (${pin.component.path}), now ${current}${pinned}`,
    );
  }
  console.error("");
  reportHalfDonePins({ pins, footerVersions });
  console.error("If the break really does apply to all of them, add the");
  console.error(`\`${acknowledgementLabel}\` label and this check passes.`);
  console.error("");
  console.error("Otherwise pick one:");
  console.error("");
  console.error("1. Split the change so the breaking commit touches one");
  console.error("   component, which is the cheaper fix before merge.");
  console.error("2. Keep it together and pin the components that must not go");
  console.error("   major. Add a follow-up commit per component that edits");
  console.error("   only that component's shim and carries one footer naming");
  console.error("   the version that shim records. This check passes once at");
  console.error("   most one bumped component is left unpinned:");
  console.error("");
  for (const pin of pins) {
    if (pin.pinned !== undefined) continue;
    const version = pin.recorded ?? "<x.y.z>";
    console.error(`   ${pin.shim}   +   Release-As: ${version}`);
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

  const footerVersions = releaseAsVersions(messages);
  const pins = componentPins({
    components: bumped,
    files,
    footerVersions,
    readShim: (path) => readShimFile(resolve(repoRoot, path)),
  });
  const unpinned = pins.filter((pin) => pin.pinned === undefined);
  const halfDone = unpinned.filter((pin) => pin.shimChanged);

  // A half-done pin fails even when the count alone would pass: the author meant
  // to pin that component, and it is going major anyway.
  if (halfDone.length === 0 && unpinned.length <= 1) {
    reportAcceptedPins(pins);
    const scope = unpinned[0]?.component.name;
    console.log(
      scope === undefined
        ? "every bumped component is pinned, so none takes an implicit major"
        : `breaking change scoped to ${scope}, every other component pinned`,
    );
    return 0;
  }

  const versions = readJson<Record<string, string>>(
    resolve(repoRoot, manifestFile),
  );
  report({ pins, versions, footerVersions });
  return 1;
};

const isEntrypoint = (): boolean =>
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntrypoint()) {
  process.exitCode = main();
}
