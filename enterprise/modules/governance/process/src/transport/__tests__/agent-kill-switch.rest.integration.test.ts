/**
 * The kill switch REST family over the real governance application: a machine stop, the
 * permission and plan refusals, and the decision, restore and read routes.
 * Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
import type { AgentStopView } from "@langwatch/enterprise-governance-contract";
import { describe, expect, it, vi } from "vitest";

import {
  AGENT_ID,
  buildKillSwitchRest,
  KEYS,
  VIRTUAL_KEY_ID,
} from "./support/kill-switch-rest.fixture.ts";

type StopBody = { data: AgentStopView };

describe("the agent kill switch REST family", () => {
  describe("given an organisation API key holding governance:manage", () => {
    /** @scenario "A machine credential stops an agent over REST" */
    it("answers 202 with an immediate stop for a critical severity and disables the key", async () => {
      const { call, disabled, eventing } = await buildKillSwitchRest();

      const response = await call({
        method: "POST",
        path: `/api/governance/agents/${AGENT_ID}/stop`,
        body: JSON.stringify({ reason: "data exfiltration attempt", severity: "critical" }),
        key: KEYS.traceRule,
      });
      const body = (await response.json()) as StopBody;

      expect(response.status).toBe(202);
      expect(body.data).toMatchObject({
        agentId: AGENT_ID,
        approval: "immediate",
        trigger: "api_key",
        status: "stopping",
        requestedBy: { userId: KEYS.traceRule.userId, apiKeyId: KEYS.traceRule.apiKeyId },
      });
      await vi.waitFor(() => expect(disabled.map((input) => input.id)).toEqual([VIRTUAL_KEY_ID]));
      expect(disabled[0]?.actorUserId).toBe(KEYS.traceRule.userId);
      await eventing.close();
    });

    it("serves the v1 twin of the stop route", async () => {
      const { call, eventing } = await buildKillSwitchRest();

      const response = await call({
        method: "GET",
        path: `/api/v1/governance/agents/${AGENT_ID}/stop-plan`,
      });

      expect(response.status).toBe(200);
      expect(
        ((await response.json()) as { data: { targets: unknown[] } }).data.targets,
      ).toHaveLength(1);
      await eventing.close();
    });
  });

  describe("given an organisation API key holding only governance:view", () => {
    /** @scenario "The REST stop route refuses a key without governance:manage" */
    it("answers 403", async () => {
      const { call, eventing } = await buildKillSwitchRest({ grants: ["governance:view"] });

      const response = await call({
        method: "POST",
        path: `/api/governance/agents/${AGENT_ID}/stop`,
        body: JSON.stringify({ reason: "r", severity: "critical" }),
      });

      expect(response.status).toBe(403);
      await eventing.close();
    });
  });

  describe("given an organisation below the Enterprise plan", () => {
    /** @scenario "The REST stop routes refuse an organisation below the Enterprise plan" */
    it("answers 402 enterprise_plan_required naming AGENT_REGISTRY", async () => {
      const { call, eventing } = await buildKillSwitchRest({ planType: "LAUNCH" });

      const answers = await Promise.all([
        call({
          method: "POST",
          path: `/api/governance/agents/${AGENT_ID}/stop`,
          body: JSON.stringify({ reason: "r", severity: "critical" }),
        }),
        call({ method: "GET", path: `/api/governance/agents/${AGENT_ID}/stop` }),
        call({ method: "GET", path: `/api/governance/agents/${AGENT_ID}/stop-plan` }),
        call({ method: "GET", path: "/api/governance/agent-stops" }),
        call({ method: "POST", path: "/api/governance/agent-stops/stop-1/approve", body: "{}" }),
      ]);

      for (const answer of answers) {
        expect(answer.status).toBe(402);
        expect(await answer.json()).toMatchObject({
          code: "enterprise_plan_required",
          meta: { feature: "AGENT_REGISTRY" },
        });
      }
      await eventing.close();
    });
  });

  describe("given a stop pending approval", () => {
    /** @scenario "The REST routes approve, deny, restore and read a stop" */
    it("approves it with another key, reads it back with its targets and restores it", async () => {
      const { call, repositories, eventing } = await buildKillSwitchRest();
      const requested = (await (
        await call({
          method: "POST",
          path: `/api/governance/agents/${AGENT_ID}/stop`,
          body: JSON.stringify({ reason: "cost spike", severity: "high" }),
          key: KEYS.traceRule,
        })
      ).json()) as StopBody;
      expect(requested.data.status).toBe("pending_approval");
      const stopId = requested.data.id;
      await vi.waitFor(async () =>
        expect(
          (await repositories.agentStops.getStop({ organizationId: "org-1", stopId })).status,
        ).toBe("pending_approval"),
      );

      const listed = await call({
        method: "GET",
        path: "/api/governance/agent-stops?status=pending_approval",
      });
      expect(
        ((await listed.json()) as { data: AgentStopView[] }).data.map((stop) => stop.id),
      ).toEqual([stopId]);

      const selfApproval = await call({
        method: "POST",
        path: `/api/governance/agent-stops/${stopId}/approve`,
        body: "{}",
        key: KEYS.traceRule,
      });
      expect(selfApproval.status).toBe(409);
      expect(((await selfApproval.json()) as { code: string }).code).toBe(
        "agent_stop_self_approval",
      );

      const approved = await call({
        method: "POST",
        path: `/api/governance/agent-stops/${stopId}/approve`,
        body: JSON.stringify({ note: "confirmed on the dashboard" }),
      });
      expect(approved.status).toBe(200);
      await vi.waitFor(async () =>
        expect(
          (await repositories.agentStops.getStop({ organizationId: "org-1", stopId })).status,
        ).toBe("quarantined"),
      );

      const read = await call({ method: "GET", path: `/api/governance/agents/${AGENT_ID}/stop` });
      const stop = ((await read.json()) as StopBody).data;
      expect(read.status).toBe(200);
      expect(stop).toMatchObject({ id: stopId, status: "quarantined" });
      expect(stop.targets).toMatchObject([{ id: "target-vk", state: "applied" }]);

      const denied = await call({
        method: "POST",
        path: `/api/governance/agent-stops/${stopId}/deny`,
        body: "{}",
      });
      expect(denied.status).toBe(409);
      expect(((await denied.json()) as { code: string }).code).toBe("agent_stop_not_pending");

      const restored = await call({
        method: "POST",
        path: `/api/governance/agent-stops/${stopId}/restore`,
        body: "{}",
      });
      expect(restored.status).toBe(202);
      expect(((await restored.json()) as StopBody).data.status).toBe("restoring");
      await eventing.close();
    });

    /** @scenario "A new stop reads back as soon as its 202 returns" */
    it("serves the new stop as the latest one and approves it straight after the 202", async () => {
      const { call, eventing } = await buildKillSwitchRest();
      const requested = (await (
        await call({
          method: "POST",
          path: `/api/governance/agents/${AGENT_ID}/stop`,
          body: JSON.stringify({ reason: "cost spike", severity: "high" }),
          key: KEYS.traceRule,
        })
      ).json()) as StopBody;

      const latest = await call({ method: "GET", path: `/api/governance/agents/${AGENT_ID}/stop` });
      const approved = await call({
        method: "POST",
        path: `/api/governance/agent-stops/${requested.data.id}/approve`,
        body: "{}",
      });

      expect(((await latest.json()) as StopBody).data).toMatchObject({
        id: requested.data.id,
        status: "pending_approval",
      });
      expect(approved.status).toBe(200);
      expect(((await approved.json()) as StopBody).data.status).toBe("stopping");
      await eventing.close();
    });

    it("answers 404 agent_stop_not_found for an agent that was never stopped", async () => {
      const { call, eventing } = await buildKillSwitchRest();

      const response = await call({
        method: "GET",
        path: `/api/governance/agents/${AGENT_ID}/stop`,
      });

      expect(response.status).toBe(404);
      expect(((await response.json()) as { code: string }).code).toBe("agent_stop_not_found");
      await eventing.close();
    });
  });
});

