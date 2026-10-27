/**
 * The rate-limit bucket a legacy token check is counted in: the address the door resolved for
 * the request, never a forwarding header. An unresolved caller shares the one unknown bucket.
 */
export function callerKeyOf(callerAddress: string | null): string {
  return `ip:${callerAddress ?? "unknown"}`;
}
