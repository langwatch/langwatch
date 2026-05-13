import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

const { warnSpy } = vi.hoisted(() => ({ warnSpy: vi.fn() }));

vi.mock("~/utils/logger/server", () => ({
  createLogger: () => ({
    warn: warnSpy,
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  defineLangyTool,
  LANGY_TOOL_OUTPUT_INVALID_CODE,
  langyToolErrorEnvelope,
} from "../defineLangyTool";

const inputSchema = z.object({ q: z.string() });
const outputSchema = z.object({
  items: z.array(z.object({ id: z.string() })),
});

function invokeTool(
  toolDef: unknown,
  input: unknown,
): Promise<unknown> {
  const exec = (toolDef as { execute: (i: unknown) => Promise<unknown> })
    .execute;
  return exec(input);
}

describe("defineLangyTool", () => {
  describe("when execute returns data matching the output schema", () => {
    it("returns the parsed data unchanged", async () => {
      const tool = defineLangyTool({
        name: "list_things",
        description: "lists things",
        inputSchema,
        outputSchema,
        execute: async ({ q }) => ({ items: [{ id: q }] }),
      });

      const result = await invokeTool(tool, { q: "hello" });
      expect(result).toEqual({ items: [{ id: "hello" }] });
    });

    it("strips unknown fields from the result", async () => {
      const tool = defineLangyTool({
        name: "list_things",
        description: "lists things",
        inputSchema,
        outputSchema,
        execute: async ({ q }) =>
          ({
            items: [{ id: q, secret: "should_be_stripped" }],
            extra: "also_stripped",
          }) as unknown as { items: Array<{ id: string }> },
      });

      const result = (await invokeTool(tool, { q: "hello" })) as Record<
        string,
        unknown
      >;
      expect(result).toEqual({ items: [{ id: "hello" }] });
      expect(result).not.toHaveProperty("extra");
    });
  });

  describe("when execute returns data that does not match the output schema", () => {
    it("returns a structured error envelope, never raw output", async () => {
      const tool = defineLangyTool({
        name: "list_things",
        description: "lists things",
        inputSchema,
        outputSchema,
        execute: async () =>
          ({
            items: [{ id: 42 as unknown as string }],
          }) as unknown as { items: Array<{ id: string }> },
      });

      const result = await invokeTool(tool, { q: "hello" });
      expect(langyToolErrorEnvelope.safeParse(result).success).toBe(true);
      expect((result as { error: { code: string } }).error.code).toBe(
        LANGY_TOOL_OUTPUT_INVALID_CODE,
      );
    });

    it("includes the zod issues in the envelope for telemetry", async () => {
      const tool = defineLangyTool({
        name: "list_things",
        description: "lists things",
        inputSchema,
        outputSchema,
        execute: async () =>
          null as unknown as { items: Array<{ id: string }> },
      });

      const result = (await invokeTool(tool, { q: "x" })) as {
        error: { issues?: unknown[] };
      };
      expect(Array.isArray(result.error.issues)).toBe(true);
      expect((result.error.issues ?? []).length).toBeGreaterThan(0);
    });

    it("logs a warning with the tool name and zod issues", async () => {
      warnSpy.mockClear();
      const tool = defineLangyTool({
        name: "list_things_named",
        description: "lists things",
        inputSchema,
        outputSchema,
        execute: async () =>
          null as unknown as { items: Array<{ id: string }> },
      });

      await invokeTool(tool, { q: "x" });

      expect(warnSpy).toHaveBeenCalledTimes(1);
      const [meta, message] = warnSpy.mock.calls[0] ?? [];
      expect(meta).toEqual(
        expect.objectContaining({
          tool: "list_things_named",
          issues: expect.any(Array),
        }),
      );
      expect(message).toContain("failed schema validation");
    });
  });

  describe("when execute itself throws", () => {
    it("does not swallow the error — it propagates so the SDK can convert to tool-error", async () => {
      const tool = defineLangyTool({
        name: "list_things",
        description: "lists things",
        inputSchema,
        outputSchema,
        execute: async () => {
          throw new Error("upstream failed");
        },
      });

      await expect(invokeTool(tool, { q: "x" })).rejects.toThrow(
        "upstream failed",
      );
    });
  });
});