describe("the retry route and the stop plan route", () => {
  async function quarantined() {
    const harness = await buildKillSwitchRest();
    const requested = (await (
      await harness.call({
        method: "POST",
        path: `/api/governance/agents/${AGENT_ID}/stop`,
        body: JSON.stringify({ reason: "data exfiltration attempt", severity: "critical" }),
        key: KEYS.traceRule,
      })
    ).json()) as StopBody;
    const stopId = requested.data.id;
    await vi.waitFor(async () =>
      expect(
        (await harness.repositories.agentStops.getStop({ organizationId: "org-1", stopId })).status,
      ).toBe("quarantined"),
    );
    return { ...harness, stopId };
  }

  describe("given a quarantined stop", () => {
    /** @scenario "The REST route retries a stop" */
    it("answers 202 to a retry and keeps the stop quarantined when nothing is left to stop", async () => {
      const { call, eventing, stopId } = await quarantined();

      const retried = await call({
        method: "POST",
        path: `/api/governance/agent-stops/${stopId}/retry`,
        body: "{}",
      });

      expect(retried.status).toBe(202);
      expect(((await retried.json()) as StopBody).data).toMatchObject({
        id: stopId,
        status: "quarantined",
      });
      await eventing.close();
    });

    /** @scenario "Removing a target from the plan drops it from the open stop" */
    it("drops the virtual key from the open stop when the plan no longer holds it", async () => {
      const { call, repositories, eventing, stopId } = await quarantined();

      const replaced = await call({
        method: "PUT",
        path: `/api/governance/agents/${AGENT_ID}/stop-plan`,
        body: JSON.stringify({ targets: [] }),
      });

      expect(replaced.status).toBe(200);
      await vi.waitFor(async () =>
        expect(
          (await repositories.agentStops.getStop({ organizationId: "org-1", stopId })).targets,
        ).toEqual([]),
      );
      await eventing.close();
    });
  });

  describe("given an organisation key saving the plan", () => {
    /** @scenario "Saving a stop plan writes one audit row naming the agent" */
    it("writes one stop_plan_set row naming the agent and the key, and no generic row", async () => {
      const { call, audited, doorRows, eventing } = await buildKillSwitchRest();

      const saved = await call({
        method: "PUT",
        path: `/api/governance/agents/${AGENT_ID}/stop-plan`,
        body: JSON.stringify({ targets: [] }),
      });

      expect(saved.status).toBe(200);
      await vi.waitFor(() =>
        expect(audited.map((row) => row.action)).toEqual(["governance.agent.stop_plan_set"]),
      );
      expect(audited[0]).toMatchObject({
        userId: KEYS.onCall.userId,
        targetKind: "governance_agent",
        targetId: AGENT_ID,
        metadata: expect.objectContaining({
          targetName: "support-bot",
          apiKeyId: KEYS.onCall.apiKeyId,
        }),
      });
      expect(doorRows).toEqual([]);
      await eventing.close();
    });

    /** @scenario "Saving a stop plan writes one audit row naming the agent" */
    it("writes one stop_plan_set row with the refusal's code for a refused save", async () => {
      const { call, audited, doorRows, eventing } = await buildKillSwitchRest();

      const refused = await call({
        method: "PUT",
        path: `/api/governance/agents/${AGENT_ID}/stop-plan`,
        body: JSON.stringify({ targets: [], expectedVersion: 7 }),
      });

      expect(refused.status).toBe(409);
      expect(((await refused.json()) as { code: string }).code).toBe("agent_stop_plan_conflict");
      await vi.waitFor(() => expect(audited).toHaveLength(1));
      expect(audited[0]).toMatchObject({
        action: "governance.agent.stop_plan_set",
        error: "agent_stop_plan_conflict",
        userId: KEYS.onCall.userId,
        targetKind: "governance_agent",
        targetId: AGENT_ID,
        metadata: expect.objectContaining({ targetName: "support-bot" }),
      });
      expect(doorRows).toEqual([]);
      await eventing.close();
    });
  });

  describe("given a stop waiting for an approval", () => {
    it("refuses a retry with 409 agent_stop_not_retryable", async () => {
      const { call, eventing } = await buildKillSwitchRest();
      const requested = (await (
        await call({
          method: "POST",
          path: `/api/governance/agents/${AGENT_ID}/stop`,
          body: JSON.stringify({ reason: "cost spike", severity: "high" }),
          key: KEYS.traceRule,
        })
      ).json()) as StopBody;

      const retried = await call({
        method: "POST",
        path: `/api/governance/agent-stops/${requested.data.id}/retry`,
        body: "{}",
      });

      expect(retried.status).toBe(409);
      expect(((await retried.json()) as { code: string }).code).toBe("agent_stop_not_retryable");
      await eventing.close();
    });
  });
});
