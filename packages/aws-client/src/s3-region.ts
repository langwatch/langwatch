// One region rule for every S3 client: a named region wins (a named "auto" counts as unnamed),
// a non-AWS endpoint signs with "auto", a regional AWS host names its own region (s3[-fips]
// [.dualstack].REGION, PrivateLink *.s3.REGION.vpce), and anything else is left to the SDK
// chain (AWS_REGION). AWS never sees "auto". Hosts: docs.aws.amazon.com/general/latest/gr/s3.html
const REGIONAL_AWS_S3_HOST =
  /(?:^|\.)s3(?:-fips)?[.-](?:dualstack\.|fips\.)?([a-z]{2}(?:-[a-z]+)+-\d+)(?:\.vpce)?\.amazonaws\.com(?:\.cn)?$/;

export function s3RegionOf({
  region,
  endpoint,
}: {
  region?: string;
  endpoint?: string;
}): string | undefined {
  const named = region?.trim();
  if (named && named.toLowerCase() !== "auto") return named;
  const given = endpoint?.trim();
  if (!given) return undefined;
  const hostname = hostnameOf(given);
  // An endpoint that does not parse is not an AWS host, so it signs as S3-compatible.
  if (hostname === undefined || !isAwsHostname(hostname)) return "auto";
  return REGIONAL_AWS_S3_HOST.exec(hostname)?.[1];
}

/** The host an SDK client with no custom endpoint talks to. */
export function defaultS3Host(region: string | undefined): string {
  if (!region || region === "auto") return "s3.amazonaws.com";
  const suffix = region.startsWith("cn-") ? ".amazonaws.com.cn" : ".amazonaws.com";
  return `s3.${region}${suffix}`;
}

function isAwsHostname(hostname: string): boolean {
  return hostname.endsWith(".amazonaws.com") || hostname.endsWith(".amazonaws.com.cn");
}

/** Reads the hostname, so a path, port or missing scheme still counts; undefined if unparseable. */
function hostnameOf(endpoint: string): string | undefined {
  try {
    const url = new URL(endpoint.includes("://") ? endpoint : `https://${endpoint}`);
    return url.hostname.toLowerCase();
  } catch {
    return undefined;
  }
}
