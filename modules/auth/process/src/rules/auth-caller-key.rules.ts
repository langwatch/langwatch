/**
 * The rate-limit bucket a legacy token check is counted in: the LAST `x-forwarded-for` hop,
 * the only one the caller did not write.
 */
export function callerKeyOf(forwardedFor: string | undefined): string {
  const hops = forwardedFor?.split(",") ?? [];
  const nearest = hops[hops.length - 1]?.trim();

  return `ip:${nearest ?? "unknown"}`;
}
