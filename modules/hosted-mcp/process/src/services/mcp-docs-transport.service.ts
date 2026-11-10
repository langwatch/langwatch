import type { IncomingMessage, ServerResponse } from "node:http";

import { createDocsMcpServer } from "@langwatch/mcp-server/create-mcp-server";
import { createLogger } from "@langwatch/observability";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import type { McpHttpService } from "./mcp-http.service.ts";

const logger = createLogger("langwatch:mcp");

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
    const read = await http.readJsonBody(req, res);
    if (read.kind === "answered") return;

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
