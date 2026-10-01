import type { IncomingMessage, ServerResponse } from "node:http";

const MAX_BODY_BYTES = 10_485_760;

const BODY_TOO_LARGE = "Request body too large";

/** A body read: the text, or a refusal already sent to the caller, who must stop. */
export type McpBodyRead = Readonly<{ kind: "read"; body: string }> | Readonly<{ kind: "answered" }>;

/** A JSON body read: the parsed document, or a refusal already sent to the caller. */
export type McpJsonBodyRead =
  | Readonly<{ kind: "read"; body: unknown }>
  | Readonly<{ kind: "answered" }>;

/**
 * The raw Node exchange this endpoint answers on: bodies in, JSON and protocol refusals out,
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

  /** Points the client at the protected-resource document, where its OAuth flow starts. */
  send401(res: ServerResponse, error: string): void {
    res.setHeader(
      "WWW-Authenticate",
      `Bearer resource_metadata="${this.#baseHost}/.well-known/oauth-protected-resource"`,
    );
    this.sendJson(res, 401, { error });
  }

  /** RFC 6749 §5.2's shape: a bare error string reads to clients as a protocol failure. */
  sendRateLimited(res: ServerResponse, retryAfterSeconds = 60): void {
    res.setHeader("Retry-After", String(retryAfterSeconds));
    this.sendJson(res, 429, {
      error: "temporarily_unavailable",
      error_description: "Rate limit exceeded, retry later",
    });
  }

  sendMethodNotAllowed(res: ServerResponse): void {
    this.sendJson(res, 405, { error: "Method not allowed" });
  }

  async readRawBody(req: IncomingMessage, res: ServerResponse): Promise<McpBodyRead> {
    try {
      return { kind: "read", body: await readBody(req) };
    } catch (err) {
      if (err instanceof Error && err.message === BODY_TOO_LARGE) {
        this.sendJson(res, 413, { error: BODY_TOO_LARGE });
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
      this.sendJson(res, 400, { error: "Invalid JSON body" });
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
