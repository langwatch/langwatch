// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What a stop request's failed send does to the agent's claim, over memory repositories.
 * Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import { ValidationError } from "@langwatch/eventing";
import type { GatewayApi } from "@langwatch/gateway-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { MemoryGovernanceRepositories } from "../../../../repositories/memory/memory.governance.repositories.ts";
import {
  presentPlatforms,
  seedRegistry,
} from "../../../../repositories/prisma/__tests__/prisma.kill-switch.fixtures.ts";
import { AgentStopClaimService } from "../agent-stop-claim.service.ts";
import { AgentStopPlanService } from "../agent-stop-plan.service.ts";
import { type AgentStopCommandSend, AgentStopService } from "../agent-stop.service.ts";
import { KillSwitchAuditService } from "../kill-switch-audit.service.ts";
import { codeOf } from "./kill-switch-steps.fixtures.ts";
import { AGENT_ID, ORG, PERSON } from "./kill-switch.fixtures.ts";

/** A stop service whose first `request` send fails with `failure`, and whose later sends land. */
async function serviceFailingFirstSendWith(failure: Error) {
  const repositories = MemoryGovernanceRepositories.create();
  await seedRegistry({ memory: repositories, organizationId: ORG });
  await repositories.agentStopPlans.replaceTargets({
    organizationId: ORG,
    agentId: AGENT_ID,
    targets: [
      {
        id: "target-vk",
        label: "Virtual key vk-support-bot",
        target: { kind: "gateway_virtual_key", virtualKeyId: "vk-support-bot" },
      },
    ],
  });
  let failed = false;
  const send: AgentStopCommandSend = async () => {
    if (failed) return;
    failed = true;
    throw failure;
  };
  let ids = 0;
  const service = AgentStopService.create({
    stops: repositories.agentStops,
    claims: AgentStopClaimService.create({
      claims: repositories.agentStopClaims,
      stops: repositories.agentStops,
    }),
    plans: AgentStopPlanService.create({
      plans: repositories.agentStopPlans,
      registry: repositories.agentRegistry,
      sources: repositories.ingestionSources,
      awsConnections: repositories.awsConnections,
      virtualKeys: createApiFixture<GatewayApi>(),
      ...presentPlatforms({ memory: repositories }),
    }),
    locks: repositories.killSwitchLock,
    registry: repositories.agentRegistry,
    audit: KillSwitchAuditService.create({
      auditLog: createApiFixture<AuditLogApi>({
        record: async () => ({ id: "audit", occurredAt: 0 }),
      }),
      outbox: () => undefined,
    }),
    send,
    newId: () => `agentstop-send-${++ids}`,
  });
  const request = () =>
    service.requestStop({
      organizationId: ORG,
      agentId: AGENT_ID,
      reason: "prompt injection in production",
      severity: "critical",
      caller: PERSON,
    });
  return { request };
}

describe("AgentStopService.requestStop", () => {
  describe("when the send fails without a known cause", () => {
    /** @scenario "A stop request whose send failed unclearly keeps the agent's claim" */
    it("keeps the claim, so a second stop cannot open beside one that may have landed", async () => {
      const { request } = await serviceFailingFirstSendWith(new Error("socket hang up"));

      await expect(request()).rejects.toThrow("socket hang up");

      expect(await codeOf(request())).toBe("agent_stop_already_open");
    });
  });

  describe("when the queue refuses the payload before it is queued", () => {
    /** @scenario "A stop request refused before it was sent gives the claim back" */
    it("releases the claim, so the next request opens its stop", async () => {
      const { request } = await serviceFailingFirstSendWith(
        new ValidationError({ reason: "Invalid payload for command type", field: "payload" }),
      );

      await expect(request()).rejects.toMatchObject({ name: "ValidationError" });

      expect((await request()).status).toBe("stopping");
    });
  });
});
