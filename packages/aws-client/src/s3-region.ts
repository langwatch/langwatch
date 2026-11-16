// One region rule for every S3 client: a named region wins (a named "auto" counts as unnamed),
// a non-AWS endpoint signs with "auto", a regional AWS host names its own region (s3[-fips]
// [.dualstack].REGION, PrivateLink *.s3.REGION.vpce), and anything else is left to the SDK
// chain (AWS_REGION), or with s3RegionFor to the bucket's own region. AWS never sees "auto".
// Hosts: docs.aws.amazon.com/general/latest/gr/s3.html
import {
  loadConfig,
  NODE_REGION_CONFIG_FILE_OPTIONS,
  NODE_REGION_CONFIG_OPTIONS,
} from "@smithy/core/config";

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

/** What AWS says about a bucket's home: its region, that it does not exist, or nothing usable. */
export type S3BucketRegionAnswer =
  | { kind: "found"; region: string }
  | { kind: "missing" }
  | { kind: "unknown" };

/** AWS answered that the bucket does not exist. */
export class S3BucketNotFoundError extends Error {
  readonly code = "s3_bucket_not_found";

  constructor(bucket: string) {
    super(`S3 bucket "${bucket}" does not exist. Check S3_BUCKET_NAME.`);
    this.name = "S3BucketNotFoundError";
  }
}

/** No setting names the region and AWS could not be asked where the bucket lives. */
export class S3RegionNotFoundError extends Error {
  readonly code = "s3_region_not_found";

  constructor(bucket: string) {
    super(
      `Could not find the AWS region of S3 bucket "${bucket}". Set S3_REGION ` +
        "(Helm: app.dataplane.providers.awsS3.region) to the bucket's region.",
    );
    this.name = "S3RegionNotFoundError";
  }
}

/** A failed lookup is answered from memory this long, so an outage is not a question per call. */
const REGION_RETRY_AFTER_MS = 30_000;

/**
 * The region for an S3 client that knows its bucket: the shared rule's answer when it has one,
 * else a provider that tries AWS_REGION or the profile, then asks AWS where the bucket lives
 * (tasks#1192). One lookup is shared by concurrent calls and kept; a failure is retried later.
 */
export function s3RegionFor({
  region,
  endpoint,
  bucket,
  askBucket,
  configured = configuredRegion,
  now = Date.now,
}: {
  region?: string;
  endpoint?: string;
  bucket: string;
  askBucket: () => Promise<S3BucketRegionAnswer>;
  configured?: () => Promise<string | undefined>;
  now?: () => number;
}): string | (() => Promise<string>) {
  const named = s3RegionOf({ region, endpoint });
  if (named !== undefined) return named;

  let known: string | undefined;
  let pending: Promise<string> | undefined;
  let failure: { error: Error; at: number } | undefined;

  const lookUp = async (): Promise<string> => {
    const fromSetting = await configured();
    if (fromSetting) return fromSetting;
    const answer = await askBucket().catch((): S3BucketRegionAnswer => ({ kind: "unknown" }));
    if (answer.kind === "found") return answer.region;
    throw answer.kind === "missing"
      ? new S3BucketNotFoundError(bucket)
      : new S3RegionNotFoundError(bucket);
  };

  return async () => {
    if (known !== undefined) return known;
    if (failure && now() - failure.at < REGION_RETRY_AFTER_MS) throw failure.error;
    pending ??= lookUp().then(
      (found) => {
        known = found;
        return found;
      },
      (error: Error) => {
        failure = { error, at: now() };
        throw error;
      },
    );
    try {
      return await pending;
    } finally {
      pending = undefined;
    }
  };
}

/**
 * AWS_REGION or the profile's region, as the SDK reads them; undefined when neither names one.
 * Never the EC2 host's own region from instance metadata: the bucket may live elsewhere.
 */
async function configuredRegion(): Promise<string | undefined> {
  try {
    const region = await loadConfig(
      { ...NODE_REGION_CONFIG_OPTIONS, default: () => undefined },
      NODE_REGION_CONFIG_FILE_OPTIONS,
    )();
    return region?.trim() || undefined;
  } catch {
    return undefined;
  }
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
