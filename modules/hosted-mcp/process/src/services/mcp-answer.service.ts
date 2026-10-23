import { MediaTypeMalformedRequestError, PayloadTooLargeError, retryAfterOf } from "@langwatch/api";
import { HandledError } from "@langwatch/handled-error";
import type { McpDoorAnswer, McpDoorRequest, McpDoorStream } from "@langwatch/hosted-mcp-contract";
import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:mcp");

const UNAUTHORIZED = 401;

const INTERNAL_ERROR = 500;

/** `Access-Control-Allow-Origin: *` is intentional: the bearer is the boundary. */
const CORS_HEADERS: Readonly<Record<string, string>> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, mcp-session-id, MCP-Protocol-Version",
  "Access-Control-Expose-Headers": "mcp-session-id",
};

/** nginx buffers a streamed response unless told not to. */
const UNBUFFERED: Readonly<Record<string, string>> = { "X-Accel-Buffering": "no" };

/**
 * A request as the endpoint's services read it: the door's plain values, and a place to note the
 * identifiers its access log line carries. Only identifiers go in.
 */
export type McpRequest = McpDoorRequest &
  Readonly<{ noteLogFields: (fields: Readonly<Record<string, string | undefined>>) => void }>;

/** A body read: the text, or the refusal the caller answers with instead. */
export type McpBodyRead =
  | Readonly<{ kind: "read"; body: string }>
  | Readonly<{ kind: "answered"; answer: McpDoorAnswer }>;

/** A JSON body read: the parsed document, or the refusal the caller answers with instead. */
export type McpJsonBodyRead =
  | Readonly<{ kind: "read"; body: unknown }>
  | Readonly<{ kind: "answered"; answer: McpDoorAnswer }>;

/**
 * The answers this endpoint gives, as data: JSON documents, handled refusals in the endpoint's
 * own wire shape, and streams handed to a session. Every answer carries the CORS headers, error
 * answers included. The door writes them; nothing here touches a response.
 */
export class McpAnswerService {
  readonly #baseHost: string;

  private constructor({ baseHost }: { baseHost: string }) {
    this.#baseHost = baseHost;
  }

  static create({ baseHost }: { baseHost: string }): McpAnswerService {
    return new McpAnswerService({ baseHost });
  }

  get baseHost(): string {
    return this.#baseHost;
  }

  json(status: number, body: unknown): McpDoorAnswer {
    return { kind: "json", status, headers: CORS_HEADERS, body };
  }

  /** The answer to a preflight: the CORS headers and nothing else. */
  preflight(): McpDoorAnswer {
    return { kind: "empty", status: 200, headers: CORS_HEADERS };
  }

  /** A request handed to a session's SDK transport, which writes the response itself. */
  stream(stream: McpDoorStream): McpDoorAnswer {
    return { kind: "stream", headers: { ...CORS_HEADERS, ...UNBUFFERED }, stream };
  }

  /** An answer that also tells nginx not to buffer, as a stream that failed to start does. */
  unbuffered(answer: McpDoorAnswer): McpDoorAnswer {
    return { ...answer, headers: { ...answer.headers, ...UNBUFFERED } };
  }

  /** The answer to a failure nothing anticipated: logged, then refused in the endpoint shape. */
  failure(input: { error: unknown; url: string }): McpDoorAnswer {
    logger.error({ error: input.error, url: input.url }, "MCP handler error");
    return this.refusal(input.error);
  }

  /**
   * A refusal in the endpoint's own wire shape, `{ error: "<text>" }`, which MCP clients already
   * read: the code chooses the status and the text, never the body's shape.
   */
  refusal(error: unknown): McpDoorAnswer {
    const handled = HandledError.isHandled(error) ? error : undefined;
    const status = handled?.httpStatus ?? INTERNAL_ERROR;
    const body = handled ? wireBodyOf(handled) : { error: "Internal server error" };
    const headers: Record<string, string> = { ...CORS_HEADERS };
    const retryAfter = retryAfterOf(error);
    if (retryAfter !== undefined) headers["Retry-After"] = retryAfter;
    if (status === UNAUTHORIZED) {
      headers["WWW-Authenticate"] =
        `Bearer resource_metadata="${this.#baseHost}/.well-known/oauth-protected-resource"`;
    }
    return { kind: "json", status, headers, body };
  }

  /** RFC 6749 §5.2's shape: OAuth clients parse it, so the OAuth endpoints keep it. */
  rateLimited(retryAfterSeconds = 60): McpDoorAnswer {
    return {
      kind: "json",
      status: 429,
      headers: { ...CORS_HEADERS, "Retry-After": String(retryAfterSeconds) },
      body: {
        error: "temporarily_unavailable",
        error_description: "Rate limit exceeded, retry later",
      },
    };
  }

  async readRawBody(request: McpDoorRequest): Promise<McpBodyRead> {
    const read = await request.readBody();
    if (read.kind === "read") return read;
    return { kind: "answered", answer: this.refusal(new PayloadTooLargeError()) };
  }

  async readJsonBody(request: McpDoorRequest): Promise<McpJsonBodyRead> {
    const raw = await this.readRawBody(request);
    if (raw.kind === "answered") return raw;
    try {
      const body: unknown = JSON.parse(raw.body);
      return { kind: "read", body };
    } catch {
      const contentType = request.headers["content-type"];
      const received =
        typeof contentType === "string" ? contentType : (contentType?.join(", ") ?? null);
      const refusal = { received, expected: "application/json" };
      return {
        kind: "answered",
        answer: this.refusal(new MediaTypeMalformedRequestError(refusal)),
      };
    }
  }
}

/** The text each refusal has always carried on the wire, where it differs from the message. */
const WIRE_TEXT: Readonly<Record<string, string>> = {
  mcp_authorization_required: "Authorization required",
  mcp_grant_revoked: "mcp_grant_revoked",
  mcp_session_id_required: "Invalid request — no session ID or not an initialize request",
  payload_too_large: "Request body too large",
  malformed_request: "Invalid JSON body",
  rate_limited: "Too many requests",
};

/** Discovery documents answer in OAuth's own shape, which the clients probing them parse. */
function wireBodyOf(error: HandledError): Record<string, string> {
  if (error.code === "mcp_metadata_unpublished") {
    return {
      error: "not_found",
      error_description: "No metadata document is published at this path",
    };
  }
  // A refusal newer than main's MCP bodies carries its code, so a client can tell it apart.
  if (error.code === "legacy_project_key_ingestion_only") {
    return { error: error.message, code: error.code };
  }
  return { error: WIRE_TEXT[error.code] ?? error.message };
}
