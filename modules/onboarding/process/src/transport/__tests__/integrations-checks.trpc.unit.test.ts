/**
 * @vitest-environment node
 * @see modules/onboarding/specs/integrations-checks.feature
 */
import { createTrpcRuntime } from "@langwatch/api/trpc";
import {
  integrationsChecksTrpc,
  integrationsCheckStatusSchema,
  type IntegrationsCheckStatus,
} from "@langwatch/onboarding-contract";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import { initTRPC, TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { integrationsChecksTrpcTransport } from "../integrations-checks.trpc.ts";

type TestContext = { actor: { id: string } };

const NOTHING_DONE: IntegrationsCheckStatus = {
  workflows: 0,
  customGraphs: 0,
  datasets: 0,
  onlineEvaluations: 0,
  simulations: 0,
  modelProviders: 0,
  prompts: 0,
  teamMembers: 1,
  firstMessage: false,
  integrated: false,
  guidedOnboarding: { variant: null, paths: [], donePaths: [] },
};

function mount({ permits = () => true }: { permits?: (permission: string) => boolean } = {}) {
  const asked: string[] = [];
  const reader = vi.fn(async (_input: { projectId: string }) => NOTHING_DONE);
  const trpc = initTRPC.context<TestContext>().create();
  const router = createTrpcRuntime<TestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: trpcTestMembers<TestContext>({
      permits: (permission) => {
        asked.push(permission);
        return permits(permission);
      },
    }),
  }).mount(integrationsChecksTrpcTransport, () => ({ getCheckStatus: reader }));

  return { reader, asked, caller: router.createCaller({ actor: { id: "reader" } }) };
}

describe("the integrationsChecks tRPC namespace", () => {
  it("declares one query, getCheckStatus", () => {
    expect(integrationsChecksTrpc.namespace).toBe("integrationsChecks");
    expect(Object.keys(integrationsChecksTrpc.members)).toEqual(["getCheckStatus"]);
    expect(integrationsChecksTrpc.members.getCheckStatus?.kind).toBe("query");
  });

  describe("given a caller who may update the project", () => {
    /** @scenario "The checklist answers through the tRPC door with main's shape" */
    it("answers the checklist in main's shape, asking project:update", async () => {
      const { caller, reader, asked } = mount();

      const answer = await caller.getCheckStatus({ projectId: "project-1" });

      expect(integrationsCheckStatusSchema.parse(answer)).toEqual(NOTHING_DONE);
      expect(reader).toHaveBeenCalledWith({ projectId: "project-1" });
      expect(asked).toEqual(["project:update"]);
    });
  });

  describe("given a caller who may only view the project", () => {
    /** @scenario "The setup checklist is gated on project update" */
    it("refuses before the checklist is read", async () => {
      const { caller, reader } = mount({ permits: (permission) => permission === "project:view" });

      await expect(caller.getCheckStatus({ projectId: "project-1" })).rejects.toBeInstanceOf(
        TRPCError,
      );
      expect(reader).not.toHaveBeenCalled();
    });
  });
});
