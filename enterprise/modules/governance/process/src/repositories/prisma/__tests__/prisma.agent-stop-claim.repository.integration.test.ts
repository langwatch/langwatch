// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The open-stop claim and the target prior states in Postgres.
 * Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { afterAll, describe, expect, it } from "vitest";

import { AgentStopClaimService } from "../../../features/kill-switch/services/agent-stop-claim.service.ts";
import { AgentStopPlanService } from "../../../features/kill-switch/services/agent-stop-plan.service.ts";
import { AgentStopService } from "../../../features/kill-switch/services/agent-stop.service.ts";
import { MemoryGovernanceRepositories } from "../../memory/memory.governance.repositories.ts";
import { PrismaAgentStopClaimRepository } from "../prisma.agent-stop-claim.repository.ts";
import { PrismaAgentStopTargetPriorStateRepository } from "../prisma.agent-stop-target-prior-state.repository.ts";
import { PrismaAgentStopRepository } from "../prisma.agent-stop.repository.ts";
import {
  AGENT_ID,
  connection,
  killSwitchDatabase,
  projectStop as projectStopIn,
  seedRegistry,
} from "./prisma.kill-switch.fixtures.ts";

describe.skipIf(!connection)("the kill switch claim and prior state repositories", () => {
  const { ns, newOrganization, prisma, awsConnections, cleanup } = killSwitchDatabase();
  const projectStop = (input: Omit<Parameters<typeof projectStopIn>[0], "prisma">) =>
    projectStopIn({ prisma, ...input });

  afterAll(cleanup);

  /** The api side of a stop over Postgres; `send` records the commands and runs no worker. */
  async function stopServiceOf(organizationId: string) {
    const memory = MemoryGovernanceRepositories.create();
    await seedRegistry({ memory, organizationId });
    await memory.agentStopPlans.replaceTargets({
      organizationId,
      agentId: AGENT_ID,
      targets: [
        {
          id: "target-vk",
          label: "Virtual key vk-support-bot",
          target: { kind: "gateway_virtual_key", virtualKeyId: "vk-support-bot" },
        },
      ],
    });
    const sent: string[] = [];
    let ids = 0;
    const service = AgentStopService.create({
      stops: PrismaAgentStopRepository.create(prisma()),
      claims: AgentStopClaimService.create({
        claims: PrismaAgentStopClaimRepository.create(prisma()),
        stops: PrismaAgentStopRepository.create(prisma()),
      }),
      plans: AgentStopPlanService.create({
        plans: memory.agentStopPlans,
        registry: memory.agentRegistry,
        sources: memory.ingestionSources,
        awsConnections: awsConnections(),
        virtualKeys: createApiFixture<GatewayApi>(),
      }),
      registry: memory.agentRegistry,
      auditLog: createApiFixture<AuditLogApi>({
        record: async () => ({ id: "audit", occurredAt: 0 }),
      }),
      send: async (name) => {
        sent.push(name);
      },
      newId: () => `agentstop-${ns}-${organizationId.slice(-2)}-${++ids}`,
    });
    const request = () =>
      service.requestStop({
        organizationId,
        agentId: AGENT_ID,
        reason: "data exfiltration attempt",
        severity: "critical",
        caller: { userId: "user-ops", apiKeyId: null },
      });
    return { service, sent, request };
  }

  describe("when two stop requests for one agent arrive at the same moment", () => {
    /** @scenario "Two stop requests at the same moment open one stop" */
    it("opens exactly one stop and refuses the other with agent_stop_already_open", async () => {
      const organizationId = newOrganization();
      const { sent, request } = await stopServiceOf(organizationId);

      const outcomes = await Promise.allSettled([request(), request(), request()]);

      const opened = outcomes.filter((outcome) => outcome.status === "fulfilled");
      const refused = outcomes.flatMap((outcome) =>
        outcome.status === "rejected" ? [(outcome.reason as { code?: string }).code] : [],
      );
      expect(opened).toHaveLength(1);
      expect(refused).toEqual(["agent_stop_already_open", "agent_stop_already_open"]);
      expect(sent).toEqual(["request"]);
      const claims = await prisma().agentStopClaim.findMany({ where: { organizationId } });
      expect(claims.map((claim) => claim.stopId)).toEqual([
        opened[0]?.status === "fulfilled" ? opened[0].value.id : "none",
      ]);
    });
  });

  describe("when the agent's open stop has closed", () => {
    it("lets the next request take the claim over", async () => {
      const organizationId = newOrganization();
      const { request } = await stopServiceOf(organizationId);
      const first = await request();
      await projectStop({ organizationId, stopId: first.id, status: "quarantined" });
      await expect(request()).rejects.toMatchObject({ code: "agent_stop_already_open" });

      await projectStop({ organizationId, stopId: first.id, status: "restored" });
      const second = await request();

      expect(second.id).not.toBe(first.id);
      const claims = await prisma().agentStopClaim.findMany({ where: { organizationId } });
      expect(claims.map((claim) => claim.stopId)).toEqual([second.id]);
    });
  });

  describe("when an approval and a denial of one pending stop arrive at once", () => {
    it("lets exactly one take the stop's decision", async () => {
      const organizationId = newOrganization();
      const { request } = await stopServiceOf(organizationId);
      const opened = await request();
      const claims = PrismaAgentStopClaimRepository.create(prisma());

      const taken = await Promise.all([
        claims.takeDecision({ organizationId, stopId: opened.id, decision: "approve" }),
        claims.takeDecision({ organizationId, stopId: opened.id, decision: "deny" }),
      ]);

      expect(taken.filter(Boolean)).toHaveLength(1);
    });
  });

  describe("when a stop's request was sent", () => {
    it("marks the claim sent", async () => {
      const organizationId = newOrganization();
      const { request } = await stopServiceOf(organizationId);

      const opened = await request();

      const [claim] = await PrismaAgentStopClaimRepository.create(prisma()).findClaims({
        organizationId,
        agentId: AGENT_ID,
      });
      expect(claim?.stopId).toBe(opened.id);
      expect(claim?.sentAt).not.toBeNull();
    });
  });

  describe("when two workers record a target's prior state at once", () => {
    it("keeps the first value and answers it to both", async () => {
      const organizationId = newOrganization();
      const states = PrismaAgentStopTargetPriorStateRepository.create(prisma());
      const key = { organizationId, stopId: `agentstop-${ns}-prior`, targetId: "target-vk" };

      const first = await states.recordOnce({ ...key, wasStopped: false, recordedAt: 1 });
      const second = await states.recordOnce({ ...key, wasStopped: true, recordedAt: 2 });

      expect([first, second]).toEqual([false, false]);
      expect(await states.findPriorStates(key)).toEqual([false]);
    });
  });
});
