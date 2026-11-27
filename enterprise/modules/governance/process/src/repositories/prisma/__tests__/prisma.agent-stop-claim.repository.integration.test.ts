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
import { KillSwitchAuditService } from "../../../features/kill-switch/services/kill-switch-audit.service.ts";
import { MemoryGovernanceRepositories } from "../../memory/memory.governance.repositories.ts";
import { PrismaAgentStopClaimRepository } from "../prisma.agent-stop-claim.repository.ts";
import { PrismaAgentStopTargetPriorStateRepository } from "../prisma.agent-stop-target-prior-state.repository.ts";
import { PrismaAgentStopRepository } from "../prisma.agent-stop.repository.ts";
import {
  AGENT_ID,
  connection,
  killSwitchDatabase,
  presentPlatforms,
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
      locks: { withLock: ({ run }) => run({ signal: new AbortController().signal }) },
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
        ...presentPlatforms({ memory }),
        virtualKeys: createApiFixture<GatewayApi>(),
      }),
      registry: memory.agentRegistry,
      audit: KillSwitchAuditService.create({
        auditLog: createApiFixture<AuditLogApi>({
          record: async () => ({ id: "audit", occurredAt: 0 }),
        }),
        outbox: () => undefined,
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

      const decide = (decision: "approve" | "deny") =>
        claims.takeDecision({
          organizationId,
          stopId: opened.id,
          decision,
          takenAt: Date.now(),
          abandonedBefore: Date.now() - 60_000,
        });

      const taken = await Promise.all([decide("approve"), decide("deny")]);

      expect(taken.filter(Boolean)).toHaveLength(1);
    });
  });

  describe("when a decision was taken and its command never landed", () => {
    /** @scenario "A decision left by a process that died before sending it is taken over once abandoned" */
    it("refuses another decision until the first is abandoned, then lets it take over", async () => {
      const organizationId = newOrganization();
      const { request } = await stopServiceOf(organizationId);
      const opened = await request();
      const claims = PrismaAgentStopClaimRepository.create(prisma());
      const takenAt = Date.parse("2026-11-16T10:00:00Z");
      const decide = ({ at, abandonedBefore }: { at: number; abandonedBefore: number }) =>
        claims.takeDecision({
          organizationId,
          stopId: opened.id,
          decision: "deny",
          takenAt: at,
          abandonedBefore,
        });

      expect(await decide({ at: takenAt, abandonedBefore: takenAt - 1 })).toBe(true);
      expect(await decide({ at: takenAt + 1, abandonedBefore: takenAt })).toBe(false);
      expect(await decide({ at: takenAt + 2, abandonedBefore: takenAt + 1 })).toBe(true);
    });
  });

  describe("when a decision was taken over by another holder", () => {
    /** @scenario "A decision left by a process that died before sending it is taken over once abandoned" */
    it("ignores the first holder's late release and mark, and keeps the new holder", async () => {
      const organizationId = newOrganization();
      const { request } = await stopServiceOf(organizationId);
      const opened = await request();
      const claims = PrismaAgentStopClaimRepository.create(prisma());
      const first = Date.parse("2026-11-16T10:00:00Z");
      const second = first + 10;
      const key = { organizationId, stopId: opened.id };
      await claims.takeDecision({
        ...key,
        decision: "deny",
        takenAt: first,
        abandonedBefore: first,
      });
      await claims.takeDecision({
        ...key,
        decision: "deny",
        takenAt: second,
        abandonedBefore: first + 1,
      });

      await claims.releaseDecision({ ...key, decision: "deny", takenAt: first });
      await claims.markDecisionSent({ ...key, decision: "deny", takenAt: first });

      expect(
        await claims.takeDecision({
          ...key,
          decision: "approve",
          takenAt: second + 1,
          abandonedBefore: second,
        }),
      ).toBe(false);
      expect(
        await claims.takeDecision({
          ...key,
          decision: "approve",
          takenAt: second + 2,
          abandonedBefore: second + 1,
        }),
      ).toBe(true);
    });
  });

  describe("when a decision's command was sent", () => {
    /** @scenario "A sent decision is never taken over as abandoned" */
    it("refuses every later decision however old the first is", async () => {
      const organizationId = newOrganization();
      const { request } = await stopServiceOf(organizationId);
      const opened = await request();
      const claims = PrismaAgentStopClaimRepository.create(prisma());
      const takenAt = Date.parse("2026-11-16T10:00:00Z");
      const key = { organizationId, stopId: opened.id };
      await claims.takeDecision({ ...key, decision: "approve", takenAt, abandonedBefore: takenAt });

      await claims.markDecisionSent({ ...key, decision: "approve", takenAt });

      expect(
        await claims.takeDecision({
          ...key,
          decision: "deny",
          takenAt: takenAt + 1,
          abandonedBefore: takenAt + 1_000_000,
        }),
      ).toBe(false);
    });
  });

  describe("when an abandoned claim is taken over while its request is marked sent", () => {
    /** @scenario "A claim marked sent is never taken over as abandoned" */
    it("refuses the takeover of a sent claim and keeps the sent stop's claim", async () => {
      const organizationId = newOrganization();
      const claims = PrismaAgentStopClaimRepository.create(prisma());
      const stopId = `agentstop-${ns}-sent`;
      await claims.create({ organizationId, agentId: AGENT_ID, stopId, claimedAt: 1 });
      await claims.markSent({ organizationId, agentId: AGENT_ID, stopId, sentAt: 2 });
      const takeover = {
        organizationId,
        agentId: AGENT_ID,
        fromStopId: stopId,
        toStopId: `agentstop-${ns}-next`,
        claimedAt: 3,
      };

      expect(await claims.swap({ ...takeover, onlyIfUnsent: true })).toBe(false);
      expect(
        (await claims.findClaims({ organizationId, agentId: AGENT_ID })).map((c) => c.stopId),
      ).toEqual([stopId]);
      expect(await claims.swap({ ...takeover, onlyIfUnsent: false })).toBe(true);
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

      const answers = await Promise.all([
        states.recordOnce({ ...key, wasStopped: false, recordedAt: 1 }),
        states.recordOnce({ ...key, wasStopped: true, recordedAt: 2 }),
      ]);

      const persisted = await states.findPriorStates(key);
      expect(persisted).toHaveLength(1);
      expect(answers).toEqual([persisted[0], persisted[0]]);
    });
  });
});
