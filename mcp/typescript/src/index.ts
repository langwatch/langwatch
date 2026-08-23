import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { initConfig } from "./config.js";
import { createMcpServer } from "./create-mcp-server.js";

const argv = await yargs(hideBin(process.argv))
  .option("apiKey", {
    type: "string",
    description: "LangWatch API key",
  })
  .option("endpoint", {
    type: "string",
    description: "LangWatch API endpoint",
  })
  .option("http", {
    type: "boolean",
    description: "Start HTTP/SSE server instead of stdio",
    default: false,
  })
  .option("port", {
    type: "number",
    description: "HTTP server port (only used with --http)",
    default: 3000,
  })
  .option("host", {
    type: "string",
    description:
      "HTTP listen address (only used with --http). Defaults to loopback; pass 0.0.0.0 to accept connections from other machines",
  })
  .option("allowedOrigin", {
    type: "array",
    string: true,
    description:
      "Browser origin allowed to call the HTTP server, repeatable. Loopback origins are always allowed",
  })
  .help()
  .parseAsync();

initConfig({
  apiKey: argv.apiKey,
  endpoint: argv.endpoint,
});

// Discover the rpc.discover-driven tools once, before any transport starts
// (ADR-105). A catalogue that cannot be fetched fails here — the server does
// not start with a silently empty tool list.
const { discoverAndStoreRpcTools } = await import(
  "./tools/rpc-discovered.js"
);
await discoverAndStoreRpcTools();

if (argv.http) {
  const { startHttpServer } = await import("./http-server.js");
  const { isLoopbackHost, parseAllowedOrigins } = await import(
    "./http-security.js"
  );

  const allowedOrigins =
    argv.allowedOrigin && argv.allowedOrigin.length > 0
      ? parseAllowedOrigins(argv.allowedOrigin.join(","))
      : undefined;

  const { port, host } = await startHttpServer({
    port: argv.port,
    host: argv.host,
    allowedOrigins,
  });

  // An IPv6 literal has to be bracketed inside a URL, and must not be
  // double-bracketed when the operator already wrote it that way.
  const displayHost =
    host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  console.log(
    `LangWatch MCP server listening on http://${displayHost}:${port}/mcp`
  );
  console.log(
    "Clients must provide their API key via Authorization: Bearer <key> header"
  );
  if (!isLoopbackHost(host)) {
    console.warn(
      `Warning: bound to ${host}, so the server is reachable from other machines. ` +
        "Make sure it sits behind a trusted network boundary and that --allowedOrigin " +
        "lists only origins you control."
    );
  }
  if (process.env.LANGWATCH_MCP_TRUST_PROXY === "true") {
    console.warn(
      "Warning: LANGWATCH_MCP_TRUST_PROXY=true, so the rate limit on failed " +
        "authentication uses the client address from X-Forwarded-For. Keep this " +
        "on only when a trusted proxy terminates in front of the port and " +
        "overwrites that header. Otherwise a client can supply any address there " +
        "and the limit stops counting."
    );
  }
} else {
  const transport = new StdioServerTransport();
  const server = createMcpServer();
  await server.connect(transport);
}
