/**
 * The discovery-driven RPC tools (ADR-105): tools are projected from the
 * two-level rpc.discover contract, names map dots to underscores with
 * collisions failing discovery, and a tool call POSTs the arguments to the
 * operation's documented path.
 *
 * @see specs/mcp-server/rpc-tools-from-catalogues.feature
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { initConfig } from "../config.js";

const TEST_ENDPOINT = "https://test.langwatch.ai";
const TEST_API_KEY = "test-key";

const CREATE_OPERATION = {
  name: "things.create",
  path: "/api/things/latest/things.create",
  operationId: "createThing",
  summary: "Create a thing",
  description: "Creates one thing.",
  input: {
    type: "object",
    properties: {
      name: { type: "string", minLength: 1, description: "The thing's name" },
      count: { type: "integer", minimum: 0 },
      tags: { type: "array", items: { type: "string" } },
      kind: { enum: ["WIDGET", "GIZMO"] },
      note: { anyOf: [{ type: "string" }, { type: "null" }] },
    },
    required: ["name"],
    additionalProperties: false,
  },
  output: { type: "object" },
  status: 201,
};

const LIST_OPERATION = {
  name: "things.list",
  path: "/api/things/latest/things.list",
  input: null,
  output: { type: "array" },
  status: 200,
};

function indexResponse(services = [
  { name: "things", discover: "/api/things/latest/rpc.discover" },
]) {
  return { openapi: "/.well-known/openapi", services };
}

function catalogueResponse(operations: unknown[] = [
  CREATE_OPERATION,
  LIST_OPERATION,
]) {
  return { openapi: "/.well-known/openapi", operations };
}

describe("rpc.discover-driven tools", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    initConfig({ apiKey: TEST_API_KEY, endpoint: TEST_ENDPOINT });
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockCatalogueFetch({
    services,
    operations,
  }: {
    services?: Parameters<typeof indexResponse>[0];
    operations?: unknown[];
  } = {}) {
    mockFetch.mockImplementation(async (url: string) => {
      const body =
        url === `${TEST_ENDPOINT}/api/rpc.discover`
          ? indexResponse(services)
          : catalogueResponse(operations);
      return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
      };
    });
  }

  /** @scenario "Tools are discovered from the root index and the service catalogues" */
  it("registers a tool per catalogued operation and none besides", async () => {
    mockCatalogueFetch();
    const { discoverRpcTools } = await import("../tools/rpc-discovered.js");

    const tools = await discoverRpcTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "things_create",
      "things_list",
    ]);
    // The root index was asked for the fleet, then the service catalogue.
    expect(mockFetch.mock.calls.map((call) => call[0])).toEqual([
      `${TEST_ENDPOINT}/api/rpc.discover`,
      `${TEST_ENDPOINT}/api/things/latest/rpc.discover`,
    ]);
  });

  /** @scenario "Tool names map dots to underscores" */
  it("maps the dotted name to the MCP charset", async () => {
    mockCatalogueFetch();
    const { toolNameFor } = await import("../tools/rpc-discovered.js");

    expect(toolNameFor("things.create")).toBe("things_create");
    expect(toolNameFor("things.nested.get")).toBe("things_nested_get");
  });

  /** @scenario "A tool name collision fails discovery" */
  it("fails discovery when two operations map to one tool name", async () => {
    mockCatalogueFetch({
      services: [
        { name: "things", discover: "/api/things/latest/rpc.discover" },
        { name: "other", discover: "/api/other/latest/rpc.discover" },
      ],
      // Both catalogues answer the same colliding operation name.
      operations: [CREATE_OPERATION],
    });
    const { discoverRpcTools } = await import("../tools/rpc-discovered.js");

    await expect(discoverRpcTools()).rejects.toThrow(
      /collision.*things\.create.*things\.create|things\.create.*things\.create.*collision/s,
    );
  });

  /** @scenario "A tool's input schema comes from the catalogue" */
  it("carries the catalogue's fields, types and descriptions into the tool schema", async () => {
    mockCatalogueFetch();
    const { discoverRpcTools } = await import("../tools/rpc-discovered.js");

    const tools = await discoverRpcTools();
    const create = tools.find((tool) => tool.name === "things_create");

    expect(create?.description).toBe("Create a thing — Creates one thing.");
    const shape = create?.inputSchema?.shape;
    expect(Object.keys(shape ?? {}).sort()).toEqual([
      "count",
      "kind",
      "name",
      "note",
      "tags",
    ]);
    // The catalogue's description survives the round-trip.
    expect(shape?.name?.description).toBe("The thing's name");
    // Required in the catalogue is required in the tool; optional is optional.
    expect(shape?.name?.safeParse(undefined).success).toBe(false);
    expect(shape?.count?.safeParse(undefined).success).toBe(true);
    expect(shape?.kind?.safeParse("WIDGET").success).toBe(true);
    expect(shape?.kind?.safeParse("NOPE").success).toBe(false);
    expect(shape?.note?.safeParse(null).success).toBe(true);
  });

  /** @scenario "An operation with null input becomes a no-argument tool" */
  it("registers a no-argument tool for a null input", async () => {
    mockCatalogueFetch();
    const { discoverRpcTools } = await import("../tools/rpc-discovered.js");

    const tools = await discoverRpcTools();
    const list = tools.find((tool) => tool.name === "things_list");

    expect(list?.inputSchema).toBeUndefined();
  });

  describe("when a tool is called", () => {
    async function registeredHandlerFor(toolName: string) {
      mockCatalogueFetch();
      const {
        discoverRpcTools,
        registerDiscoveredRpcTools,
      } = await import("../tools/rpc-discovered.js");
      const tools = await discoverRpcTools();

      const registered = new Map<string, unknown>();
      const fakeServer = {
        registerTool: (name: string, _config: unknown, handler: unknown) =>
          registered.set(name, handler),
      };
      registerDiscoveredRpcTools(
        fakeServer as never,
        tools,
        () => undefined,
      );
      const handler = registered.get(toolName);
      expect(handler).toBeDefined();
      return handler as (args: unknown) => Promise<{
        content: Array<{ type: string; text: string }>;
      }>;
    }

    /** @scenario "Calling a tool POSTs the arguments to the operation's path" */
    it("POSTs the arguments to the operation's documented path with the API key", async () => {
      const handler = await registeredHandlerFor("things_create");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ id: "thing_1" }),
        text: async () => JSON.stringify({ id: "thing_1" }),
      });

      const result = await handler({ name: "widget" });

      const [url, init] = mockFetch.mock.calls.at(-1)! as [
        string,
        { method: string; headers: Record<string, string>; body: string },
      ];
      expect(url).toBe(`${TEST_ENDPOINT}/api/things/latest/things.create`);
      expect(init.method).toBe("POST");
      expect(init.headers["X-Auth-Token"]).toBe(TEST_API_KEY);
      expect(JSON.parse(init.body)).toEqual({ name: "widget" });
      expect(result.content[0]?.text).toContain("thing_1");
    });

    /** @scenario "A failed operation call surfaces the platform's error" */
    it("fails with the platform's error code and message", async () => {
      const handler = await registeredHandlerFor("things_create");

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        text: async () =>
          JSON.stringify({ code: "thing_name_taken", message: "thing_name_taken" }),
      });

      await expect(handler({ name: "widget" })).rejects.toMatchObject({
        code: "thing_name_taken",
      });
    });
  });

  /** @scenario "A catalogue that cannot be fetched fails the startup" */
  it("fails discovery when the root index is unreachable", async () => {
    mockFetch.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));
    const { discoverRpcTools } = await import("../tools/rpc-discovered.js");

    await expect(discoverRpcTools()).rejects.toThrow(
      /rpc\.discover fetch failed.*ECONNREFUSED/,
    );
  });

  it("registers the discovered tools on the real MCP server", async () => {
    mockCatalogueFetch();
    const {
      discoverRpcTools,
      setDiscoveredRpcTools,
    } = await import("../tools/rpc-discovered.js");
    setDiscoveredRpcTools(await discoverRpcTools());

    const { createMcpServer } = await import("../create-mcp-server.js");
    const server = createMcpServer();
    const registeredTools = (
      server as unknown as { _registeredTools: Record<string, unknown> }
    )._registeredTools;

    expect(Object.keys(registeredTools)).toContain("things_create");
    expect(Object.keys(registeredTools)).toContain("things_list");

    setDiscoveredRpcTools([]);
  });

  it("fails discovery when a service catalogue answers an error", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url === `${TEST_ENDPOINT}/api/rpc.discover`) {
        const body = indexResponse();
        return {
          ok: true,
          status: 200,
          json: async () => body,
          text: async () => JSON.stringify(body),
        };
      }
      return { ok: false, status: 500, text: async () => "boom" };
    });
    const { discoverRpcTools } = await import("../tools/rpc-discovered.js");

    await expect(discoverRpcTools()).rejects.toThrow(/HTTP 500/);
  });
});
