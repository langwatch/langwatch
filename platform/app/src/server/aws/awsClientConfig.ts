import { fromTemporaryCredentials } from "@aws-sdk/credential-providers";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { HttpsProxyAgent } from "https-proxy-agent";
import { hostnameOf, resolveProxyForHost } from "../outboundProxy";

/**
 * The one place an AWS SDK client is configured.
 *
 * Every AWS client we build wants the same things right, and each of them
 * has been wrong at least once:
 *
 * 1. **Credentials are omitted, not emptied.** Handing the SDK a
 *    `credentials` object built from unset environment variables produces
 *    `{ accessKeyId: "", secretAccessKey: "" }`, which the SDK treats as a
 *    real answer and stops looking. That is what broke IRSA on EKS: the pod
 *    had a role, and we told the SDK we had keys. Credentials are set ONLY
 *    when a complete pair is present and non-empty; otherwise the field is
 *    absent and the default chain (IRSA, instance profile, SSO) runs.
 * 2. **Retries belong to whoever counts them.** A caller sitting behind a
 *    retry ladder asks for `maxAttempts: 1`, because SDK-internal retries
 *    are invisible to the ladder and one recorded attempt would secretly be
 *    three. A caller with no ladder above it leaves the SDK's retries on.
 * 3. **The proxy is wired in.** The SDK ignores `HTTPS_PROXY` unless it is
 *    handed a request handler that dials through it.
 * 4. **One socket pool per proxy.** A `NodeHttpHandler` owns an agent, so
 *    building one per call accumulates pools and file descriptors. They are
 *    cached by proxy URL here, which is also what lets SES and SQS share
 *    one.
 * 5. **Every request is bounded.** `@smithy/node-http-handler` reads 0 as "no
 *    timeout", and 0 is its default. A caller that also turned the SDK's
 *    retries off has nothing left to end a request a silent proxy or a
 *    half-open socket never answers, so the timeouts are set here rather than
 *    left to each client.
 */

/**
 * How long one AWS request may take. The connection budget is short because
 * failing to connect is a fast, local answer; the request budget covers a
 * queue or a mail send under load without letting one hang a delivery worker.
 */
const CONNECTION_TIMEOUT_MS = 5_000;
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * A handler owns a socket pool, so building one per client would accumulate
 * pools and file descriptors under a burst. They are keyed by proxy URL and
 * reused; the set of distinct URLs in a process is effectively one, and the
 * empty key is the direct, unproxied handler.
 */
const requestHandlers = new Map<string, NodeHttpHandler>();

/** The direct path has no proxy URL to key on, and one shared pool is the
 *  same arrangement the proxied path already has. */
const DIRECT_HANDLER_KEY = "";

export function awsRequestHandler(proxyUrl?: string | null): NodeHttpHandler {
  const key = proxyUrl ?? DIRECT_HANDLER_KEY;
  const cached = requestHandlers.get(key);
  if (cached) return cached;

  const agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;
  const handler = new NodeHttpHandler({
    ...(agent ? { httpAgent: agent, httpsAgent: agent } : {}),
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    requestTimeout: REQUEST_TIMEOUT_MS,
  });
  requestHandlers.set(key, handler);
  return handler;
}

/** Static credentials, as a caller holds them before they are validated. */
export interface StaticAwsCredentials {
  accessKeyId?: string | null;
  secretAccessKey?: string | null;
  sessionToken?: string | null;
}

