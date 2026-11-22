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
  | { kind: "unknown"; cause?: unknown };

/** AWS's us-east-1 endpoint knows no such bucket: a wrong name, or one in GovCloud or China. */
export class S3BucketNotFoundError extends Error {
  readonly code = "s3_bucket_not_found";

  constructor(bucket: string) {
    super(
      `AWS found no S3 bucket "${bucket}". Check S3_BUCKET_NAME; a GovCloud or China bucket ` +
        "also needs S3_REGION (Helm: app.dataplane.providers.awsS3.region).",
    );
    this.name = "S3BucketNotFoundError";
  }
}

/** No setting names the region and AWS could not be asked where the bucket lives. */
export class S3RegionNotFoundError extends Error {
  readonly code = "s3_region_not_found";

  constructor(bucket: string, options?: { cause?: unknown }) {
    super(
      `Could not find the AWS region of S3 bucket "${bucket}". Set S3_REGION ` +
        "(Helm: app.dataplane.providers.awsS3.region) to the bucket's region.",
      options,
    );
    this.name = "S3RegionNotFoundError";
  }
}

/** A failed lookup is answered from memory this long, so an outage is not a question per call. */
const REGION_RETRY_AFTER_MS = 30_000;

/**
 * The region for an S3 client that knows its bucket: the shared rule's answer, else AWS_REGION or
 * the profile, then the bucket's own region (kept), then the EC2 host's (tasks#1192). One lookup
 * is shared; the host's region and a failure last only until the next try.
 */
export function s3RegionFor({
  region,
  endpoint,
  bucket,
  askBucket,
  configured = configuredRegion,
  hostRegion = instanceRegion,
  now = Date.now,
}: {
  region?: string;
  endpoint?: string;
  bucket: string;
  askBucket: () => Promise<S3BucketRegionAnswer>;
  configured?: () => Promise<string | undefined>;
  hostRegion?: () => Promise<string | undefined>;
  now?: () => number;
}): string | (() => Promise<string>) {
  const named = s3RegionOf({ region, endpoint });
  if (named !== undefined) return named;
  return remembered({
    now,
    lookUp: () => lookUpRegion({ bucket, askBucket, configured, hostRegion }),
  });
}

/** A region and whether it is the bucket's own (kept) or a stand-in until the next try. */
type FoundRegion = { region: string; lasting: boolean };

async function lookUpRegion({
  bucket,
  askBucket,
  configured,
  hostRegion,
}: {
  bucket: string;
  askBucket: () => Promise<S3BucketRegionAnswer>;
  configured: () => Promise<string | undefined>;
  hostRegion: () => Promise<string | undefined>;
}): Promise<FoundRegion> {
  const fromSetting = await configured();
  if (fromSetting) return { region: fromSetting, lasting: true };
  const answer = await askBucket().catch((cause: unknown): S3BucketRegionAnswer => ({
    kind: "unknown",
    cause,
  }));
  if (answer.kind === "found") return { region: answer.region, lasting: true };
  if (answer.kind === "missing") throw new S3BucketNotFoundError(bucket);
  const fromHost = await hostRegion();
  if (fromHost) return { region: fromHost, lasting: false };
  throw new S3RegionNotFoundError(bucket, { cause: answer.cause });
}

/** Shares one lookup between concurrent calls; keeps a lasting region, the rest for a pause. */
function remembered({
  lookUp,
  now,
}: {
  lookUp: () => Promise<FoundRegion>;
  now: () => number;
}): () => Promise<string> {
  let known: string | undefined;
  let standIn: { region: string; at: number } | undefined;
  let failure: { error: unknown; at: number } | undefined;
  let pending: Promise<string> | undefined;
  const recent = (at: number) => now() - at < REGION_RETRY_AFTER_MS;

  const settle = async (): Promise<string> => {
    try {
      const { region, lasting } = await lookUp();
      if (lasting) known = region;
      else standIn = { region, at: now() };
      return region;
    } catch (error) {
      failure = { error, at: now() };
      throw error;
    }
  };

  return async () => {
    if (known !== undefined) return known;
    if (standIn && recent(standIn.at)) return standIn.region;
    if (failure && recent(failure.at)) throw failure.error;
    pending ??= settle().finally(() => {
      pending = undefined;
    });
    return pending;
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

/** The EC2 host's region from instance metadata: the last resort, as the SDK used it before. */
async function instanceRegion(): Promise<string | undefined> {
  try {
    const fallback = NODE_REGION_CONFIG_OPTIONS.default;
    const region = typeof fallback === "function" ? await fallback() : fallback;
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
