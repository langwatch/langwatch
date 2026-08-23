/**
 * Discovery-driven MCP tools (ADR-105): every operation the rpc.discover
 * catalogues carry becomes an MCP tool, registered at startup. Calling the
 * tool POSTs the arguments to the operation's documented path — services see
 * an ordinary RPC call, and JSON-RPC 2.0 never leaves the MCP SDK layer.
 *
 * See specs/mcp-server/rpc-tools-from-catalogues.feature.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";

import { requireApiKey } from "../config.js";
import { makeRequest } from "../langwatch-api.js";
import {
  type DiscoveredOperation,
  fetchServiceCatalogue,
  fetchServiceIndex,
} from "../langwatch-api-discover.js";
import { convertInputSchema } from "../utils/json-schema-to-zod.js";

/** One MCP tool derived from one catalogued operation. */
export interface DiscoveredRpcTool {
  /** The MCP-safe tool name: dots mapped to underscores. */
  name: string;
  /** The dotted operation name, e.g. `things.create`. */
  operationName: string;
  /** The service whose catalogue carried the operation. */
  service: string;
  /** The documented path the tool call POSTs to. */
  path: string;
  description: string;
  /** Undefined for an operation that takes no arguments. */
  inputSchema?: z.ZodObject<Record<string, z.ZodType>>;
}

/** `things.create` → `things_create` — the only mapping the MCP charset needs. */
export function toolNameFor(operationName: string): string {
  return operationName.replace(/\./g, "_");
}

function descriptionFor(operation: DiscoveredOperation): string {
  const parts = [operation.summary, operation.description].filter(
    (part): part is string => typeof part === "string" && part.length > 0,
  );
  if (parts.length === 0) {
    return `RPC ${operation.name} (${operation.path})`;
  }
  return [...new Set(parts)].join(" — ");
}

/**
 * Fetches the root index and every service catalogue, and flattens them into
 * tool definitions. Any failure — an unreachable catalogue, a name collision —
 * throws, because the caller fails the startup on it: a server serving fewer
 * tools than the surface has is undiscoverable from the client side.
 */
export async function discoverRpcTools(): Promise<DiscoveredRpcTool[]> {
  const index = await fetchServiceIndex();

  const tools: DiscoveredRpcTool[] = [];
  for (const service of index.services) {
    const catalogue = await fetchServiceCatalogue(service.discover);
    for (const operation of catalogue.operations) {
      tools.push({
        name: toolNameFor(operation.name),
        operationName: operation.name,
        service: service.name,
        path: operation.path,
        description: descriptionFor(operation),
        inputSchema: convertInputSchema(operation.input),
      });
    }
  }

  const seen = new Map<string, DiscoveredRpcTool>();
  for (const tool of tools) {
    const existing = seen.get(tool.name);
    if (existing) {
      throw new Error(
        `rpc.discover tool name collision: ${existing.operationName} ` +
          `(${existing.service}) and ${tool.operationName} (${tool.service}) ` +
          `both map to the tool name "${tool.name}"`,
      );
    }
    seen.set(tool.name, tool);
  }

  return tools;
}

/** The tool call: POST the arguments to the operation's path, key attached. */
async function callDiscoveredOperation(
  tool: DiscoveredRpcTool,
  args: unknown,
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  requireApiKey();
  const result = await makeRequest("POST", tool.path, args ?? {});
  return {
    content: [
      {
        type: "text",
        text:
          typeof result === "string"
            ? result
            : JSON.stringify(result, null, 2),
      },
    ],
  };
}

/** Registers every discovered tool on the server. */
export function registerDiscoveredRpcTools(
  server: McpServer,
  tools: DiscoveredRpcTool[],
  log: (toolName: string, error: unknown) => void = (toolName, error) =>
    console.error(
      `[MCP tool] ${toolName} failed:`,
      error instanceof Error ? error.message : error,
    ),
): void {
  for (const tool of tools) {
    const handler = async (args: unknown) => {
      try {
        return await callDiscoveredOperation(tool, args);
      } catch (error) {
        log(tool.name, error);
        throw error;
      }
    };

    if (tool.inputSchema) {
      server.registerTool(
        tool.name,
        { description: tool.description, inputSchema: tool.inputSchema },
        handler,
      );
    } else {
      server.registerTool(
        tool.name,
        { description: tool.description },
        handler,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// The process-wide holder: discovery runs once at startup, and every server
// instance (the stdio one, and each HTTP session's) registers the same tools.
// ---------------------------------------------------------------------------

let discovered: DiscoveredRpcTool[] = [];

/** Fetches and stores the process-wide tool set. Throws on any failure. */
export async function discoverAndStoreRpcTools(): Promise<void> {
  discovered = await discoverRpcTools();
}

/** The tools discovered at startup; empty when discovery has not run. */
export function getDiscoveredRpcTools(): DiscoveredRpcTool[] {
  return discovered;
}

/** Test hook: replaces or resets the stored tools. */
export function setDiscoveredRpcTools(tools: DiscoveredRpcTool[]): void {
  discovered = tools;
}
