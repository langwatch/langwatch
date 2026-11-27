/** Spec: enterprise/modules/governance/specs/cloud-agent-discovery.feature */
import {
  ARD_REGISTRY_ADAPTER_ID,
  AWS_BEDROCK_AGENTS_ADAPTER_ID,
  GCP_VERTEX_AGENT_ENGINE_ADAPTER_ID,
} from "@langwatch/enterprise-governance-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  ORG,
  START,
  daysBefore,
  endpoint,
  administrator,
  setup,
} from "./agent-registry-posture.fixtures.ts";

describe("AgentRegistryService posture", () => {
  describe("given a listed Bedrock agent whose traces carry its id", () => {
    /** @scenario "A listed agent whose traces carry its id is governed" */
    it("keeps the entry governed, neither shadow nor dormant", async () => {
      const { list, trace, reconcile, entries } = setup();
      await list({
        provider: AWS_BEDROCK_AGENTS_ADAPTER_ID,
        rawAgentId: "arn:aws:bedrock:eu-west-1:111122223333:agent/AGENT12345",
        name: "refund-bot",
        createdAt: daysBefore(START, 90),
        matchIds: ["AGENT12345"],
      });
      trace({ agentName: "refund-runner", agentId: "AGENT12345" });

      await reconcile();

      const held = await entries();
      expect(held.map((entry) => [entry.name, entry.source, entry.posture])).toEqual([
        ["refund-bot", "aws", "governed"],
      ]);
      expect(held[0]).toMatchObject({ shadow: false, dormant: false, platform: "aws_bedrock" });
    });
  });

  describe("given a traced agent no source lists", () => {
    /** @scenario "A traced agent no source lists is flagged shadow and announced once" */
    it("registers one shadow entry and appends one flagged_shadow event over two reconciles", async () => {
      const { trace, reconcile, entries, events } = setup();
      trace({ agentName: "pricing-bot", agentId: "rogue-7" });

      await reconcile();
      await reconcile();

      const held = await entries();
      expect(held.map((entry) => [entry.name, entry.posture])).toEqual([["pricing-bot", "shadow"]]);
      const flagged = (await events()).filter(
        (event) => event.type === "governance.agent.flagged_shadow",
      );
      expect(flagged).toHaveLength(1);
    });
  });

  describe("given a listed reasoning engine and traces carrying its numeric id", () => {
    /** @scenario "A traced agent carrying a listed resource name is not shadow" */
    it("builds no shadow entry for the traced agent", async () => {
      const { list, trace, reconcile, entries } = setup();
      const name = "projects/acme-ml/locations/europe-west4/reasoningEngines/42";
      await list({
        provider: GCP_VERTEX_AGENT_ENGINE_ADAPTER_ID,
        rawAgentId: name,
        name: "claims-agent",
        createdAt: daysBefore(START, 10),
        matchIds: [name, "42"],
      });
      trace({ agentName: "claims-runner", agentId: "42" });

      await reconcile();

      expect((await entries()).map((entry) => [entry.source, entry.shadow])).toEqual([
        ["gcp", false],
      ]);
    });
  });

  describe("given a listed AgentCore runtime created 90 days ago whose traffic stops", () => {
    /** @scenario "A listed agent with no traffic for the dormancy window is dormant" */
    it("versions the entry to dormant", async () => {
      const { list, trace, reconcile, entries, events, state, clock } = setup();
      await list({
        provider: AWS_BEDROCK_AGENTS_ADAPTER_ID,
        rawAgentId:
          "arn:aws:bedrock-agentcore:us-east-1:111122223333:runtime/support_runtime-abc123",
        name: "support_runtime",
        createdAt: daysBefore(START, 90),
        matchIds: ["support_runtime-abc123"],
      });
      trace({ agentName: "support_runtime", agentId: "support_runtime-abc123" });
      await reconcile();
      expect((await entries())[0]?.posture).toBe("governed");

      state.traffic = [];
      clock.now = Temporal.Instant.fromEpochMilliseconds(START.epochMilliseconds + 60_000);
      await reconcile();

      const [entry] = await entries();
      expect(entry).toMatchObject({ dormant: true, posture: "dormant", version: 2 });
      const versioned = (await events()).filter(
        (event) => event.type === "governance.agent.versioned",
      );
      expect(versioned.map((event) => event.agent.posture)).toEqual(["dormant"]);
    });
  });

  describe("given a listed Bedrock agent created 3 days ago with no traffic", () => {
    /** @scenario "A listed agent younger than the dormancy window is not dormant" */
    it("keeps the entry governed", async () => {
      const { list, reconcile, entries } = setup();
      await list({
        provider: AWS_BEDROCK_AGENTS_ADAPTER_ID,
        rawAgentId: "arn:aws:bedrock:eu-west-1:111122223333:agent/NEWAGENT01",
        name: "new-bot",
        createdAt: daysBefore(START, 3),
      });

      await reconcile();

      expect((await entries())[0]).toMatchObject({ dormant: false, posture: "governed" });
    });
  });

  describe("given an organisation whose dormancy window is 7 days", () => {
    /** @scenario "The organisation's dormancy window decides when an agent is dormant" */
    it("reads an agent last traced 10 days ago as dormant", async () => {
      const { list, trace, reconcile, entries, settings } = setup();
      await settings.saveDormantAfterDays({ organizationId: ORG, days: 7 });
      await list({
        provider: ARD_REGISTRY_ADAPTER_ID,
        rawAgentId: "urn:air:registry.acme.test:agent:triage",
        name: "triage",
        createdAt: daysBefore(START, 90),
      });
      trace({
        agentName: "triage-runner",
        agentId: "urn:air:registry.acme.test:agent:triage",
        lastSeen: daysBefore(START, 10),
      });

      await reconcile();

      expect((await entries())[0]).toMatchObject({ source: "ard", posture: "dormant" });
    });

    it("reads the same agent as governed under the default 30-day window", async () => {
      const { list, trace, reconcile, entries } = setup();
      await list({
        provider: ARD_REGISTRY_ADAPTER_ID,
        rawAgentId: "urn:air:registry.acme.test:agent:triage",
        name: "triage",
        createdAt: daysBefore(START, 90),
      });
      trace({
        agentName: "triage-runner",
        agentId: "urn:air:registry.acme.test:agent:triage",
        lastSeen: daysBefore(START, 10),
      });

      await reconcile();

      expect((await entries())[0]).toMatchObject({ posture: "governed" });
    });
  });

  describe("given a dormant listed agent", () => {
    /** @scenario "A dormant agent that gets traffic again is governed" */
    it("versions it back to governed once its id appears in traces", async () => {
      const { list, trace, reconcile, entries } = setup();
      await list({
        provider: AWS_BEDROCK_AGENTS_ADAPTER_ID,
        rawAgentId: "arn:aws:bedrock:eu-west-1:111122223333:agent/AGENT12345",
        name: "refund-bot",
        createdAt: daysBefore(START, 90),
        matchIds: ["AGENT12345"],
      });
      await reconcile();
      expect((await entries())[0]?.posture).toBe("dormant");

      trace({ agentName: "refund-runner", agentId: "AGENT12345" });
      await reconcile();

      expect((await entries())[0]).toMatchObject({ dormant: false, posture: "governed" });
    });
  });

  describe("when a reconcile after the baseline flags a new shadow agent", () => {
    /** @scenario "A new shadow agent is pushed to every webhook subscribed to governance.agent.*" */
    it("requests one flagged_shadow delivery for the subscribed endpoint", async () => {
      const { trace, reconcile, outbox } = setup({
        endpoints: [
          endpoint("hook-governance", ["governance.agent.*"]),
          endpoint("hook-gateway", ["gateway.*"]),
        ],
      });
      await reconcile();
      trace({ agentName: "pricing-bot", agentId: "rogue-7" });

      await reconcile();

      const flagged = outbox.deliveries.filter(
        (intent) => intent.eventType === "governance.agent.flagged_shadow",
      );
      expect(flagged.map((intent) => intent.endpointId)).toEqual(["hook-governance"]);
    });

    /** @scenario "A new shadow agent alerts each organisation admin once" */
    it("records one push alert per admin, keyed by the event and the admin", async () => {
      const { trace, reconcile, outbox, events } = setup({
        administrators: [administrator("admin-1"), administrator("admin-2")],
      });
      await reconcile();
      trace({ agentName: "pricing-bot", agentId: "rogue-7" });

      await reconcile();
      await reconcile();

      const [flagged] = (await events()).filter(
        (event) => event.type === "governance.agent.flagged_shadow",
      );
      expect(outbox.alerts).toEqual([
        {
          organizationId: ORG,
          eventId: flagged?.id,
          userId: "admin-1",
          agentId: flagged?.agent_id,
          agentName: "pricing-bot",
        },
        {
          organizationId: ORG,
          eventId: flagged?.id,
          userId: "admin-2",
          agentId: flagged?.agent_id,
          agentName: "pricing-bot",
        },
      ]);
      expect(outbox.alerts.map((alert) => alert.userId)).not.toContain("member-1");
    });
  });

  describe("given an organisation the registry has not reconciled yet whose traces name a shadow agent", () => {
    /** @scenario "A silent baseline flags shadow agents without alerting" */
    it("registers the shadow entry and requests no push alert or webhook delivery", async () => {
      const { trace, reconcile, outbox, entries } = setup({
        administrators: [administrator("admin-1"), administrator("admin-2")],
      });
      trace({ agentName: "pricing-bot", agentId: "rogue-7" });

      await reconcile();

      expect((await entries()).map((entry) => entry.posture)).toEqual(["shadow"]);
      expect(outbox.alerts).toEqual([]);
      expect(outbox.deliveries).toEqual([]);
    });
  });
});
