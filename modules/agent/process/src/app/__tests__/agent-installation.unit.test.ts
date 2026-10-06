import { AuditLogApi } from "@langwatch/audit-log-contract";
import { createApp, MissingProviderError } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import { agentProcessModule } from "../../agent.module.ts";
import { AgentModule } from "../agent.app.ts";

function bootWithoutPeers() {
  return Promise.resolve().then(() =>
    createApp({ role: "api" })
      .withModules([agentProcessModule])
      .withStores(memoryStores())
      .withConfig({
        agent: { replicaCount: 1, relayMaxPayloadMb: undefined, publicBaseUrl: undefined },
      })
      // @ts-expect-error MissingSupply: the compiler refuses a process that supplies no Agent peers
      .boot(),
  );
}

describe("agent installation", () => {
  describe("when a process boots without the peers Agent declares", () => {
    /** @scenario "Missing peer implementations fail boot" */
    it("declares Workflow and Audit Log among its peers", () => {
      expect(AgentModule.dependencies.workflows).toBe(WorkflowApi);
      expect(AgentModule.dependencies.auditLog).toBe(AuditLogApi);
    });

    /** @scenario "Missing peer implementations fail boot" */
    it("refuses the boot, naming Agent and the peer no installed module provides", async () => {
      const boot = bootWithoutPeers();

      await expect(boot).rejects.toBeInstanceOf(MissingProviderError);
      await expect(boot).rejects.toMatchObject({
        feature: "agent",
        dependencyKey: expect.stringMatching(
          new RegExp(`^(${Object.keys(AgentModule.dependencies).join("|")})$`),
        ),
      });
      await expect(boot).rejects.toThrow(/no installed feature provides it/);
    });

    /** @scenario "Missing peer implementations fail boot" */
    it("yields no runtime to serve, so no partial service stands in for the peer", async () => {
      const runtime = await bootWithoutPeers().then(
        (booted) => booted,
        () => undefined,
      );

      expect(runtime).toBeUndefined();
    });
  });
});
