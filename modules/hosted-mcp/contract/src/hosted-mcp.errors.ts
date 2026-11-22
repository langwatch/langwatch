import { HandledError } from "@langwatch/handled-error";

/** The wait a client is told before retrying a request a store outage refused. */
export const MCP_STORE_RETRY_AFTER_MS = 5_000;

/** A request to the MCP endpoint that presented no bearer token. */
export class McpAuthorizationRequiredError extends HandledError {
  declare readonly code: "mcp_authorization_required";

  constructor() {
    super("mcp_authorization_required", "Authorization required: send a bearer token", {
      httpStatus: 401,
      fault: "customer",
    });
    this.name = "McpAuthorizationRequiredError";
  }
}

/** A bearer that is not a live access token: unknown, expired, or not bound to a project. */
export class McpInvalidTokenError extends HandledError {
  declare readonly code: "mcp_invalid_token";

  constructor() {
    super("mcp_invalid_token", "Invalid or expired token", { httpStatus: 401, fault: "customer" });
    this.name = "McpInvalidTokenError";
  }
}

/** A project API key, passed as the bearer, that names no live project. */
export class McpInvalidApiKeyError extends HandledError {
  declare readonly code: "mcp_invalid_api_key";

  constructor() {
    super("mcp_invalid_api_key", "Invalid API key", { httpStatus: 401, fault: "customer" });
    this.name = "McpInvalidApiKeyError";
  }
}

/** The access the token was minted under is gone: the person left the project or organisation. */
export class McpGrantRevokedError extends HandledError {
  declare readonly code: "mcp_grant_revoked";

  constructor() {
    super("mcp_grant_revoked", "The access this token was granted under has been revoked", {
      httpStatus: 401,
      fault: "customer",
    });
    this.name = "McpGrantRevokedError";
  }
}

/** A session this caller cannot reach; the MCP spec has the client initialize a new one. */
export class McpSessionNotFoundError extends HandledError {
  declare readonly code: "mcp_session_not_found";

  constructor() {
    super("mcp_session_not_found", "Session not found", { httpStatus: 404, fault: "customer" });
    this.name = "McpSessionNotFoundError";
  }
}

/** A path under the MCP endpoint that serves nothing. */
export class McpRouteNotFoundError extends HandledError {
  declare readonly code: "mcp_route_not_found";

  constructor() {
    super("mcp_route_not_found", "Not found", { httpStatus: 404, fault: "customer" });
    this.name = "McpRouteNotFoundError";
  }
}

/** A discovery path this server claims but publishes no metadata document at. */
export class McpMetadataUnpublishedError extends HandledError {
  declare readonly code: "mcp_metadata_unpublished";

  constructor() {
    super("mcp_metadata_unpublished", "No metadata document is published at this path", {
      httpStatus: 404,
      fault: "customer",
    });
    this.name = "McpMetadataUnpublishedError";
  }
}

/** A request with no session id that is not an initialize request either. */
export class McpSessionIdRequiredError extends HandledError {
  declare readonly code: "mcp_session_id_required";

  constructor() {
    super(
      "mcp_session_id_required",
      "Invalid request: send an mcp-session-id header, or an initialize request to open a session",
      { httpStatus: 400, fault: "customer" },
    );
    this.name = "McpSessionIdRequiredError";
  }
}

/** A method the MCP route does not answer. */
export class McpMethodNotAllowedError extends HandledError {
  declare readonly code: "mcp_method_not_allowed";

  constructor() {
    super("mcp_method_not_allowed", "Method not allowed", { httpStatus: 405, fault: "customer" });
    this.name = "McpMethodNotAllowedError";
  }
}

/** The key already holds as many open sessions as one key may. */
export class McpSessionLimitReachedError extends HandledError {
  declare readonly code: "mcp_session_limit_reached";

  constructor(input: { maxSessions: number }) {
    super("mcp_session_limit_reached", `Too many concurrent sessions (max ${input.maxSessions})`, {
      httpStatus: 429,
      fault: "customer",
      retryable: true,
      meta: { maxSessions: input.maxSessions },
    });
    this.name = "McpSessionLimitReachedError";
  }
}

/** A store the request needs is down: worth a retry, never a reason to sign in again. */
export class McpStoreUnavailableError extends HandledError {
  declare readonly code: "mcp_store_unavailable";

  constructor() {
    super("mcp_store_unavailable", "Temporarily unavailable, retry shortly", {
      httpStatus: 503,
      fault: "platform",
      retryable: true,
      meta: { retryAfterMs: MCP_STORE_RETRY_AFTER_MS },
    });
    this.name = "McpStoreUnavailableError";
  }
}
