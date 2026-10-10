/**
 * Compare two dotted version strings: negative when `version` is older than `against`, zero
 * when they name the same release, positive when it is newer.
 */

/**
 * A numeric triple comparison: a missing component reads as zero (`1.2` == `1.2.0`), and a
 * suffix reads as its leading digits (`2.0.0-rc.1` sorts with `2.0.0`). Callers needing to
 * reject unparseable input check its shape first; this just returns an ordering.
 */
export function compareVersions({
  version,
  against,
}: {
  version: string;
  against: string;
}): number {
  const left = version.split(".");
  const right = against.split(".");
  for (let index = 0; index < 3; index++) {
    const difference = component(left[index]) - component(right[index]);
    if (difference !== 0) return difference;
  }
  return 0;
}

function component(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}
