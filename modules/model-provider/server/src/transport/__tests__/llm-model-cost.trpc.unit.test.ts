/**
 * @vitest-environment node
 * The `llmModelCost.*` wire, pinned: every procedure name and its standing. A
 * rename here is a cache-key change in every browser that calls it.
 */
import { createTrpcRuntime } from "@langwatch/api/trpc";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { llmModelCostTrpcTransport } from "../llm-model-cost.trpc.ts";
import {
  mountableModelProviderApp,
  modelProviderTrpcTestPorts,
  type ModelProviderTestDecision,
  type ModelProviderTrpcTestContext,
} from "./model-provider.harness.ts";

const PROJECT_ID = "project-1";

function mount(
  options: {
    modelProviders?: Partial<ModelProviderService>;
    permits?: ModelProviderTestDecision;
    spans?: unknown;
  } = {},
) {
  const { app } = mountableModelProviderApp({
    modelProviders: options.modelProviders ?? {},
    spans: options.spans,
  });

  const trpc = initTRPC.context<ModelProviderTrpcTestContext>().create();
  const router = createTrpcRuntime<ModelProviderTrpcTestContext>({
    root: trpc,
    procedure: trpc.procedure,
    ports: modelProviderTrpcTestPorts(options.permits ?? (() => true)),
  }).mount(llmModelCostTrpcTransport, () => app);

  return { router, caller: router.createCaller({ actor: { id: "user-1" } }) };
}

describe("the llmModelCost tRPC namespace", () => {
  describe("given the mounted router", () => {
    it("exposes exactly the procedure names the clients call", () => {
      const { router } = mount();

      expect(Object.keys(router._def.procedures).sort()).toEqual([
        "createOrUpdate",
        "delete",
        "getAllForProject",
        "previewMatchingSpans",
        "tryGetModelLimits",
      ]);
    });
  });

  describe("given a caller who does not hold traces:view", () => {
    describe("when they ask the cost-rule preview what a pattern would match", () => {
      it("refuses: the answer is span metadata, not cost-rule configuration", async () => {
        const { caller } = mount({ permits: (permission) => permission !== "traces:view" });

        await expect(
          caller.previewMatchingSpans({ projectId: PROJECT_ID, regex: "gpt-5" }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      });
    });
  });

  describe("given a process that composed no span reader", () => {
    describe("when the preview is asked for", () => {
      it("says the deployment cannot answer rather than reporting no matches", async () => {
        const { caller } = mount({ spans: {} });

        await expect(
          caller.previewMatchingSpans({ projectId: PROJECT_ID, regex: "gpt-5" }),
        ).rejects.toMatchObject({ message: expect.stringContaining("not available") });
      });
    });
  });

  describe("when a cost rule is written with no scope of its own", () => {
    it("anchors it to the project the caller named", async () => {
      const upsertCost = vi.fn(async () => ({ id: "cost-1" }));
      const { caller } = mount({ modelProviders: { upsertCost: upsertCost as never } });

      await caller.createOrUpdate({
        projectId: PROJECT_ID,
        model: "gpt-5",
        regex: "^gpt-5$",
        inputCostPerToken: 1,
      });

      expect(upsertCost.mock.calls[0]?.[0]).toMatchObject({
        projectId: PROJECT_ID,
        scopeType: "PROJECT",
        scopeId: PROJECT_ID,
      });
      // The caller arrives as an argument; the application is what stamps the
      // write with them, so the door never has to remember to.
      expect(upsertCost.mock.calls[0]?.[1]).toMatchObject({ id: "user-1" });
    });
  });

  describe("when a cost rule's pattern can backtrack catastrophically", () => {
    it("refuses the write before the application is reached", async () => {
      const upsertCost = vi.fn();
      const { caller } = mount({ modelProviders: { upsertCost: upsertCost as never } });

      await expect(
        caller.createOrUpdate({
          projectId: PROJECT_ID,
          model: "gpt-5",
          regex: "(a+)+$",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(upsertCost).not.toHaveBeenCalled();
    });
  });

  describe("when the registry names no such model", () => {
    it("answers null rather than refusing", async () => {
      const { caller } = mount();

      await expect(
        caller.tryGetModelLimits({ projectId: PROJECT_ID, model: "no-such-model" }),
      ).resolves.toBeNull();
    });
  });
});
