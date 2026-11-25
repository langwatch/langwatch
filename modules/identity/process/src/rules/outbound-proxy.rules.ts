/** The reasons both SSO fetches give when the deployment's own outbound proxy failed. */
export const OUTBOUND_PROXY_REASONS = {
  misconfigured: "proxy_misconfigured",
  unreachable: "proxy_unreachable",
} as const;

const PROXY_FAULTS: Record<string, string> = {
  [OUTBOUND_PROXY_REASONS.misconfigured]: "the outbound proxy setting is not a valid proxy URL",
  [OUTBOUND_PROXY_REASONS.unreachable]:
    "the outbound proxy could not be reached or refused the request",
};

/** Why `attempt` failed, blaming the deployment's proxy when the proxy was at fault. */
export function unreachableDetail({
  attempt,
  reason,
}: {
  attempt: string;
  reason: string;
}): string {
  const proxyFault = PROXY_FAULTS[reason];
  return proxyFault
    ? `${proxyFault}, so ${attempt} did not happen`
    : `${attempt} failed: ${reason}`;
}
