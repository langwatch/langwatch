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
  .help()
  .parseAsync();

initConfig({
  apiKey: argv.apiKey,
  endpoint: argv.endpoint,
});

if (argv.http) {
  const { startHttpServer } = await import("./http-server.js");
  const { port } = await startHttpServer({ port: argv.port });
  console.log(`LangWatch MCP server listening on http://0.0.0.0:${port}/mcp`);
  console.log(
    "Clients must provide their API key via Authorization: Bearer <key> header"
  );
} else {
  const transport = new StdioServerTransport();
  const server = createMcpServer();
  await server.connect(transport);
}
