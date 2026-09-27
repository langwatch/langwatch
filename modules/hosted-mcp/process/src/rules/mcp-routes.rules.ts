import {
  handlerManagedAuth,
  publicEndpoint,
  type AccessPolicy,
  type CredentialClass,
} from "@langwatch/api";
import type { Credential } from "@langwatch/api/access";

/** The family these routes are grouped under in the route-policy registry. */
export const HOSTED_MCP_FAMILY = "hosted-mcp";

export const PROTECTED_RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource";
export const AUTHORIZATION_SERVER_METADATA_PATH = "/.well-known/oauth-authorization-server";

/**
 * The policy every bearer route wears. This family answers off the raw Node listener rather than
 * the Hono stack, so no `SecuredApp` records it for an authorization audit.
 */
const BEARER_SESSION_POLICY: AccessPolicy = handlerManagedAuth({
  reason:
    "MCP transport: the handler authenticates the bearer it minted (or a project " +
    "API key) and re-proves the grant that bearer was minted from",
  permissions: [],
  credential: "apiKey",
});

const OAUTH_HANDSHAKE_POLICY: AccessPolicy = publicEndpoint(
  "OAuth 2.1 handshake and discovery for MCP clients (RFC 6749/8414/9728); takes no credential",
);

const MCP_HEALTH_POLICY: AccessPolicy = publicEndpoint("MCP liveness probe; reads no project data");

const ROUTE_VERBS: readonly {
  path: string;
  methods: readonly string[];
  policy: AccessPolicy;
}[] = [
  { path: "/mcp", methods: ["POST", "GET", "DELETE"], policy: BEARER_SESSION_POLICY },
  { path: "/mcp/health", methods: ["GET"], policy: MCP_HEALTH_POLICY },
  { path: "/sse", methods: ["GET"], policy: BEARER_SESSION_POLICY },
  { path: "/messages", methods: ["POST"], policy: BEARER_SESSION_POLICY },
  { path: "/sse/messages", methods: ["POST"], policy: BEARER_SESSION_POLICY },
  { path: PROTECTED_RESOURCE_METADATA_PATH, methods: ["GET"], policy: OAUTH_HANDSHAKE_POLICY },
  {
    path: `${PROTECTED_RESOURCE_METADATA_PATH}/mcp`,
    methods: ["GET"],
    policy: OAUTH_HANDSHAKE_POLICY,
  },
  {
    path: `${PROTECTED_RESOURCE_METADATA_PATH}/sse`,
    methods: ["GET"],
    policy: OAUTH_HANDSHAKE_POLICY,
  },
  { path: AUTHORIZATION_SERVER_METADATA_PATH, methods: ["GET"], policy: OAUTH_HANDSHAKE_POLICY },
  {
    path: `${AUTHORIZATION_SERVER_METADATA_PATH}/mcp`,
    methods: ["GET"],
    policy: OAUTH_HANDSHAKE_POLICY,
  },
  {
    path: `${AUTHORIZATION_SERVER_METADATA_PATH}/sse`,
    methods: ["GET"],
    policy: OAUTH_HANDSHAKE_POLICY,
  },
  { path: "/.well-known/openid-configuration", methods: ["GET"], policy: OAUTH_HANDSHAKE_POLICY },
  { path: "/oauth/register", methods: ["POST"], policy: OAUTH_HANDSHAKE_POLICY },
  { path: "/oauth/token", methods: ["POST"], policy: OAUTH_HANDSHAKE_POLICY },
];

/**
 * Every route verb this family serves, CORS preflight included: the dispatcher answers
 * `OPTIONS` on every path it claims, and an undeclared preflight is what the registry surfaces.
 */
export function hostedMcpRoutePolicies(): readonly {
  method: string;
  path: string;
  policy: AccessPolicy;
  family: string;
  credentialClass: CredentialClass;
  credential: Credential;
}[] {
  return ROUTE_VERBS.flatMap((route) =>
    [...route.methods, "OPTIONS"].map((method) => {
      const policy =
        method === "OPTIONS"
          ? publicEndpoint(`CORS preflight for ${route.path}; answers headers only, reads nothing`)
          : route.policy;
      const isPublic = policy.kind === "public";
      return {
        method,
        path: route.path,
        policy,
        family: HOSTED_MCP_FAMILY,
        credentialClass: isPublic ? "none" : "project_api_key",
        credential: isPublic ? "public" : "project",
      };
    }),
  );
}

