import { canonicalOtlpPath } from "./otlp-path.ts";

/**
 * Which surface was called and what kind of caller made the request, derived once at the logging
 * boundary; the tenant comes from the logging context. Best-effort: an unfamiliar client lands in
 * "unknown" and never fails the request. Spec: specs/observability/traffic-attribution.feature
 */

export type EndpointClass =
  | "collector"
  | "otlp"
  | "rum"
  | "dashboard"
  | "auth"
  | "langy"
  | "gateway"
  | "ingest"
  | "mcp"
  | "api"
  | "other";

export type ClientSource =
  | "sdk"
  | "cli"
  | "mcp"
  | "internal"
  | "browser"
  | "curl"
  | "otel-exporter"
  | "http-client"
  | "unknown";

export interface ClientAttribution {
  clientSource: ClientSource;
  clientSdkName?: string;
  clientSdkLanguage?: string;
  clientSdkVersion?: string;
}

export interface RequestAttribution extends ClientAttribution {
  endpointClass: EndpointClass;
}

const under = ({ path, prefix }: { path: string; prefix: string }): boolean =>
  path === prefix || path.startsWith(`${prefix}/`);

const MCP_EXACT_PATHS = new Set(["/sse", "/messages", "/sse/messages"]);

const MCP_PREFIXES = [
  "/mcp",
  "/oauth",
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-authorization-server",
];

const isMcpPath = (path: string): boolean =>
  MCP_EXACT_PATHS.has(path) || MCP_PREFIXES.some((prefix) => under({ path, prefix }));

/**
 * Classes a pathname by the surface that serves it. First match wins, so the
 * specific surfaces come before the `/api` catch-all — everything under
 * `/api` that no other surface claims is the public REST API.
 */
export function endpointClassOf(pathname: string): EndpointClass {
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;

  if (under({ path, prefix: "/api/otel" }) || canonicalOtlpPath(path) !== null) {
    return "otlp";
  }
  if (path === "/api/collector") return "collector";
  if (under({ path, prefix: "/api/rum" })) return "rum";
  if (under({ path, prefix: "/api/trpc" })) return "dashboard";
  if (under({ path, prefix: "/api/auth" })) return "auth";
  if (under({ path, prefix: "/api/langy" })) return "langy";
  if (under({ path, prefix: "/api/gateway" }) || under({ path, prefix: "/api/internal/gateway" })) {
    return "gateway";
  }
  if (under({ path, prefix: "/api/ingest" })) return "ingest";
  if (isMcpPath(path)) return "mcp";
  if (under({ path, prefix: "/api" })) return "api";
  return "other";
}

/** User agents of HTTP libraries that identify a program, not a person. */
const HTTP_CLIENT_AGENTS = [
  "python-requests",
  "python-httpx",
  "httpx/",
  "go-http-client",
  "node-fetch",
  "undici",
  "axios/",
  "okhttp",
  "java/",
  "wget/",
  "postman",
  "insomnia",
  "guzzle",
  "ruby",
];

const SDK_LANGUAGE_BY_AGENT = new Map<string, string>([
  ["langwatch-sdk-node", "typescript"],
  ["langwatch-sdk-go", "go"],
  ["langwatch-sdk-python", "python"],
  ["langwatch-typescript", "typescript"],
  ["langwatch-python", "python"],
]);

const INTERNAL_SERVICE_AGENT = "langwatch-aigateway";

const present = (value: string | null | undefined): string | undefined =>
  value ? value : undefined;

type ClientIdentity = Omit<ClientAttribution, "clientSource">;

const OTEL_EXPORTER_AGENTS = ["otel-otlp-exporter", "otel otlp exporter", "opentelemetry"];

function classifyByIdentityHeaders({
  surface,
  sdkName,
  identity,
}: {
  surface: string | undefined;
  sdkName: string | undefined;
  identity: ClientIdentity;
}): ClientAttribution | undefined {
  if (surface === "cli") return { clientSource: "cli", ...identity };
  if (sdkName === "langwatch-mcp") return { clientSource: "mcp", ...identity };
  if (sdkName) return { clientSource: "sdk", ...identity };
  return undefined;
}

function classifyByAgentName({
  userAgent,
  identity,
}: {
  userAgent: string;
  identity: ClientIdentity;
}): ClientAttribution | undefined {
  const [agentName, agentVersion] = userAgent.split("/", 2);
  const version = agentVersion ? { clientSdkVersion: agentVersion } : {};
  const agentLanguage = agentName ? SDK_LANGUAGE_BY_AGENT.get(agentName) : undefined;
  if (agentLanguage) {
    return {
      clientSource: "sdk",
      clientSdkName: agentName,
      clientSdkLanguage: agentLanguage,
      ...version,
      ...identity,
    };
  }
  if (agentName === "langwatch-mcp") return { clientSource: "mcp", ...version, ...identity };
  if (agentName === INTERNAL_SERVICE_AGENT) {
    return { clientSource: "internal", clientSdkName: agentName, ...version, ...identity };
  }
  return undefined;
}

function classifyByUserAgent(userAgent: string): ClientAttribution {
  if (!userAgent) return { clientSource: "unknown" };
  if (userAgent.startsWith("curl/")) return { clientSource: "curl" };
  if (OTEL_EXPORTER_AGENTS.some((agent) => userAgent.includes(agent))) {
    return { clientSource: "otel-exporter" };
  }
  if (userAgent.startsWith("mozilla/")) return { clientSource: "browser" };
  if (HTTP_CLIENT_AGENTS.some((agent) => userAgent.includes(agent))) {
    return { clientSource: "http-client" };
  }
  return { clientSource: "unknown" };
}

/**
 * Our own clients by the identity headers they send (`x-langwatch-sdk-*`, `x-langwatch-surface`),
 * the rest by User-Agent. A bare `x-langwatch-sdk-version` is an older Python SDK; the AI gateway
 * is "internal".
 */
export function classifyClient(
  header: (name: string) => string | null | undefined,
): ClientAttribution {
  try {
    const sdkName = present(header("x-langwatch-sdk-name"));
    const sdkLanguage = present(header("x-langwatch-sdk-language"));
    const sdkVersion = present(header("x-langwatch-sdk-version"));
    const surface = present(header("x-langwatch-surface"));
    const userAgent = (header("user-agent") ?? "").toLowerCase();

    const identity = {
      ...(sdkName ? { clientSdkName: sdkName } : {}),
      ...(sdkLanguage ? { clientSdkLanguage: sdkLanguage } : {}),
      ...(sdkVersion ? { clientSdkVersion: sdkVersion } : {}),
    };

    const olderPythonSdk: ClientAttribution | undefined = sdkVersion
      ? {
          clientSource: "sdk",
          ...(userAgent.includes("python") ? { clientSdkLanguage: "python" } : {}),
          ...identity,
        }
      : undefined;

    return (
      classifyByIdentityHeaders({ surface, sdkName, identity }) ??
      classifyByAgentName({ userAgent, identity }) ??
      olderPythonSdk ??
      classifyByUserAgent(userAgent)
    );
  } catch {
    return { clientSource: "unknown" };
  }
}
