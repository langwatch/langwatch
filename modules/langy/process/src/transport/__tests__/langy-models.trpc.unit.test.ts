/**
 * @vitest-environment node
 * The model list procedures over a real tRPC runtime: each permission is asked before the panel.
 * @see specs/langy/langy-model-allowlist.feature
 */
import {
  bindTrpcMiddlewareContext,
  createTrpcRuntime,
  defineMiddlewareContext,
} from "@langwatch/api/trpc";
import type { LangyApi } from "@langwatch/langy-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { langyTrpcTransport } from "../langy.trpc.ts";

type TestContext = {
  actor: { id: string };
  person: { name: string | null; email: string | null } | null;
};

const sessionPerson = defineMiddlewareContext(
  "organizationSessionPerson",
  z.object({ name: z.string().nullable(), email: z.string().nullable() }).nullable(),
);

const projectId = "project_1";

function served({ granted }: { granted: readonly string[] }) {
  const asked: string[] = [];
  const setModelsAllowed = vi.fn<LangyApi["setModelsAllowed"]>(async (input) => ({
    modelsAllowed: input.modelsAllowed,
  }));
  const getModelsAllowed = vi.fn<LangyApi["getModelsAllowed"]>(async () => ({
    modelsAllowed: ["openai/gpt-5"],
  }));
  const trpc = initTRPC.context<TestContext>().create();
  const caller = createTrpcRuntime<TestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: trpcTestMembers<TestContext>({
      permits: (permission) => {
        asked.push(permission);
        return granted.includes(permission);
      },
    }),
  })
    .mount(
      langyTrpcTransport,
      () => createApiFixture<LangyApi>({ setModelsAllowed, getModelsAllowed }),
      {
        middlewareContext: [bindTrpcMiddlewareContext(sessionPerson, (ctx) => ctx.person)],
      },
    )
    .createCaller({ actor: { id: "user_ana" }, person: { name: "Ana", email: "ana@acme.com" } });

  return { caller, asked, setModelsAllowed, getModelsAllowed };
}

describe("langy model list procedures", () => {
  describe("given a member without langy:manage", () => {
    /** @scenario "Only a project admin may change Langy's models" */
    it("refuses the save before the panel runs, and still answers the read", async () => {
      const { caller, asked, setModelsAllowed } = served({ granted: ["langy:view"] });

      await expect(
        caller.setModelsAllowed({ projectId, modelsAllowed: ["openai/gpt-5"] }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(setModelsAllowed).not.toHaveBeenCalled();
      expect(asked).toContain("langy:manage");

      await expect(caller.modelsAllowed({ projectId })).resolves.toEqual({
        modelsAllowed: ["openai/gpt-5"],
      });
    });
  });

  describe("given a project admin", () => {
    it("hands the save to the panel with the session's person as the caller", async () => {
      const { caller, setModelsAllowed } = served({ granted: ["langy:view", "langy:manage"] });

      await caller.setModelsAllowed({ projectId, modelsAllowed: ["openai/gpt-5"] });

      expect(setModelsAllowed).toHaveBeenCalledWith({
        projectId,
        modelsAllowed: ["openai/gpt-5"],
        caller: { userId: "user_ana", name: "Ana", email: "ana@acme.com" },
      });
    });

    /** @scenario "A model reference without a provider is refused" */
    it("refuses a model with no provider as invalid input, saving nothing", async () => {
      const { caller, setModelsAllowed } = served({ granted: ["langy:view", "langy:manage"] });

      await expect(
        caller.setModelsAllowed({ projectId, modelsAllowed: ["gpt-5"] }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(setModelsAllowed).not.toHaveBeenCalled();
    });
  });
});
