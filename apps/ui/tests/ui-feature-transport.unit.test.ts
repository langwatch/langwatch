import type { FeatureApiClient } from "@langwatch/platform-api-client";
import type { QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { createUiFeatureApiClient, uiFeatureApi } from "../src/behavior/ui-feature-transport";

type Call = { url: string; method: string };

function transportOver(bodies: unknown[]): {
  client: ReturnType<typeof createUiFeatureApiClient>;
  calls: Call[];
} {
  const calls: Call[] = [];
  const queue = [...bodies];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? "GET" });
    return new Response(JSON.stringify(queue.shift()), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;

  return { client: createUiFeatureApiClient({ fetch }), calls };
}

/** One tRPC result, in the shape superjson-encoded transport sends back. */
function resultOf(data: unknown): unknown {
  return { result: { data: { json: data } } };
}

describe("given the browser transport a feature package's hooks run on", () => {
  describe("when a feature queries a procedure", () => {
    it("sends it to the same-origin platform API and decodes the answer", async () => {
      const { client, calls } = transportOver([[resultOf({ id: "prompt_1" })]]);

      const output = await client.query("prompts.getById", { id: "prompt_1" });

      expect(output).toEqual({ id: "prompt_1" });
      expect(calls[0]?.url.startsWith("/api/trpc/prompts.getById")).toBe(true);
    });

    it("batches by default, so several calls in one tick share a request", async () => {
      const { client, calls } = transportOver([[resultOf("a"), resultOf("b")]]);

      const outputs = await Promise.all([
        client.query("prompts.getById", { id: "a" }),
        client.query("prompts.getAll", { projectId: "p" }),
      ]);

      expect(outputs).toEqual(["a", "b"]);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toContain("batch=1");
    });
  });

  describe("when a feature asks for its own connection", () => {
    it("sends that call unbatched, the way the host reads the same flag", async () => {
      const { client, calls } = transportOver([resultOf({ enabled: true }), [resultOf("other")]]);

      const outputs = await Promise.all([
        client.query("featureFlag.isEnabled", { flag: "x" }, { context: { skipBatch: true } }),
        client.query("prompts.getAll", { projectId: "p" }),
      ]);

      expect(outputs).toEqual([{ enabled: true }, "other"]);
      expect(calls).toHaveLength(2);
      expect(calls.some((call) => !call.url.includes("batch=1"))).toBe(true);
    });
  });

  describe("when a feature mutates", () => {
    it("posts to the same endpoint", async () => {
      const { client, calls } = transportOver([[resultOf({ id: "prompt_2" })]]);

      await client.mutation("prompts.create", { name: "New" });

      expect(calls[0]?.method).toBe("POST");
      expect(calls[0]?.url.startsWith("/api/trpc/prompts.create")).toBe(true);
    });
  });

  describe("when the platform API answers with an error", () => {
    it("surfaces it to the caller rather than resolving with nothing", async () => {
      const { client } = transportOver([
        [{ error: { json: { message: "not_found", code: -32004, data: {} } } }],
      ]);

      await expect(client.query("prompts.getById", { id: "missing" })).rejects.toThrow("not_found");
    });
  });
});

type PromptApiMap = {
  prompts: { getById: { query: { input: { id: string }; output: { id: string } } } };
};

describe("given a feature package's typed hooks", () => {
  describe("when the application declares that they run on its transport", () => {
    it("keeps the feature's own Provider, named for composition diagnostics", () => {
      const Provider = ({
        children,
      }: {
        client: FeatureApiClient<PromptApiMap>;
        queryClient: QueryClient;
        children: ReactNode;
      }) => children;

      const binding = uiFeatureApi<PromptApiMap>({
        name: "@langwatch/prompt-web",
        api: { Provider },
      });

      expect(binding.name).toBe("@langwatch/prompt-web");
      expect(binding.Provider).toBe(Provider);
    });
  });
});
