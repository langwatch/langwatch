/**
 * The first name not yet taken: `wanted` itself, then `wanted-2`, `wanted-3`
 * and so on. The gateway tour names the key it mints, and a replay must not
 * mint a second key under the same name.
 *
 * @see specs/features/onboarding/guided-tour.feature
 */
export function freeName({
  wanted,
  taken,
}: {
  wanted: string;
  taken: Iterable<string>;
}): string {
  const used = new Set(taken);
  if (!used.has(wanted)) return wanted;
  for (let n = 2; ; n++) {
    const candidate = `${wanted}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}
