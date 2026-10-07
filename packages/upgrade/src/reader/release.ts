export type ReleaseOrder = "newer" | "older" | "same" | "unknown";

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

interface ParsedRelease {
  core: [number, number, number];
  pre: string[];
}

function parseRelease({ release }: { release: string }): ParsedRelease | null {
  const match = VERSION.exec(release);
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] ? match[4].split(".") : [],
  };
}

function comparePreIdentifier({ left, right }: { left: string; right: string }): number {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric && rightNumeric) return Math.sign(Number(left) - Number(right));
  if (leftNumeric) return -1;
  if (rightNumeric) return 1;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareParsed({ left, right }: { left: ParsedRelease; right: ParsedRelease }): number {
  for (let index = 0; index < 3; index++) {
    const difference = (left.core[index] ?? 0) - (right.core[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  if (left.pre.length === 0 || right.pre.length === 0) {
    return Math.sign(right.pre.length - left.pre.length);
  }
  const shared = Math.min(left.pre.length, right.pre.length);
  for (let index = 0; index < shared; index++) {
    const order = comparePreIdentifier({
      left: left.pre[index] ?? "",
      right: right.pre[index] ?? "",
    });
    if (order !== 0) return order;
  }
  return Math.sign(left.pre.length - right.pre.length);
}

/**
 * Orders two releases by version. A build that is not a version (a cloud `git-<sha>`) is never
 * ordered against anything: only equal strings are `same`, every other pairing is `unknown`.
 */
export function compareReleases({ left, right }: { left: string; right: string }): ReleaseOrder {
  const parsedLeft = parseRelease({ release: left });
  const parsedRight = parseRelease({ release: right });
  if (!parsedLeft || !parsedRight) return left === right ? "same" : "unknown";
  const order = compareParsed({ left: parsedLeft, right: parsedRight });
  if (order > 0) return "newer";
  return order < 0 ? "older" : "same";
}

/** The highest of the releases that can be ordered; an unorderable one is never the highest. */
export function pickHighestRelease({ releases }: { releases: readonly string[] }): string | null {
  let highest: string | null = null;
  for (const release of releases) {
    if (!parseRelease({ release })) continue;
    if (highest === null || compareReleases({ left: release, right: highest }) === "newer") {
      highest = release;
    }
  }
  return highest;
}

/** Newest first; a version outranks a non-version, non-versions fall back to descending text. */
export function compareReleasesNewestFirst({
  left,
  right,
}: {
  left: string | null;
  right: string | null;
}): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  const parsedLeft = parseRelease({ release: left });
  const parsedRight = parseRelease({ release: right });
  if (parsedLeft && parsedRight) return -compareParsed({ left: parsedLeft, right: parsedRight });
  if (parsedLeft) return -1;
  if (parsedRight) return 1;
  return left < right ? 1 : -1;
}
