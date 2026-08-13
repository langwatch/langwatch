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

/**
 * A pin used to exempt a component here. It no longer does, and #4998 is why:
 * `Release-As:` overrides the version and nothing else, so a pinned component
 * still takes the other component's `BREAKING CHANGE:` note into its own
 * changelog. That pull request pinned the platform to 3.13.0 and the Go SDK's
 * two breaks were still filed under the platform's release.
 *
 * Squash is this repository's only merge method, so the per-component pin
 * commits the old procedure asked for collapse into one commit whose body is
 * every branch commit's body concatenated. #4998 came out of that with two
 * competing `Release-As:` footers at lines 353 and 372 of a 402-line body, and
 * the platform's did not apply — it released 4.0.0, not the 3.13.0 it asked
 * for. One message cannot carry one pin per component, however the parser
 * resolves the collision, so splitting is what actually scopes a break.
 */
const reportPinsDoNotExempt = (pins: ComponentPin[]): void => {
  const pinned = pins.filter((pin) => pin.pinned !== undefined);
  if (pinned.length === 0) return;

  console.error("A pin does not exempt a component from this check.");
  console.error("`Release-As:` fixes the version and nothing else, so these");
  console.error("still take the break into their own changelog:");
  console.error("");
  for (const pin of pinned) {
    console.error(`- ${pin.component.name}, pinned to ${pin.pinned}`);
  }
  console.error("");
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
  console.error("commit touched, so the break reaches every one of these:");
  console.error("");
  for (const pin of pins) {
    const current = versions[pin.component.path] ?? "unknown";
    const pinned = pin.pinned === undefined ? "" : `, pinned to ${pin.pinned}`;
    console.error(
      `- ${pin.component.name} (${pin.component.path}), now ${current}${pinned}`,
    );
  }
  console.error("");
  reportPinsDoNotExempt(pins);
  reportHalfDonePins({ pins, footerVersions });
  console.error("If the break really does apply to all of them, add the");
  console.error(`\`${acknowledgementLabel}\` label and this check passes.`);
  console.error("");
  console.error("Otherwise split the change so the breaking commit touches");
  console.error("one component. Land the incidental part as its own");
  console.error("non-breaking pull request. That is the only thing that keeps");
  console.error("one component's break out of another's release entirely.");
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

  // Pins are still read, but only to report them. They stopped being an
  // exemption: see reportPinsDoNotExempt. More than one bumped component with a
  // breaking marker fails, and the `multi-component-major` label — checked by
  // the workflow before this script runs — is the only way past it.
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