const MCP_ROUTES = new Set([
  "/mcp",
  "/mcp/health",
  "/sse",
  "/messages",
  // Some clients resolve the endpoint the SSE stream advertises by appending
  // it to the path they connected on, so the same handler answers both.
  "/sse/messages",
  PROTECTED_RESOURCE_METADATA_PATH,
  AUTHORIZATION_SERVER_METADATA_PATH,
  "/.well-known/openid-configuration",
  "/oauth/token",
  "/oauth/register",
]);

/**
 * RFC 9728 §3.1 lets a client that only knows the resource URL ask for metadata at the
 * resource's path under the well-known prefix; modern MCP clients try that form first.
 */
const OAUTH_METADATA_PREFIXES = [
  `${PROTECTED_RESOURCE_METADATA_PATH}/`,
  `${AUTHORIZATION_SERVER_METADATA_PATH}/`,
];

/** The resource paths whose metadata this server publishes. */
const METADATA_RESOURCE_SUFFIXES = new Set(["/mcp", "/sse"]);

export function isMcpRoute(pathname: string): boolean {
  if (MCP_ROUTES.has(pathname)) return true;
  return OAUTH_METADATA_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/** Which path-suffixed discovery document a path names, if it is under one of those subtrees. */
export type McpMetadataSubtreePath =
  | Readonly<{ kind: "outside" }>
  | Readonly<{ kind: "unpublished" }>
  | Readonly<{ kind: "protected-resource"; resourceSuffix: string }>
  | Readonly<{ kind: "authorization-server" }>;

export function classifyMetadataSubtreePath(pathname: string): McpMetadataSubtreePath {
  const prefix = OAUTH_METADATA_PREFIXES.find((candidate) => pathname.startsWith(candidate));
  if (!prefix) return { kind: "outside" };

  // The trailing separator of the prefix starts the resource path.
  const resourceSuffix = pathname.slice(prefix.length - 1);
  if (!METADATA_RESOURCE_SUFFIXES.has(resourceSuffix)) return { kind: "unpublished" };

  return prefix.startsWith(PROTECTED_RESOURCE_METADATA_PATH)
    ? { kind: "protected-resource", resourceSuffix }
    : { kind: "authorization-server" };
}

/**
 * `resourceSuffix` is echoed back as the `resource` identifier, so a client validating the
 * document against the URL it is about to call finds them equal.
 */
export function buildProtectedResourceMetadata(
  baseUrl: string,
  resourceSuffix = "",
): Readonly<Record<string, string | string[]>> {
  return {
    resource: `${baseUrl}${resourceSuffix}`,
    authorization_servers: [baseUrl],
    bearer_methods_supported: ["header"],
    scopes_supported: ["mcp:tools"],
  };
}

/** Built from the configured endpoint, never the Host header, to prevent header injection. */
export function buildAuthorizationServerMetadata(
  baseUrl: string,
): Readonly<Record<string, string | string[]>> {
  return {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/mcp/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    registration_endpoint: `${baseUrl}/oauth/register`,
    token_endpoint_auth_methods_supported: ["none"],
    grant_types_supported: ["authorization_code"],
    response_types_supported: ["code"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["mcp:tools"],
  };
}

export function parseFormBody(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(raw)) {
    result[key] = value;
  }
  return result;
}

export function extractBearerToken(authorization: string | undefined): string | undefined {
  if (!authorization?.startsWith("Bearer ")) return undefined;
  return authorization.slice(7) || undefined;
}

/**
 * RFC 6749 §2.3.1 client credentials in an `Authorization: Basic` header. Clients registered here
 * have no secret, so only the `client_id` half is read.
 */
export function extractClientIdFromBasicAuth(
  authorization: string | undefined,
): string | undefined {
  if (!authorization?.toLowerCase().startsWith("basic ")) return undefined;
  try {
    const decoded = Buffer.from(authorization.slice(6).trim(), "base64").toString("utf-8");
    const separator = decoded.indexOf(":");
    const rawClientId = separator === -1 ? decoded : decoded.slice(0, separator);
    return decodeURIComponent(rawClientId) || undefined;
  } catch {
    return undefined;
  }
}

export function extractSessionIdHeader(header: string | string[] | undefined): string | undefined {
  return typeof header === "string" ? header : undefined;
}
