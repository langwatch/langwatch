import { fromTemporaryCredentials } from "@aws-sdk/credential-providers";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import type { HttpHandlerOptions, HttpRequest, HttpResponse } from "@smithy/core/protocols";
import { HttpsProxyAgent } from "https-proxy-agent";

export abstract class OutboundProxyResolverPort {
  abstract tryResolveForHost(hostname: string): string | undefined;
}

/** Shared SES/SQS policy: injected proxy routing, bounded pooled handlers, and optional retries. */
const CONNECTION_TIMEOUT_MS = 5_000;
const REQUEST_TIMEOUT_MS = 20_000;

/** The direct route shares one pool alongside the proxy-keyed pools. */
const DIRECT_HANDLER_KEY = "";

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
  requestHandler: AwsClientRequestHandler;
  maxAttempts?: number;
}

/**
 * A client-local view of a process-owned request handler. SDK clients call
 * `destroy()` on their configured handler, but the socket pool belongs to the
 * process configuration and is closed only when that configuration closes.
 */
export interface AwsClientRequestHandler {
  readonly metadata: { handlerProtocol: string };
  destroy(): void;
  handle(request: HttpRequest, options?: HttpHandlerOptions): Promise<{ response: HttpResponse }>;
}

/**
 * A value is usable as half of a credential pair only if it is a non-empty
 * string. `""` is what an unset environment variable reads as, and it is the
 * value that made the SDK stop looking.
 */
function present(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function hostnameOf(value: string): string {
  try {
    const hostname = new URL(value).hostname;
    if (hostname) return hostname;
  } catch {
    // A bare hostname is a valid target for an AWS client.
  }
  const withoutScheme = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const hostPort = withoutScheme.split("/")[0] ?? "";
  return hostPort.replace(/:\d+$/, "") || value;
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

export class AwsClientConfiguration {
  static create(options: { outboundProxy: OutboundProxyResolverPort }): AwsClientConfiguration {
    return new AwsClientConfiguration(options.outboundProxy);
  }

  private readonly requestHandlers = new AwsRequestHandlerPool();

  private readonly transport: AwsTransportPolicy;

  private closePromise: Promise<void> | undefined;

  private constructor(outboundProxy: OutboundProxyResolverPort) {
    this.transport = new AwsTransportPolicy(outboundProxy, this.requestHandlers);
  }

  build(input: AwsClientConfigInput): AwsClientConfig {
    if (this.closePromise) {
      throw new Error("AwsClientConfiguration is closed");
    }

    return this.transport.build(input);
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;

    this.closePromise = this.requestHandlers.close();
    return this.closePromise;
  }
}

class AwsRequestHandlerPool {
  private readonly handlers = new Map<string, PooledAwsRequestHandler>();

  borrowForProxy(proxyUrl?: string | null): AwsClientRequestHandler {
    return this.handlerForProxy(proxyUrl).borrow();
  }

  private handlerForProxy(proxyUrl?: string | null): PooledAwsRequestHandler {
    const key = proxyUrl ?? DIRECT_HANDLER_KEY;
    const cached = this.handlers.get(key);
    if (cached) return cached;
    const agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;
    const handler = new PooledAwsRequestHandler(
      new NodeHttpHandler({
        ...(agent ? { httpAgent: agent, httpsAgent: agent } : {}),
        connectionTimeout: CONNECTION_TIMEOUT_MS,
        requestTimeout: REQUEST_TIMEOUT_MS,
      }),
    );
    this.handlers.set(key, handler);
    return handler;
  }

  close(): Promise<void> {
    const handlers = [...this.handlers.values()];
    this.handlers.clear();
    return Promise.all(handlers.map((handler) => handler.close())).then(() => void 0);
  }
}

/**
 * The AWS SDK owns its client objects, but not this process's socket pool.
 * Forward requests to the pooled handler while making client-local destruction
 * harmless; `AwsRequestHandlerPool.close()` performs the real destruction.
 */
class PooledAwsRequestHandler {
  private activeRequests = 0;
  private closePromise: Promise<void> | undefined;
  private settleActiveRequests: (() => void) | undefined;

  constructor(private readonly handler: NodeHttpHandler) {}

  borrow(): AwsClientRequestHandler {
    return new BorrowedAwsRequestHandler(this);
  }

  async handle(
    request: HttpRequest,
    options?: HttpHandlerOptions,
  ): Promise<{ response: HttpResponse }> {
    if (this.closePromise) {
      throw new Error("AWS request handler is closing");
    }

    this.activeRequests += 1;
    try {
      return await this.handler.handle(request, options);
    } finally {
      this.activeRequests -= 1;
      if (this.activeRequests === 0) this.settleActiveRequests?.();
    }
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeOnce();
    return this.closePromise;
  }

  private async closeOnce(): Promise<void> {
    if (this.activeRequests > 0) {
      await new Promise<void>((resolve) => {
        this.settleActiveRequests = resolve;
      });
    }
    this.handler.destroy();
  }

  get metadata(): { handlerProtocol: string } {
    return this.handler.metadata;
  }
}

class BorrowedAwsRequestHandler implements AwsClientRequestHandler {
  readonly metadata: { handlerProtocol: string };

  constructor(private readonly handler: PooledAwsRequestHandler) {
    this.metadata = handler.metadata;
  }

  destroy(): void {}

  handle(request: HttpRequest, options?: HttpHandlerOptions): Promise<{ response: HttpResponse }> {
    return this.handler.handle(request, options);
  }
}

class AwsTransportPolicy {
  constructor(
    private readonly outboundProxy: OutboundProxyResolverPort,
    private readonly requestHandlers: AwsRequestHandlerPool,
  ) {}

  build({
    region,
    targetHost,
    endpoint,
    staticCredentials,
    assumeRole,
    disableSdkRetries = false,
  }: AwsClientConfigInput): AwsClientConfig {
    const config: AwsClientConfig = {
      requestHandler: this.requestHandlerForHost(hostnameOf(targetHost)),
    };

    if (present(region)) config.region = region;
    if (present(endpoint)) config.endpoint = endpoint;
    if (disableSdkRetries) config.maxAttempts = 1;

    const credentials = resolveCredentials(
      {
        region,
        staticCredentials,
        assumeRole,
      },
      this,
    );
    if (credentials) config.credentials = credentials;

    return config;
  }

  requestHandlerForHost(hostname: string): AwsClientRequestHandler {
    return this.requestHandlers.borrowForProxy(this.outboundProxy.tryResolveForHost(hostname));
  }
}

/**
 * The credentials field, or undefined so the default chain runs.
 *
 * Undefined is the important case: an omitted field is what lets IRSA, an
 * instance profile or an SSO session answer. An empty object would stop the
 * search with an answer of "" and fail.
 */
function resolveCredentials(
  {
    region,
    staticCredentials,
    assumeRole,
  }: Pick<AwsClientConfigInput, "region" | "staticCredentials" | "assumeRole">,
  transport: AwsTransportPolicy,
): AwsClientConfig["credentials"] {
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
      requestHandler: transport.requestHandlerForHost(stsHost),
    },
    ...(staticIdentity ? { masterCredentials: staticIdentity } : {}),
  });
}
