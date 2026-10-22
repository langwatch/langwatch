import type { IncomingMessage, ServerResponse } from "node:http";

import { MediaTypeMalformedRequestError, PayloadTooLargeError, retryAfterOf } from "@langwatch/api";
import { HandledError } from "@langwatch/handled-error";

const MAX_BODY_BYTES = 10_485_760;

const BODY_TOO_LARGE = "Request body too large";

const UNAUTHORIZED = 401;

/** A body read: the text, or a refusal already sent to the caller, who must stop. */
type McpBodyRead = Readonly<{ kind: "read"; body: string }> | Readonly<{ kind: "answered" }>;

/** A JSON body read: the parsed document, or a refusal already sent to the caller. */
type McpJsonBodyRead = Readonly<{ kind: "read"; body: unknown }> | Readonly<{ kind: "answered" }>;

/**
 * The raw Node exchange this endpoint answers on: bodies in, JSON and handled refusals out,
 * and the identifiers each request's access log line carries.
 */
export class McpHttpService {
  readonly #baseHost: string;
  /** Only identifiers go in: MCP requests never reach the Hono stack's own access log. */
  readonly #logFields = new WeakMap<ServerResponse, Record<string, string>>();

  private constructor({ baseHost }: { baseHost: string }) {
    this.#baseHost = baseHost;
  }

  static create({ baseHost }: { baseHost: string }): McpHttpService {
    return new McpHttpService({ baseHost });
  }

  get baseHost(): string {
    return this.#baseHost;
  }

  noteLogFields(res: ServerResponse, fields: Record<string, string | undefined>): void {
    const existing = this.#logFields.get(res) ?? {};
    for (const [key, value] of Object.entries(fields)) {
      if (value) existing[key] = value;
    }
    this.#logFields.set(res, existing);
  }

  logFieldsOf(res: ServerResponse): Record<string, string> {
    return this.#logFields.get(res) ?? {};
  }

  /** `Access-Control-Allow-Origin: *` is intentional: the bearer is the boundary. */
  setCorsHeaders(res: ServerResponse): void {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, mcp-session-id, MCP-Protocol-Version",
    );
    res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");
  }

  sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
    const body = JSON.stringify(data);
    res.writeHead(statusCode, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    });
    res.end(body);
  }

  /**
   * Answers a refusal in the endpoint's own wire shape, `{ error: "<text>" }`, which MCP clients
   * already read: the code chooses the status and the text, never the body's shape.
   */
  async sendHandled(res: ServerResponse, error: unknown): Promise<void> {
    const handled = HandledError.isHandled(error) ? error : undefined;
    const status = handled?.httpStatus ?? INTERNAL_ERROR;
    const body = handled ? wireBodyOf(handled) : { error: "Internal server error" };
    const retryAfter = retryAfterOf(error);
    if (retryAfter !== undefined) res.setHeader("Retry-After", retryAfter);
    if (status === UNAUTHORIZED) {
      res.setHeader(
        "WWW-Authenticate",
        `Bearer resource_metadata="${this.#baseHost}/.well-known/oauth-protected-resource"`,
      );
    }
    this.sendJson(res, status, body);
    return Promise.resolve();
  }

  /** RFC 6749 §5.2's shape: OAuth clients parse it, so the OAuth endpoints keep it. */
  sendRateLimited(res: ServerResponse, retryAfterSeconds = 60): void {
    res.setHeader("Retry-After", String(retryAfterSeconds));
    this.sendJson(res, 429, {
      error: "temporarily_unavailable",
      error_description: "Rate limit exceeded, retry later",
    });
  }

  async readRawBody(req: IncomingMessage, res: ServerResponse): Promise<McpBodyRead> {
    try {
      return { kind: "read", body: await readBody(req) };
    } catch (err) {
      if (err instanceof Error && err.message === BODY_TOO_LARGE) {
        await this.sendHandled(res, new PayloadTooLargeError());
        return { kind: "answered" };
      }
      throw err;
    }
  }

  async readJsonBody(req: IncomingMessage, res: ServerResponse): Promise<McpJsonBodyRead> {
    const raw = await this.readRawBody(req, res);
    if (raw.kind === "answered") return raw;
    try {
      const body: unknown = JSON.parse(raw.body);
      return { kind: "read", body };
    } catch {
      const received = req.headers["content-type"] ?? null;
      const refusal = { received, expected: "application/json" };
      await this.sendHandled(res, new MediaTypeMalformedRequestError(refusal));
      return { kind: "answered" };
    }
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let rejected = false;
    req.on("data", (chunk: Buffer) => {
      if (rejected) return;
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        rejected = true;
        reject(new Error(BODY_TOO_LARGE));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!rejected) resolve(Buffer.concat(chunks).toString("utf-8"));
    });
    req.on("error", reject);
  });
}

const INTERNAL_ERROR = 500;

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
