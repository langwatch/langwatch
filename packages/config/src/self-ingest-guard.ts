/**
 * Refusal that keeps a LangWatch process out of its own trace ingest. When `LANGWATCH_API_KEY`
 * and `LANGWATCH_ENDPOINT` point to this deployment, a feedback loop results (ingested spans
 * emit more spans). The refusal is scoped: "the key is set and the endpoint is us".
 */

/**
 * The SDK's default export endpoint. Stated here because an unset endpoint on this deployment
 * points the exporter back at this process (feedback loop).
 */
export const DEFAULT_LANGWATCH_ENDPOINT = "https://app.langwatch.ai";

/**
 * The names one host answers to when a deployment addresses itself. `0.0.0.0`
 * and `::` are bind addresses, not destinations, but a listener bound to
 * every interface is also reachable at `localhost` - the same process.
 */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "::"]);
const LOOPBACK_HOST = "localhost";

/** The suffix every per-worktree haven stack is served under. */
const WORKTREE_SUFFIX = ".langwatch.localhost";

/** How many labels of a worktree hostname identify the stack: `<slug>.langwatch.localhost`. */
const WORKTREE_STACK_LABELS = 1;

/**
 * One address this deployment answers on, and the variable that stated it.
 * `port` is separate since a listener's port is apart from its bind address;
 * when the value carries its own port, that one is used.
 */
export type DeploymentAddress = Readonly<{
  /** The environment variable an operator set, named verbatim in a refusal. */
  env: string;
  /** As read. Blank and absent both mean this deployment did not state it. */
  value: string | undefined;
  /** The listener's port, where it is configured apart from the address. */
  port?: number;
}>;

export type SelfIngestGuardInput = Readonly<{
  /** The process, as its boot log names it: `api`, `worker`. */
  runtime: string;
  /** The variable the key was read from. Its VALUE is never used beyond "set". */
  apiKeyEnv: string;
  apiKey: string | undefined;
  endpointEnv: string;
  endpoint: string | undefined;
  /** Every address this deployment is reachable at, in the order to report. */
  deployment: readonly DeploymentAddress[];
}>;

/**
 * The boot refusal, written for the operator who has to resolve it. Carries
 * the two variables and the collided address as fields, not just prose, so a
 * caller can act without parsing the sentence. No field for the key itself.
 */
export class SelfIngestingObservabilityError extends Error {
  override readonly name = "SelfIngestingObservabilityError";
  readonly runtime: string;
  readonly apiKeyEnv: string;
  readonly endpointEnv: string;
  /** The deployment variable whose address the endpoint resolved onto. */
  readonly matchedEnv: string;
  readonly endpointHost: string;

  constructor(
    input: Readonly<{
      runtime: string;
      apiKeyEnv: string;
      endpointEnv: string;
      matchedEnv: string;
      endpointHost: string;
      /** False when the endpoint came from the SDK default rather than the variable. */
      endpointStated: boolean;
    }>,
  ) {
    const origin = input.endpointStated
      ? `${input.endpointEnv} resolves to ${input.endpointHost}`
      : `${input.endpointEnv} is unset, so the SDK default ${DEFAULT_LANGWATCH_ENDPOINT} applies`;
    super(
      `Refusing to boot the ${input.runtime} process: ${input.apiKeyEnv} is set and ${origin}, ` +
        `which is this deployment's own address (${input.matchedEnv}). The process would export ` +
        `its own telemetry into its own ingest, where every ingested span does work that emits ` +
        `more spans. Point ${input.endpointEnv} at a different LangWatch deployment, or unset ` +
        `${input.apiKeyEnv}.`,
    );
    this.runtime = input.runtime;
    this.apiKeyEnv = input.apiKeyEnv;
    this.endpointEnv = input.endpointEnv;
    this.matchedEnv = input.matchedEnv;
    this.endpointHost = input.endpointHost;
  }
}

/**
 * Refuses a configuration whose telemetry exporter points back at this deployment. Three
 * acceptance shapes: no key, endpoint on different host, or endpoint on this host with
 * different port (two instances on one dev machine).
 */
export function assertObservabilityDoesNotSelfIngest(input: SelfIngestGuardInput): void {
  if (!input.apiKey?.trim()) return;

  const stated = input.endpoint?.trim() || undefined;
  const endpoint = parseNetworkAddress(stated ?? DEFAULT_LANGWATCH_ENDPOINT);
  // An endpoint nothing can parse is an endpoint nothing can show to be this
  // deployment. It is the URL schema's refusal to raise, not this one's.
  if (!endpoint) return;

  for (const address of input.deployment) {
    const own = parseNetworkAddress(address.value, address.port);
    if (!own) continue;
    if (!addressesOneDeployment(endpoint, own)) continue;

    throw new SelfIngestingObservabilityError({
      runtime: input.runtime,
      apiKeyEnv: input.apiKeyEnv,
      endpointEnv: input.endpointEnv,
      matchedEnv: address.env,
      endpointHost: endpoint.host,
      endpointStated: stated !== undefined,
    });
  }
}

type NetworkAddress = Readonly<{ host: string; port: number | undefined }>;

/**
 * Two addresses that are the same deployment. A port only distinguishes when BOTH sides
 * state one; origins written without a port refer to the whole host.
 */
function addressesOneDeployment(endpoint: NetworkAddress, own: NetworkAddress): boolean {
  if (sameWorktreeStack(endpoint.host, own.host)) return true;
  if (endpoint.host !== own.host) return false;
  if (endpoint.port === undefined || own.port === undefined) return true;
  return endpoint.port === own.port;
}

/**
 * A stack serves `app`, `gateway` and `nlp` under one `<slug>` — different
 * hostnames, one deployment — so the plain host comparison above cannot see
 * it. Two different worktrees stay two different deployments.
 */
function sameWorktreeStack(endpointHost: string, ownHost: string): boolean {
  const endpointStack = worktreeStack(endpointHost);
  return endpointStack !== undefined && endpointStack === worktreeStack(ownHost);
}

function worktreeStack(host: string): string | undefined {
  if (!host.endsWith(WORKTREE_SUFFIX)) return undefined;
  const labels = host.slice(0, -WORKTREE_SUFFIX.length).split(".");
  const slug = labels.slice(-WORKTREE_STACK_LABELS).join(".");
  return slug ? `${slug}${WORKTREE_SUFFIX}` : undefined;
}

/** Parse address from URL, bare host, or host+port; scheme optional (bind never has it),
 * implicit port stays undefined */
function parseNetworkAddress(
  raw: string | undefined,
  statedPort?: number,
): NetworkAddress | undefined {
  const value = raw?.trim();
  if (!value) return undefined;

  const absolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `//${value}`;
  let url: URL;
  try {
    url = new URL(absolute, "http://deployment.invalid");
  } catch {
    return undefined;
  }

  const host = canonicalHost(url.hostname);
  if (!host) return undefined;
  return { host, port: statedPort ?? (url.port ? Number(url.port) : undefined) };
}

function canonicalHost(hostname: string): string | undefined {
  const host = hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (!host || host === "deployment.invalid") return undefined;
  return LOOPBACK_HOSTS.has(host) ? LOOPBACK_HOST : host;
}
