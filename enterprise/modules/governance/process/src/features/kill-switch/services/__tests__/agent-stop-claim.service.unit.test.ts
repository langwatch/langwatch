/**
 * The open-stop claim: when a claim passes to a new stop.
 * Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
import { AgentStopNotFoundError } from "@langwatch/enterprise-governance-contract";
import { describe, expect, it } from "vitest";

import { MemoryAgentStopClaimRepository } from "../../../../repositories/memory/memory.agent-stop-claim.repository.ts";
import { ABANDONED_CLAIM_MS, AgentStopClaimService } from "../agent-stop-claim.service.ts";
import { AGENT_ID, ORG } from "./kill-switch.fixtures.ts";

/** A projection that has not folded any stop yet: the worker lags. */
function laggingClaims() {
  const claims = MemoryAgentStopClaimRepository.create();
  const service = AgentStopClaimService.create({
    claims,
    stops: {
      getStop: async ({ stopId }) => {
        throw new AgentStopNotFoundError(stopId);
      },
    },
  });
  return { claims, service };
}

const LATER = ABANDONED_CLAIM_MS + 1;

describe("AgentStopClaimService", () => {
  describe("given a claim whose request was sent but whose stop the projection has not folded", () => {
    /** @scenario "A sent stop keeps its agent's claim however long the worker lags" */
    it("refuses a second stop long after the claim was taken", async () => {
      const { claims, service } = laggingClaims();
      await service.claim({ organizationId: ORG, agentId: AGENT_ID, stopId: "stop-1", at: 0 });
      await service.markSent({
        organizationId: ORG,
        agentId: AGENT_ID,
        stopId: "stop-1",
        sentAt: 1,
      });

      const refusal = await service
        .claim({ organizationId: ORG, agentId: AGENT_ID, stopId: "stop-2", at: LATER })
        .then(
          () => undefined,
          (error: { code?: string }) => error.code,
        );

      expect(refusal).toBe("agent_stop_already_open");
      expect(await claims.findClaims({ organizationId: ORG, agentId: AGENT_ID })).toEqual([
        { stopId: "stop-1", claimedAt: 0, sentAt: 1 },
      ]);
    });
  });

  describe("given a claim whose request was never sent", () => {
    it("passes to a new stop once it is abandoned", async () => {
      const { claims, service } = laggingClaims();
      await service.claim({ organizationId: ORG, agentId: AGENT_ID, stopId: "stop-1", at: 0 });

      await service.claim({ organizationId: ORG, agentId: AGENT_ID, stopId: "stop-2", at: LATER });

      expect(await claims.findClaims({ organizationId: ORG, agentId: AGENT_ID })).toEqual([
        { stopId: "stop-2", claimedAt: LATER, sentAt: null },
      ]);
    });
  });

  describe("when a decision's command fails to send", () => {
    it("gives the decision back so the next one is accepted", async () => {
      const { service } = laggingClaims();
      await service.claim({ organizationId: ORG, agentId: AGENT_ID, stopId: "stop-1", at: 0 });
      const decide = {
        organizationId: ORG,
        stopId: "stop-1",
        status: "pending_approval" as const,
        decision: "approve" as const,
        at: 0,
      };

      const failed = await service
        .withDecision({ ...decide, send: () => Promise.reject(new Error("bus down")) })
        .then(
          () => "sent",
          () => "failed",
        );

      expect(failed).toBe("failed");
      expect(await service.withDecision({ ...decide, send: async () => "sent" })).toBe("sent");
    });
  });

  describe("when a decision was taken and never sent", () => {
    /** @scenario "A decision left by a process that died before sending it is taken over once abandoned" */
    it("refuses the next decision until the first is abandoned, then accepts it", async () => {
      const { service } = laggingClaims();
      await service.claim({ organizationId: ORG, agentId: AGENT_ID, stopId: "stop-1", at: 0 });
      const decide = {
        organizationId: ORG,
        stopId: "stop-1",
        status: "pending_approval" as const,
        decision: "deny" as const,
      };
      const neverSent = new Promise<string>(() => undefined);
      void service.withDecision({ ...decide, at: 1_000, send: () => neverSent });
      await Promise.resolve();

      const early = await service
        .withDecision({ ...decide, at: 2_000, send: async () => "sent" })
        .catch((error: { code?: string }) => error.code);
      const late = await service.withDecision({
        ...decide,
        at: 1_000 + ABANDONED_CLAIM_MS + 1,
        send: async () => "sent",
      });

      expect(early).toBe("agent_stop_not_pending");
      expect(late).toBe("sent");
    });
  });

  describe("when a decision's command was sent", () => {
    /** @scenario "A sent decision is never taken over as abandoned" */
    it("refuses every later decision however long after", async () => {
      const { service } = laggingClaims();
      await service.claim({ organizationId: ORG, agentId: AGENT_ID, stopId: "stop-1", at: 0 });
      const decide = {
        organizationId: ORG,
        stopId: "stop-1",
        status: "pending_approval" as const,
      };
      await service.withDecision({
        ...decide,
        decision: "approve",
        at: 1_000,
        send: async () => "sent",
      });

      const late = await service
        .withDecision({
          ...decide,
          decision: "deny",
          at: 1_000 + ABANDONED_CLAIM_MS * 10,
          send: async () => "sent",
        })
        .catch((error: { code?: string }) => error.code);

      expect(late).toBe("agent_stop_not_pending");
    });
  });
});
