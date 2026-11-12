import type { IncomingMessage, ServerResponse } from "node:http";

import { createDocsMcpServer } from "@langwatch/mcp-server/create-mcp-server";
import { createLogger } from "@langwatch/observability";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import type { McpHttpService } from "./mcp-http.service.ts";

const logger = createLogger("langwatch:mcp");

/** A docs request is one small JSON-RPC message; anything near this is not one. */
const MAX_DOCS_BODY_BYTES = 64 * 1024;

/** JSON-RPC's invalid-request error; MCP dropped batching in protocol version 2025-06-18. */
const BATCH_REFUSAL = {
  jsonrpc: "2.0",
  id: null,
  error: { code: -32600, message: "Invalid Request: batch requests are not supported" },
} as const;

type McpDocsTransportCollaborators = Readonly<{ http: McpHttpService }>;

/**
 * `/mcp/docs`: the Streamable HTTP transport in stateless mode over a docs-only server. It takes
 * no credential, so each POST gets its own server and transport, no session id is issued and
 * nothing is written to a store: an anonymous caller has no session storage to fill.
 */
export class McpDocsTransportService {
  readonly #collaborators: McpDocsTransportCollaborators;

  private constructor(collaborators: McpDocsTransportCollaborators) {
    this.#collaborators = collaborators;
  }

  static create(collaborators: McpDocsTransportCollaborators): McpDocsTransportService {
    return new McpDocsTransportService(collaborators);
  }

  async handlePost(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const { http } = this.#collaborators;
    const read = await http.readJsonBody(req, res, { maxBytes: MAX_DOCS_BODY_BYTES });
    if (read.kind === "answered") return;
    // One request, one message: a batch would fan one body out into a hundred docs fetches.
    if (Array.isArray(read.body)) {
      http.sendJson(res, 400, BATCH_REFUSAL);
      return;
    }

    const server = createDocsMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    // Closing the server closes its transport too.
    res.once("close", () => {
      server.close().catch((err: unknown) => {
        logger.debug({ error: err }, "Closing a docs MCP server failed");
      });
    });

    http.noteLogFields(res, { sessionOutcome: "stateless" });
    await server.connect(transport);
    await transport.handleRequest(req, res, read.body);
  }
}
