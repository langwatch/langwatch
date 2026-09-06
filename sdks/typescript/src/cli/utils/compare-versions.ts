/**
 * Compare two dotted version strings: negative when `version` is older than
 * `against`, zero when they name the same release, positive when it is newer.
 *
 * A numeric triple comparison, which is what both callers need and no more. The
 * versions come from our own release tags and from a tool's `--version` output,
 * and both are plain `MAJOR.MINOR.PATCH`. A component that is absent reads as
 * zero, so `1.2` and `1.2.0` are the same release, and a component with a
 * suffix reads as its leading digits, so `2.0.0-rc.1` sorts with `2.0.0` rather
 * than before every release ever cut. Callers that must reject a version they
 * cannot understand check its shape before comparing; this returns an ordering
 * for whatever it is given.
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
