/**
 * Requesting and deciding a stop over memory, through the real `agent_stop` pipeline.
 * Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
import { describe, expect, it, vi } from "vitest";

import { codeOf, request, settled } from "./kill-switch-steps.fixtures.ts";
import {
  AGENT_ID,
  killSwitchHarness,
  MACHINE,
  ORG,
  OTHER_MACHINE,
  PERSON,
  VIRTUAL_KEY_ID,
} from "./kill-switch.fixtures.ts";

describe("AgentStopService", () => {
  describe("when a person with governance:manage presses Stop", () => {
    /** @scenario "A person with governance:manage pressing Stop stops at once" */
    it("requests an immediate stop and applies every target of the plan", async () => {
      const harness = await killSwitchHarness();
      await harness.setFullPlan();

      const view = await request(harness);

      expect(view.approval).toBe("immediate");
      expect(view.trigger).toBe("user");
      const stop = await settled(harness, view.id, "quarantined");
      expect(stop.targets.map((target) => target.state)).toEqual(["applied", "applied", "applied"]);
      await harness.eventing.close();
    });
  });

  describe("when an API key requests a critical stop", () => {
    /** @scenario "A critical stop from a machine credential stops at once" */
    it("applies every target without an approval", async () => {
      const harness = await killSwitchHarness();
      await harness.setFullPlan();

      const view = await request(harness, MACHINE, "critical");

      expect(view.approval).toBe("immediate");
      expect(view.trigger).toBe("api_key");
      const stop = await settled(harness, view.id, "quarantined");
      expect(stop.decidedAt).toBeNull();
      await harness.eventing.close();
    });
  });

  describe("when an API key requests a high severity stop", () => {
    /** @scenario "A non-critical stop from a machine credential waits for an approval" */
    it("waits for an approval, applies nothing and pushes one stop_requested event", async () => {
      const harness = await killSwitchHarness();
      await harness.setFullPlan();

      const view = await request(harness, MACHINE, "high");

      expect(view.status).toBe("pending_approval");
      await vi.waitFor(() => expect(harness.announced).toHaveLength(1));
      expect(harness.announced[0]?.milestone).toBe("governance.agent.stop_requested");
      expect((await harness.stopOf(view.id)).status).toBe("pending_approval");
      expect(harness.servingEndpoints.calls).toEqual([]);
      expect(harness.bedrock.updates).toEqual([]);
      expect(harness.virtualKeyCalls).toEqual([]);
      await harness.eventing.close();
    });
  });

  describe("when an operator impersonating a person presses Stop", () => {
    /** @scenario "An impersonated kill switch write names the operator in its audit row" */
    it("names the person as the actor and the operator in the actor column and the metadata", async () => {
      const harness = await killSwitchHarness();
      await harness.setFullPlan();

      await request(harness, { ...PERSON, impersonatorId: "operator-1" });

      expect(
        harness.audit.filter((row) => row.action === "governance.agent.stop_requested"),
      ).toEqual([
        expect.objectContaining({
          userId: PERSON.userId,
          actorUserId: "operator-1",
          metadata: expect.objectContaining({ impersonatorId: "operator-1" }),
        }),
      ]);
      await harness.eventing.close();
    });
  });

  describe("given a stop pending approval", () => {
    async function pending() {
      const harness = await killSwitchHarness();
      await harness.setFullPlan();
      const view = await request(harness, MACHINE, "high");
      await settled(harness, view.id, "pending_approval");
      return { harness, stopId: view.id };
    }

    /** @scenario "Approving a pending stop applies its targets" */
    it("applies every target once a person approves it", async () => {
      const { harness, stopId } = await pending();

      const approved = await harness.stops.approveStop({
        organizationId: ORG,
        stopId,
        caller: PERSON,
      });

      expect(approved.status).toBe("stopping");
      const stop = await settled(harness, stopId, "quarantined");
      expect(stop.decidedByUserId).toBe(PERSON.userId);
      await harness.eventing.close();
    });

    /** @scenario "Denying a pending stop applies nothing" */
    it("applies nothing once a person denies it", async () => {
      const { harness, stopId } = await pending();

      await harness.stops.denyStop({ organizationId: ORG, stopId, caller: PERSON });

      const stop = await settled(harness, stopId, "denied");
      expect(stop.targets.every((target) => target.state === "pending")).toBe(true);
      expect(harness.servingEndpoints.calls).toEqual([]);
      expect(harness.virtualKeyCalls).toEqual([]);
      await harness.eventing.close();
    });

    /** @scenario "A decision on a stop that is no longer pending is refused" */
    it("refuses a second approval or a denial after the approval", async () => {
      const { harness, stopId } = await pending();
      await harness.stops.approveStop({ organizationId: ORG, stopId, caller: PERSON });
      await settled(harness, stopId, "quarantined");

      const decide = { organizationId: ORG, stopId, caller: OTHER_MACHINE };
      expect(await codeOf(harness.stops.approveStop(decide))).toBe("agent_stop_not_pending");
      expect(await codeOf(harness.stops.denyStop(decide))).toBe("agent_stop_not_pending");
      await harness.eventing.close();
    });

    /** @scenario "A decision on a stop that is no longer pending is refused" */
    it.each([
      ["an approval", "approveStop", "governance.agent.stop_approved"],
      ["a denial", "denyStop", "governance.agent.stop_denied"],
    ] as const)(
      "refuses an %s read before a plan edit closed the stop",
      async (_, method, action) => {
        const { harness, stopId } = await pending();
        const reads = harness.repositories.agentStops;
        const getStop = reads.getStop.bind(reads);
        // The decision reads the stop as pending, then a plan edit closes it before it is sent.
        vi.spyOn(reads, "getStop").mockImplementationOnce(async (input) => {
          const stale = await getStop(input);
          await harness.stops.setPlan({
            organizationId: ORG,
            agentId: AGENT_ID,
            targets: [],
            caller: PERSON,
          });
          return stale;
        });

        const decided = harness.stops[method]({ organizationId: ORG, stopId, caller: PERSON });

        expect(await codeOf(decided)).toBe("agent_stop_not_pending");
        expect((await harness.stopOf(stopId)).status).toBe("restored");
        const rows = harness.audit.filter((row) => row.action === action);
        expect(rows.map((row) => row.error)).toEqual(["agent_stop_not_pending"]);
        await harness.eventing.close();
      },
    );

    /** @scenario "The credential that requested a stop cannot approve it" */
    it("refuses the approval of the API key that requested it", async () => {
      const { harness, stopId } = await pending();

      const code = await codeOf(
        harness.stops.approveStop({ organizationId: ORG, stopId, caller: MACHINE }),
      );

      expect(code).toBe("agent_stop_self_approval");
      await harness.eventing.close();
    });

    /** @scenario "The person who owns the requesting API key cannot approve its stop" */
    it("refuses the key's owner from the UI and with another key they own", async () => {
      const { harness, stopId } = await pending();
      const owner = MACHINE.userId;

      const fromUi = await codeOf(
        harness.stops.approveStop({
          organizationId: ORG,
          stopId,
          caller: { userId: owner, apiKeyId: null },
        }),
      );
      const fromOwnKey = await codeOf(
        harness.stops.approveStop({
          organizationId: ORG,
          stopId,
          caller: { userId: owner, apiKeyId: "key-owner-other" },
        }),
      );

      expect([fromUi, fromOwnKey]).toEqual([
        "agent_stop_self_approval",
        "agent_stop_self_approval",
      ]);
      expect((await harness.stopOf(stopId)).status).toBe("pending_approval");
      await harness.stops.approveStop({ organizationId: ORG, stopId, caller: OTHER_MACHINE });
      await settled(harness, stopId, "quarantined");
      await harness.eventing.close();
    });

    /** @scenario "An approval confirmed against targets that changed since is refused" */
    it("refuses an approval naming targets a plan edit dropped since, and accepts the current ones", async () => {
      const { harness, stopId } = await pending();
      const read = (await harness.stopOf(stopId)).targets.map((target) => target.id);
      await harness.stops.setPlan({
        organizationId: ORG,
        agentId: AGENT_ID,
        targets: harness.fullPlan.slice(0, -1),
        caller: PERSON,
      });
      await vi.waitFor(
        async () => expect((await harness.stopOf(stopId)).targets).toHaveLength(read.length - 1),
        { timeout: 5_000 },
      );

      const code = await codeOf(
        harness.stops.approveStop({
          organizationId: ORG,
          stopId,
          expectedTargetIds: read,
          caller: PERSON,
        }),
      );

      expect(code).toBe("agent_stop_plan_changed");
      expect((await harness.stopOf(stopId)).status).toBe("pending_approval");
      const current = (await harness.stopOf(stopId)).targets.map((target) => target.id);
      await harness.stops.approveStop({
        organizationId: ORG,
        stopId,
        expectedTargetIds: current,
        caller: PERSON,
      });
      await settled(harness, stopId, "quarantined");
      await harness.eventing.close();
    });

    /** @scenario "A refused kill switch write is still audited" */
    it("audits the refused self-approval with its code and the key that asked", async () => {
      const { harness, stopId } = await pending();

      await codeOf(harness.stops.approveStop({ organizationId: ORG, stopId, caller: MACHINE }));

      expect(
        harness.audit.filter((row) => row.action === "governance.agent.stop_approved"),
      ).toEqual([
        expect.objectContaining({
          userId: MACHINE.userId,
          organizationId: ORG,
          error: "agent_stop_self_approval",
          targetKind: "governance_agent",
          targetId: AGENT_ID,
          metadata: expect.objectContaining({
            stopId,
            apiKeyId: MACHINE.apiKeyId,
            targetName: "support-bot",
          }),
        }),
      ]);
      await harness.eventing.close();
    });

    /** @scenario "A refused kill switch write is still audited" */
    it("names the agent on a refused restore, and only the asked id when nothing is known", async () => {
      const { harness, stopId } = await pending();

      await codeOf(harness.stops.restore({ organizationId: ORG, stopId, caller: PERSON }));
      await codeOf(
        harness.stops.restore({ organizationId: ORG, stopId: "agentstop_unknown", caller: PERSON }),
      );

      const rows = harness.audit.filter(
        (row) => row.action === "governance.agent.restore_requested",
      );
      expect(rows[0]).toMatchObject({
        error: "agent_stop_not_restorable",
        targetId: AGENT_ID,
        metadata: expect.objectContaining({ stopId, targetName: "support-bot" }),
      });
      expect(rows[1]).toMatchObject({ error: "agent_stop_not_found" });
      expect(rows[1]?.targetId).toBeUndefined();
      await harness.eventing.close();
    });

    /** @scenario "Restoring a stop that is not quarantined is refused" */
    it("refuses a restore", async () => {
      const { harness, stopId } = await pending();

      const code = await codeOf(
        harness.stops.restore({ organizationId: ORG, stopId, caller: PERSON }),
      );

      expect(code).toBe("agent_stop_not_restorable");
      await harness.eventing.close();
    });
  });

  describe("when another stop is requested while one is open", () => {
    /** @scenario "A second stop while one is open is refused" */
    it("refuses it for a pending, a stopping or a quarantined stop", async () => {
      const harness = await killSwitchHarness();
      await harness.setFullPlan();
      const pending = await request(harness, MACHINE, "high");
      await settled(harness, pending.id, "pending_approval");

      expect(await codeOf(request(harness))).toBe("agent_stop_already_open");

      await harness.stops.approveStop({ organizationId: ORG, stopId: pending.id, caller: PERSON });
      await settled(harness, pending.id, "quarantined");
      expect(await codeOf(request(harness))).toBe("agent_stop_already_open");
      await harness.eventing.close();
    });
  });

  describe("when the agent has no stop plan", () => {
    /** @scenario "An agent with no stop plan yet still offers its kill switch actions" */
    it("still answers a summary for it, so its first plan can be set", async () => {
      const harness = await killSwitchHarness();

      const summaries = await harness.stops.findSummaries({ organizationId: ORG });

      expect(summaries).toEqual([
        {
          agentId: AGENT_ID,
          inventoryRowId: "registered:support-bot",
          planTargetCount: 0,
          openStop: null,
        },
      ]);
      await harness.eventing.close();
    });

    /** @scenario "A stop of an agent with no stop plan is refused" */
    it("refuses the request", async () => {
      const harness = await killSwitchHarness();

      expect(await codeOf(request(harness))).toBe("agent_stop_plan_empty");
      await harness.eventing.close();
    });
  });

  describe("when the organisation holds more agents and open stops than one read page", () => {
    /** @scenario "Every agent of the Agents page gets its kill switch summary, however many there are" */
    it("answers a summary with its open stop for every agent", async () => {
      const others = ["pricing-bot", "billing-bot", "triage-bot"];
      const harness = await killSwitchHarness({ otherAgents: others, pageSize: 2 });
      const agentIds = [AGENT_ID, ...others.map((name) => `agent-${name}`)];
      const stopIds: string[] = [];
      for (const agentId of agentIds) {
        await harness.plans.setPlan({
          organizationId: ORG,
          agentId,
          targets: [{ kind: "gateway_virtual_key", virtualKeyId: VIRTUAL_KEY_ID }],
        });
        const view = await harness.stops.requestStop({
          organizationId: ORG,
          agentId,
          reason: "prompt injection in production",
          severity: "high",
          caller: PERSON,
        });
        stopIds.push(view.id);
        await settled(harness, view.id, "quarantined");
      }

      const summaries = await harness.stops.findSummaries({ organizationId: ORG });

      expect(summaries).toHaveLength(agentIds.length);
      expect(summaries.map((row) => row.agentId)).toEqual(expect.arrayContaining(agentIds));
      expect(summaries.map((row) => row.openStop?.id)).toEqual(expect.arrayContaining(stopIds));
      await harness.eventing.close();
    });
  });

  describe("when more stops wait for a decision than one read page", () => {
    /** @scenario "Every pending approval is answered, however many there are" */
    it("answers every pending stop", async () => {
      const others = ["pricing-bot", "billing-bot"];
      const harness = await killSwitchHarness({ otherAgents: others, pageSize: 2 });
      const stopIds: string[] = [];
      for (const agentId of [AGENT_ID, ...others.map((name) => `agent-${name}`)]) {
        await harness.plans.setPlan({
          organizationId: ORG,
          agentId,
          targets: [{ kind: "gateway_virtual_key", virtualKeyId: VIRTUAL_KEY_ID }],
        });
        const view = await harness.stops.requestStop({
          organizationId: ORG,
          agentId,
          reason: "prompt injection in production",
          severity: "high",
          caller: MACHINE,
        });
        stopIds.push(view.id);
        await settled(harness, view.id, "pending_approval");
      }

      const pending = await harness.stops.findPendingApprovals({ organizationId: ORG });

      expect(pending.map((stop) => stop.id).toSorted()).toEqual(stopIds.toSorted());
      await harness.eventing.close();
    });
  });

  describe("when the organisation holds more stops than one listing page", () => {
    /** @scenario "The stop listing pages through every stop with a cursor" */
    it("answers every stop once, latest first, across pages, and refuses a forged cursor", async () => {
      const others = ["pricing-bot", "billing-bot", "triage-bot"];
      const harness = await killSwitchHarness({ otherAgents: others });
      const stopIds: string[] = [];
      for (const agentId of [AGENT_ID, ...others.map((name) => `agent-${name}`)]) {
        await harness.plans.setPlan({
          organizationId: ORG,
          agentId,
          targets: [{ kind: "gateway_virtual_key", virtualKeyId: VIRTUAL_KEY_ID }],
        });
        const view = await harness.stops.requestStop({
          organizationId: ORG,
          agentId,
          reason: "prompt injection in production",
          severity: "high",
          caller: PERSON,
        });
        stopIds.push(view.id);
        await settled(harness, view.id, "quarantined");
      }

      const first = await harness.stops.listStops({ organizationId: ORG, limit: 3 });
      const second = await harness.stops.listStops({
        organizationId: ORG,
        limit: 3,
        ...(first.next_cursor ? { cursor: first.next_cursor } : {}),
      });

      expect(first.data).toHaveLength(3);
      expect(first.next_cursor).not.toBeNull();
      expect(second.data).toHaveLength(1);
      expect(second.next_cursor).toBeNull();
      expect([...first.data, ...second.data].map((stop) => stop.id)).toEqual(
        expect.arrayContaining(stopIds),
      );
      const undated = Buffer.from(JSON.stringify({ r: "not-a-date", i: stopIds[0] })).toString(
        "base64url",
      );
      for (const cursor of ["forged", undated]) {
        expect(
          await codeOf(harness.stops.listStops({ organizationId: ORG, limit: 3, cursor })),
        ).toBe("validation_error");
      }
      await harness.eventing.close();
    });
  });

  describe("when the agent is not in the registry", () => {
    /** @scenario "A stop of an agent outside the registry is refused" */
    it("refuses the request", async () => {
      const harness = await killSwitchHarness();

      const code = await codeOf(
        harness.stops.requestStop({
          organizationId: ORG,
          agentId: "agent-unknown",
          reason: "r",
          severity: "critical",
          caller: PERSON,
        }),
      );

      expect(code).toBe("agent_registry_entry_not_found");
      await harness.eventing.close();
    });
  });

  describe("when the plan changed after the person read it", () => {
    /** @scenario "A stop confirmed against a plan that changed since is refused" */
    it("refuses the stop with agent_stop_plan_changed and accepts the current plan's ids", async () => {
      const harness = await killSwitchHarness();
      const read = await harness.setFullPlan();
      const current = await harness.setFullPlan();

      const stale = read.targets.map((target) => target.id);
      expect(await codeOf(request(harness, PERSON, "high", stale))).toBe("agent_stop_plan_changed");
      expect(harness.audit.map((row) => [row.action, row.error])).toEqual([
        ["governance.agent.stop_requested", "agent_stop_plan_changed"],
      ]);

      const view = await request(
        harness,
        PERSON,
        "high",
        current.targets.map((target) => target.id),
      );
      await settled(harness, view.id, "quarantined");
      await harness.eventing.close();
    });
  });

  describe("when two reviewers decide one pending stop at once", () => {
    /** @scenario "Concurrent decisions on one pending stop accept only the first" */
    it("accepts one decision, refuses the other and audits the refusal as refused", async () => {
      const harness = await killSwitchHarness();
      await harness.setFullPlan();
      const view = await request(harness, MACHINE, "high");
      await settled(harness, view.id, "pending_approval");

      const decide = { organizationId: ORG, stopId: view.id };
      const outcomes = await Promise.allSettled([
        harness.stops.approveStop({ ...decide, caller: PERSON }),
        harness.stops.denyStop({ ...decide, caller: OTHER_MACHINE }),
      ]);

      expect(outcomes.map((outcome) => outcome.status).toSorted()).toEqual([
        "fulfilled",
        "rejected",
      ]);
      const refusals = outcomes.flatMap((outcome) =>
        outcome.status === "rejected" ? [(outcome.reason as { code?: string }).code] : [],
      );
      expect(refusals).toEqual(["agent_stop_not_pending"]);
      const decisions = harness.audit.filter((row) =>
        ["governance.agent.stop_approved", "governance.agent.stop_denied"].includes(row.action),
      );
      expect(decisions.filter((row) => row.error === undefined)).toHaveLength(1);
      expect(decisions.filter((row) => row.error !== undefined).map((row) => row.error)).toEqual([
        "agent_stop_not_pending",
      ]);
      await harness.eventing.close();
    });
  });
});