/** A complete static pair, in the shape the SDK accepts. */
export interface AwsStaticCredentialIdentity {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

/**
 * Assume-role credentials: the role we ask to become, and the ExternalId
 * that proves the request came from us rather than from anyone who learned
 * the role's name.
 */
export interface AssumeRoleCredentials {
  roleArn: string;
  externalId?: string | null;
  sessionName?: string;
  durationSeconds?: number;
}

export interface AwsClientConfigInput {
  /** Absent is legitimate: the SDK then resolves the region itself, from
   *  AWS_REGION or the shared config file. */
  region?: string;
  /** The host or endpoint URL the client will dial, so the proxy bypass
   *  rules can be applied to the right name. */
  targetHost: string;
  /** A non-default endpoint (a VPC endpoint, or a local emulator). */
  endpoint?: string | null;
  staticCredentials?: StaticAwsCredentials | null;
  assumeRole?: AssumeRoleCredentials | null;
  /** Turn the SDK's own retry loop off. Callers behind a retry ladder that
   *  counts attempts pass true; everyone else leaves the SDK retrying. */
  disableSdkRetries?: boolean;
}

/**
 * The subset of an AWS SDK client config this module owns. Every v3 client
 * config is a superset of it, so a caller spreads the result and adds
 * whatever else its service needs.
 */
export interface AwsClientConfig {
  region?: string;
  credentials?: AwsStaticCredentialIdentity | ReturnType<typeof fromTemporaryCredentials>;
  endpoint?: string;
  /** Always set, so no client falls back to the SDK's own handler and its
   *  unbounded timeouts. */
  requestHandler: NodeHttpHandler;
  maxAttempts?: number;
}

/**
 * A value is usable as half of a credential pair only if it is a non-empty
 * string. `""` is what an unset environment variable reads as, and it is the
 * value that made the SDK stop looking.
 */
function present(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Static credentials as the SDK wants them, or undefined when the pair is
 * incomplete. Never a half-filled object: see rule 1 above.
 */
export function staticCredentialsOrUndefined(
  credentials: StaticAwsCredentials | null | undefined,
): AwsStaticCredentialIdentity | undefined {
  if (!credentials) return undefined;
  const { accessKeyId, secretAccessKey, sessionToken } = credentials;
  if (!present(accessKeyId) || !present(secretAccessKey)) return undefined;
  return {
    accessKeyId: accessKeyId.trim(),
    secretAccessKey: secretAccessKey.trim(),
    ...(present(sessionToken) ? { sessionToken: sessionToken.trim() } : {}),
  };
}

/** How long an assumed session lasts before the provider refreshes it. */
const DEFAULT_ASSUME_ROLE_DURATION_SECONDS = 900;

/**
 * The credentials field, or undefined so the default chain runs.
 *
 * Undefined is the important case: an omitted field is what lets IRSA, an
 * instance profile or an SSO session answer. An empty object would stop the
 * search with an answer of "" and fail.
 */
function resolveCredentials({
  region,
  staticCredentials,
  assumeRole,
}: Pick<
  AwsClientConfigInput,
  "region" | "staticCredentials" | "assumeRole"
>): AwsClientConfig["credentials"] {
  const staticIdentity = staticCredentialsOrUndefined(staticCredentials);
  if (!assumeRole) return staticIdentity;
  // The STS call is a second request to a second host, and it gets the same
  // treatment as the first: through the proxy if there is one, and bounded.
  // Without this the AssumeRole leg was the one unbounded request left, and it
  // runs before every delivery on a cold client.
  //
  // The China partition serves STS under .amazonaws.com.cn, and this name is
  // only ever handed to the proxy resolver: spelling it the other way would
  // ask the bypass rules about a host that does not exist, and the STS leg
  // would take the opposite proxy decision from the service leg.
  const stsHost = present(region)
    ? `sts.${region}.amazonaws.com${region.startsWith("cn-") ? ".cn" : ""}`
    : "sts.amazonaws.com";
  // The role is assumed WITH whatever the outer credentials are, so a static
  // pair here means "these keys may assume that role"; absent, the
  // deployment's own identity does the assuming.
  return fromTemporaryCredentials({
    params: {
      RoleArn: assumeRole.roleArn,
      RoleSessionName: assumeRole.sessionName ?? "langwatch",
      ...(present(assumeRole.externalId) ? { ExternalId: assumeRole.externalId } : {}),
      DurationSeconds: assumeRole.durationSeconds ?? DEFAULT_ASSUME_ROLE_DURATION_SECONDS,
    },
    clientConfig: {
      ...(present(region) ? { region } : {}),
      requestHandler: awsRequestHandler(resolveProxyForHost(stsHost)),
    },
    ...(staticIdentity ? { masterCredentials: staticIdentity } : {}),
  });
}

export function buildAwsClientConfig({
  region,
  targetHost,
  endpoint,
  staticCredentials,
  assumeRole,
  disableSdkRetries = false,
}: AwsClientConfigInput): AwsClientConfig {
  const config: AwsClientConfig = {
    requestHandler: awsRequestHandler(resolveProxyForHost(hostnameOf(targetHost))),
  };

  if (present(region)) config.region = region;
  if (present(endpoint)) config.endpoint = endpoint;
  if (disableSdkRetries) config.maxAttempts = 1;

  const credentials = resolveCredentials({
    region,
    staticCredentials,
    assumeRole,
  });
  if (credentials) config.credentials = credentials;

  return config;
}
