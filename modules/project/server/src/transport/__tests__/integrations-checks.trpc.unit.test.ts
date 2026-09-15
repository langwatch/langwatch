/**
 * @vitest-environment node
 * The `integrationsChecks.*` surface: the one procedure the onboarding screens
 * call, the project it forwards, and the rollup it hands back. What it owns is
 * that the project id reaching the reader is the PARSED one.
 */
import { createTrpcRuntime } from "@langwatch/api/trpc";
import type { IntegrationsCheckStatus } from "@langwatch/project-contract";
import { initTRPC, TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { integrationsChecksTrpcTransport } from "../integrations-checks.trpc.ts";
import { projectTrpcTestPorts, type ProjectTrpcTestContext } from "./project.trpc.harness.ts";

const NOTHING_DONE: IntegrationsCheckStatus = {
  workflows: 0,
  customGraphs: 0,
  datasets: 0,
  onlineEvaluations: 0,
  triggers: 0,
  simulations: 0,
  modelProviders: 0,
  prompts: 0,
  teamMembers: 0,
  firstMessage: false,
  integrated: false,
};

function mount({
  getCheckStatus = async () => NOTHING_DONE,
}: {
  getCheckStatus?: (input: { projectId: string }) => Promise<IntegrationsCheckStatus>;
} = {}) {
  const reader =
    vi.fn<(input: { projectId: string }) => Promise<IntegrationsCheckStatus>>(getCheckStatus);
  const trpc = initTRPC.context<ProjectTrpcTestContext>().create();
  const router = createTrpcRuntime<ProjectTrpcTestContext>({
    root: trpc,
    procedure: trpc.procedure,
    ports: projectTrpcTestPorts(),
  }).mount(integrationsChecksTrpcTransport, () => ({ getCheckStatus: reader }));

  return { reader, caller: router.createCaller({ actor: { id: "reader" } }) };
}

describe("the integrationsChecks tRPC namespace", () => {
  describe("given a caller who may change the project", () => {
    it("forwards the validated project id and answers with the deployment's rollup", async () => {
      const rollup: IntegrationsCheckStatus = { ...NOTHING_DONE, workflows: 1, integrated: true };
      const { caller, reader } = mount({ getCheckStatus: async () => rollup });

      await expect(caller.getCheckStatus({ projectId: "project-1" })).resolves.toEqual(rollup);
      expect(reader).toHaveBeenCalledTimes(1);
      expect(reader).toHaveBeenCalledWith({ projectId: "project-1" });
    });
  });

  describe("when the caller names no project", () => {
    it("refuses on the parser and never reaches the rollup", async () => {
      const { caller, reader } = mount();

      await expect(
        (caller as unknown as { getCheckStatus(input: unknown): Promise<unknown> }).getCheckStatus(
          {},
        ),
      ).rejects.toBeInstanceOf(TRPCError);
      expect(reader).not.toHaveBeenCalled();
    });
  });
});
