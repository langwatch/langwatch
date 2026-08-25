/**
 * mcp-sse-multipod-probe.ts — proves the MCP SSE transport survives a
 * multi-replica deployment, which is what production actually is.
 *
 * Production runs several app replicas behind a load balancer with no session
 * affinity. `GET /sse` opens a stream that lives only on the replica that
 * answered it; every follow-up `POST /messages?sessionId=…` is a new
 * connection the balancer may hand to any replica. This probe reproduces that
 * with two in-process handler instances on two ports, sharing one local Redis,
 * behind a round-robin proxy the real MCP SDK client talks to. Every request
 * the client makes therefore lands on the "wrong" replica half the time.
 *
 * PASS means initialize and tools/list completed through that proxy and at
 * least one tool came back. Before the relay landed this failed at the first
 * message: a replica that did not hold the stream answered
 * 400 "Invalid or missing session ID".
 *
 * OAuth is not exercised here — a project API key as Bearer reaches the same
 * session machinery, and the OAuth legs are covered by the integration tests.
 *
 * Usage:
 *   cd platform/app
 *   LANGWATCH_API_KEY=<project apiKey> npx tsx scripts/dogfood/mcp-sse-multipod-probe.ts
 *
 * Requires REDIS_URL (read from .env like the rest of the app)
 * and a project whose apiKey is LANGWATCH_API_KEY.
 */
import { createServer, request as httpRequest, type Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { createMcpHandler, type McpHandler } from "../../src/mcp/handler";

const API_KEY = process.env.LANGWATCH_API_KEY;

if (!API_KEY) {
  console.error(
    "LANGWATCH_API_KEY env var required (a project apiKey from your local database)",
  );
  process.exit(2);
}

const REPLICA_COUNT = 2;

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return typeof address === "object" && address ? address.port : 0;
}

/**
 * A load balancer with no session affinity: each request goes to the next
 * replica in turn, so a stream opened on one replica is guaranteed to receive
 * messages through the other.
 */
function createRoundRobinProxy(replicaPorts: number[]): Server {
  let next = 0;
  return createServer((clientReq, clientRes) => {
    const port = replicaPorts[next % replicaPorts.length]!;
    next++;
    console.error(`[proxy] ${clientReq.method} ${clientReq.url} -> replica on :${port}`);
    const upstream = httpRequest(
      {
        host: "127.0.0.1",
        port,
        method: clientReq.method,
        path: clientReq.url,
        headers: clientReq.headers,
      },
      (upstreamRes) => {
        clientRes.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
        upstreamRes.pipe(clientRes);
      },
    );
    upstream.on("error", (err) => {
      console.error(`[proxy] upstream error: ${String(err)}`);
      if (!clientRes.headersSent) clientRes.writeHead(502);
      clientRes.end();
    });
    clientReq.pipe(upstream);
  });
}

async function main(): Promise<number> {
  const handlers: McpHandler[] = [];
  const replicas: Server[] = [];
  const replicaPorts: number[] = [];

  for (let i = 0; i < REPLICA_COUNT; i++) {
    const handler = createMcpHandler();
    const server = createServer((req, res) => handler.handleRequest(req, res));
    const port = await listen(server);
    handlers.push(handler);
    replicas.push(server);
    replicaPorts.push(port);
    console.error(`[probe] replica ${i + 1} listening on :${port}`);
  }

  const proxy = createRoundRobinProxy(replicaPorts);
  const proxyPort = await listen(proxy);
  const baseUrl = `http://127.0.0.1:${proxyPort}`;
  console.error(`[probe] round-robin proxy on :${proxyPort}`);

  const shutdown = async () => {
    // Await the releases before the forced exit below: a record left
    // behind still counts against the project's concurrent sessions.
    await Promise.all(handlers.map((handler) => handler.closeAllSessions()));
    for (const server of [...replicas, proxy]) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  };

  const client = new Client({
    name: "mcp-sse-multipod-probe",
    version: "0.0.0",
  });
  const transport = new SSEClientTransport(new URL(`${baseUrl}/sse`), {
    requestInit: { headers: { Authorization: `Bearer ${API_KEY}` } },
    eventSourceInit: {
      fetch: (url, init) =>
        fetch(url, {
          ...init,
          headers: { ...init?.headers, Authorization: `Bearer ${API_KEY}` },
        }),
    },
  });

  try {
    console.error("[probe] connecting the SSE client through the proxy …");
    await client.connect(transport);
    console.error("[probe] connected (initialize completed)");

    const { tools } = await client.listTools();
    console.error(`[probe] tools/list returned ${tools.length} tools`);
    if (tools.length === 0) {
      console.log("FAIL: tools/list returned no tools");
      return 1;
    }

    console.log(
      `PASS: initialize and tools/list completed across ${REPLICA_COUNT} replicas ` +
        `(${tools.length} tools listed)`,
    );
    return 0;
  } catch (err) {
    console.log(`FAIL: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  } finally {
    await client.close().catch(() => undefined);
    await shutdown();
  }
}

void main().then((code) => {
  process.exit(code);
});
