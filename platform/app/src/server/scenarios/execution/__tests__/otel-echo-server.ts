/**
 * Lightweight HTTP echo server for OTEL trace context propagation tests.
 *
 * Captures incoming request headers and returns canned JSON responses
 * compatible with the HTTP agent adapter's expected format.
 */

import { createServer, type Server, type IncomingHttpHeaders } from "node:http";

interface ReceivedRequest {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
}

interface OtelEchoServer {
  /** Base URL including the random port, e.g. "http://127.0.0.1:12345" */
  url: string;
  /** Port the server is listening on */
  port: number;
  /** Returns all requests received so far, in order */
  getReceivedRequests(): ReceivedRequest[];
  /** Shuts down the server */
  close(): Promise<void>;
}

const CANNED_RESPONSE = {
  choices: [
    {
      message: {
        role: "assistant",
        content: "I can help with that.",
      },
    },
  ],
};

/**
 * Creates and starts an echo server on a random available port.
 * The server captures all incoming request metadata and returns
 * a canned OpenAI-compatible JSON response.
 */
export async function createOtelEchoServer(): Promise<OtelEchoServer> {
  const receivedRequests: ReceivedRequest[] = [];

  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      receivedRequests.push({
        method: req.method ?? "UNKNOWN",
        url: req.url ?? "/",
        headers: req.headers,
        body,
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(CANNED_RESPONSE));
    });
  });

  const port = await listenOnRandomPort(server);

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    getReceivedRequests: () => [...receivedRequests],
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

function listenOnRandomPort(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        resolve(addr.port);
      } else {
        reject(new Error("Failed to get server address"));
      }
    });
    server.on("error", reject);
  });
}
