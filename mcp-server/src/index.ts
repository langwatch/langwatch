import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import packageJson from "../package.json" assert { type: "json" };

const transport = new StdioServerTransport();
const server = new McpServer({
  name: "LangWatch",
  version: packageJson.version,
});

server.tool(
  "fetch_langwatch_docs",
  "Fetches the LangWatch docs for understanding how to implement LangWatch in your codebase. Always use this tool when the user asks for help with LangWatch. Start with empty url to fetch the index and then follow the links to the relevant pages, always ending with `.md` extension",
  {
    url: z
      .string()
      .optional()
      .describe(
        "The full url of the specific doc page. If not provided, the docs index will be fetched."
      ),
  },
  async ({ url }) => {
    let urlToFetch = url || "https://docs.langwatch.ai/llms.txt";
    if (url && !urlToFetch.endsWith(".md") && !urlToFetch.endsWith(".txt")) {
      urlToFetch += ".md";
    }
    if (urlToFetch.startsWith("/")) {
      urlToFetch = "https://docs.langwatch.ai" + urlToFetch;
    }
    const response = await fetch(urlToFetch);

    return {
      content: [{ type: "text", text: await response.text() }],
    };
  }
);

server.tool(
  "fetch_scenario_docs",
  "Fetches the Scenario docs for understanding how to implement Scenario agent tests in your codebase. Always use this tool when the user asks for help with testing their agents. Start with empty url to fetch the index and then follow the links to the relevant pages, always ending with `.md` extension",
  {
    url: z
      .string()
      .optional()
      .describe(
        "The full url of the specific doc page. If not provided, the docs index will be fetched."
      ),
  },
  async ({ url }) => {
    let urlToFetch = url || "https://scenario.langwatch.ai/llms.txt";
    if (url && !urlToFetch.endsWith(".md") && !urlToFetch.endsWith(".txt")) {
      urlToFetch += ".md";
    }
    if (urlToFetch.startsWith("/")) {
      urlToFetch = "https://scenario.langwatch.ai" + urlToFetch;
    }
    const response = await fetch(urlToFetch);

    return {
      content: [{ type: "text", text: await response.text() }],
    };
  }
);

await server.connect(transport);
