/**
 * @vitest-environment node
 * The `llmModelCost.*` wire, pinned: every procedure name and its standing. A
 * rename here is a cache-key change in every browser that calls it.
 */
import { createTrpcRuntime } from "@langwatch/api/trpc";
import {
  getStaticModelCostRates,
  modelCostListRowSchema,
  type ModelProviderApi,
} from "@langwatch/model-provider-contract";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { llmModelCostTrpcTransport } from "../llm-model-cost.trpc.ts";
import {
  mountableModelProviderApp,
  modelProviderTrpcTestMembers,
  type ModelProviderTestDecision,
  type ModelProviderTrpcTestContext,
} from "./model-provider.harness.ts";

const PROJECT_ID = "project-1";

function stored(input: { id: string; scopeType: "PROJECT" | "ORGANIZATION"; scopeId: string }) {
  const at = new Date("2026-05-15T12:00:00Z");
  return {
    ...input,
    organizationId: "organization-1",
    model: `custom/${input.id}`,
    regex: `^custom/${input.id}$`,
    inputCostPerToken: 0.000001,
    outputCostPerToken: null,
    cacheReadCostPerToken: null,
    cacheCreationCostPerToken: null,
    cacheCreation1hCostPerToken: null,
    createdAt: at,
    updatedAt: at,
  };
}

function mount(
  options: {
    modelProviders?: Partial<ModelProviderApi>;
    permits?: ModelProviderTestDecision;
    spans?: unknown;
  } = {},
) {
  const { app, repositories } = mountableModelProviderApp({
    modelProviders: options.modelProviders ?? {},
    spans: options.spans,
  });

  const trpc = initTRPC.context<ModelProviderTrpcTestContext>().create();
  const router = createTrpcRuntime<ModelProviderTrpcTestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: modelProviderTrpcTestMembers(options.permits ?? (() => true)),
  }).mount(llmModelCostTrpcTransport, () => app);

  return {
    router,
    repositories,
    caller: router.createCaller({ actor: { id: "user-1" } }),
  };
}

describe("the llmModelCost tRPC namespace", () => {
  describe("given the mounted router", () => {
    it("exposes exactly the procedure names the clients call", () => {
      const { router } = mount();

      expect(Object.keys(router._def.procedures).toSorted()).toEqual([
        "createOrUpdate",
        "delete",
        "getAllForProject",
        "getModelLimits",
        "previewMatchingSpans",
      ]);
    });
  });

  describe("when the model-costs page lists a project's costs", () => {
    it("answers main's body: the stored rules, most specific first, then every catalogue rate", async () => {
      const { caller, repositories } = mount();
      await repositories.costs.save(
        stored({ id: "cost-org", scopeType: "ORGANIZATION", scopeId: "organization-1" }),
      );
      await repositories.costs.save(
        stored({ id: "cost-project", scopeType: "PROJECT", scopeId: PROJECT_ID }),
      );

      const listed = await caller.getAllForProject({ projectId: PROJECT_ID });

      const catalogue = getStaticModelCostRates();
      expect(catalogue).toHaveLength(434);
      expect(listed).toHaveLength(2 + catalogue.length);
      expect(listed.slice(0, 2).map((row) => ("id" in row ? row.id : null))).toEqual([
        "cost-project",
        "cost-org",
      ]);
      expect(listed.slice(2)).toEqual(catalogue.map((rate) => ({ ...rate, projectId: "" })));
      // The runtime only logs a body its declared output refuses, so the schema is asked directly.
      expect(listed.every((row) => modelCostListRowSchema.validate(row))).toBe(true);
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
      const upsertCost = vi.fn(async (..._args: Parameters<ModelProviderApi["upsertCost"]>) =>
        stored({ id: "cost-1", scopeType: "PROJECT", scopeId: PROJECT_ID }),
      );
      const { caller } = mount({ modelProviders: { upsertCost } });

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
        caller.getModelLimits({ projectId: PROJECT_ID, model: "no-such-model" }),
      ).resolves.toBeNull();
    });
  });
});
