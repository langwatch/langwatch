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
  const hostname = hostnameOf(endpoint?.trim() ?? "");
  if (hostname === undefined) return undefined;
  if (!isAwsHostname(hostname)) return "auto";
  return REGIONAL_AWS_S3_HOST.exec(hostname)?.[1];
}

/** Reads the hostname, so a path, port or missing scheme still counts as AWS. */
export function isAwsS3Endpoint(endpoint: string): boolean {
  const hostname = hostnameOf(endpoint.trim());
  return hostname !== undefined && isAwsHostname(hostname);
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

function hostnameOf(endpoint: string): string | undefined {
  if (endpoint === "") return undefined;
  try {
    const url = new URL(endpoint.includes("://") ? endpoint : `https://${endpoint}`);
    return url.hostname.toLowerCase();
  } catch {
    return "";
  }
}
