import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../langwatch-api.ts", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, makeRequest: vi.fn() };
});

vi.mock("../config.ts", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, requireApiKey: vi.fn(() => "test-key") };
});

import { createMcpServer } from "../create-mcp-server.ts";
import { makeRequest } from "../langwatch-api.ts";

const mockMakeRequest = vi.mocked(makeRequest);

let client: Client;

beforeEach(async () => {
  vi.clearAllMocks();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createMcpServer().connect(serverTransport);
  client = new Client({ name: "repeat-test", version: "0.0.0" });
  await client.connect(clientTransport);
});

afterEach(async () => {
  await client.close();
});

const runTool = (args: Record<string, unknown>) =>
  client.callTool({ name: "platform_run_experiment", arguments: args });

const textOf = (result: Awaited<ReturnType<typeof runTool>>): string =>
  (result.content as { type: string; text?: string }[]).map((part) => part.text ?? "").join("");

describe("platform_run_experiment", () => {
  describe("when the agent names a repeat", () => {
    /** @scenario "The MCP run tool passes its repeat on the run" */
    it("sends the repeat in the run body and says every row runs that many times", async () => {
      mockMakeRequest.mockResolvedValueOnce({ runId: "run_1", status: "running", total: 6 });

      const result = await runTool({ slug: "my-evaluation", repeat: 3 });

      expect(mockMakeRequest).toHaveBeenCalledWith(
        "POST",
        "/api/v1/experiments/my-evaluation/run",
        { repeat: 3 },
      );
      expect(result.isError).not.toBe(true);
      expect(textOf(result)).toContain("every dataset row runs 3 times");
    });

    it("sends the repeat beside a concurrency", async () => {
      mockMakeRequest.mockResolvedValueOnce({ runId: "run_1", status: "running", total: 6 });

      await runTool({ slug: "my-evaluation", repeat: 2, concurrency: 1 });

      expect(mockMakeRequest).toHaveBeenCalledWith(
        "POST",
        "/api/v1/experiments/my-evaluation/run",
        { concurrency: 1, repeat: 2 },
      );
    });
  });

  describe("when the repeat is not a whole number from 1 to 5", () => {
    /** @scenario "The MCP run tool refuses a repeat that is not a whole number from 1 to 5" */
    it.each([0, 6, 1.5])("refuses a repeat of %s and starts no run", async (repeat) => {
      const result = await runTool({ slug: "my-evaluation", repeat });

      expect(result.isError).toBe(true);
      expect(textOf(result)).toMatch(/repeat/);
      expect(mockMakeRequest).not.toHaveBeenCalled();
    });
  });

  describe("when an agent lists the tools", () => {
    /** @scenario "The MCP run tool tells an agent to repeat rows to tell noise from real failures" */
    it("describes the repeat as the way to tell noise from real failures", async () => {
      const { tools } = await client.listTools();
      const tool = tools.find((candidate) => candidate.name === "platform_run_experiment");

      expect(tool?.description).toMatch(/run again with `repeat`/);
      expect(tool?.description).toMatch(/noise/);
      expect(tool?.inputSchema.properties).toHaveProperty("repeat");
    });
  });
});
