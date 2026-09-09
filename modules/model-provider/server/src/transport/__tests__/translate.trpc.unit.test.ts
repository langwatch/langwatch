/**
 * @vitest-environment node
 * The `translate.*` wire, pinned: the one procedure name, the standing it
 * needs, and the ceiling it refuses a paste past.
 */
import { createTrpcRuntime } from "@langwatch/api/trpc";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { translateTrpcTransport } from "../translate.trpc.ts";
import {
  createModelProviderTestApp,
  modelProviderTrpcTestPorts,
  type ModelProviderTestDecision,
  type ModelProviderTrpcTestContext,
} from "./model-provider.harness.ts";

const PROJECT_ID = "project-1";

function mount(
  options: {
    modelProviders?: Partial<ModelProviderService>;
    permits?: ModelProviderTestDecision;
  } = {},
) {
  const { app } = createModelProviderTestApp({ modelProviders: options.modelProviders ?? {} });
  const trpc = initTRPC.context<ModelProviderTrpcTestContext>().create();
  const router = createTrpcRuntime<ModelProviderTrpcTestContext>({
    root: trpc,
    procedure: trpc.procedure,
    ports: modelProviderTrpcTestPorts(options.permits ?? (() => true)),
  }).mount(translateTrpcTransport, () => app);

  return { router, caller: router.createCaller({ actor: { id: "user-1" } }) };
}

describe("the translate tRPC namespace", () => {
  describe("given the mounted router", () => {
    it("exposes exactly the procedure name the clients call", () => {
      const { router } = mount();

      expect(Object.keys(router._def.procedures)).toEqual(["translate"]);
    });
  });

  describe("when a member who may read traces asks for a translation", () => {
    it("hands the text to the application under the field it names", async () => {
      const translate = vi.fn(async () => ({ translation: "hallo" }));
      const { caller } = mount({ modelProviders: { translate: translate as never } });

      const result = await caller.translate({
        projectId: PROJECT_ID,
        textToTranslate: "hello",
      });

      expect(result).toEqual({ translation: "hallo" });
      expect(translate).toHaveBeenCalledWith({ projectId: PROJECT_ID, text: "hello" });
    });
  });

  describe("given a caller who may not read traces", () => {
    describe("when they ask for a translation", () => {
      // Gated on trace-view rather than a translate-specific permission:
      // read-only members must not be shown an action that then refuses.
      it("refuses", async () => {
        const { caller } = mount({ permits: (permission) => permission !== "traces:view" });

        await expect(
          caller.translate({ projectId: PROJECT_ID, textToTranslate: "hello" }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      });
    });
  });
});
