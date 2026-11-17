// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { describe, expect, it } from "vitest";

import { agentsListed, agentsRefused } from "../../features/agents/rules/agent-listing.rules.ts";
import {
  ACME,
  OTHER,
  T1,
  T2,
  T3,
  bedrockAgent,
  cloudWorld,
} from "./cloud-agent-discovery.fixtures.ts";

describe("AgentDiscoveryService with an AWS source", () => {
  describe("given the source names an AWS connection of another organisation", () => {
    /** @scenario "An AWS source naming an AWS connection of another organisation refuses as not configured" */
    it("refuses as not configured and never asks AWS", async () => {
      const world = await cloudWorld();
      const foreign = await world.connectionOf(OTHER);
      const source = await world.awsSource({ awsConnectionId: foreign.id });
      world.answer(agentsListed([bedrockAgent("A")]));

      const result = await world.sync({ sourceId: source.id, now: T1 });

      expect(result).toEqual({
        outcome: "refused",
        refusal: { reason: "not_configured", status: null },
      });
      expect(world.aws.asked).toEqual([]);
    });
  });

  describe("given the source's own connection", () => {
    it("lists every configured region with the connection's opened credentials", async () => {
      const world = await cloudWorld();
      const connection = await world.connectionOf(ACME);
      const source = await world.awsSource({ awsConnectionId: connection.id });
      world.answer(agentsListed([bedrockAgent("A")]));

      expect(await world.sync({ sourceId: source.id, now: T1 })).toEqual({
        outcome: "listed",
        recorded: 1,
      });
      expect(world.aws.asked).toEqual([
        {
          credentials: {
            accessKeyId: "AKIAACMEEXAMPLE0001",
            secretAccessKey: "acme-secret-access-key-0001",
            roleArn: null,
            externalId: null,
          },
          regions: ["eu-west-1", "us-east-1"],
        },
      ]);
      expect(world.store.agentListings.map((listing) => listing.ingestionSourceId)).toEqual([
        source.id,
      ]);
    });
  });

  describe("given a source that listed agents A and B", () => {
    async function listedAandB() {
      const world = await cloudWorld();
      const connection = await world.connectionOf(ACME);
      const source = await world.awsSource({ awsConnectionId: connection.id });
      world.answer(agentsListed([bedrockAgent("A"), bedrockAgent("B")]));
      await world.sync({ sourceId: source.id, now: T1 });
      return { world, source, connection };
    }

    /** @scenario "A listing that no longer names an agent marks it gone" */
    it("marks B gone when the next listing names only A, and leaves it out of the registry read", async () => {
      const { world, source } = await listedAandB();
      world.answer(agentsListed([bedrockAgent("A")]));

      await world.sync({ sourceId: source.id, now: T2 });

      expect(await world.listed()).toEqual(["A"]);
      expect(world.presenceOf("B")).toEqual([{ lastListedAt: T1, goneAt: T2 }]);
      expect(world.registry.reconciles).toBe(2);
    });

    it("marks both gone when the next listing is empty", async () => {
      const { world, source } = await listedAandB();
      world.answer(agentsListed([]));

      expect(await world.sync({ sourceId: source.id, now: T2 })).toEqual({ outcome: "empty" });

      expect(await world.listed()).toEqual([]);
      expect(world.registry.reconciles).toBe(2);
    });

    /** @scenario "An agent that comes back after it was marked gone is active again" */
    it("makes B active again when a later listing names it", async () => {
      const { world, source } = await listedAandB();
      world.answer(agentsListed([bedrockAgent("A")]));
      await world.sync({ sourceId: source.id, now: T2 });

      world.answer(agentsListed([bedrockAgent("A"), bedrockAgent("B")]));
      await world.sync({ sourceId: source.id, now: T3 });

      expect(await world.listed()).toEqual(["A", "B"]);
      const back = world.store.agents.find((agent) => agent.displayText === "B");
      expect(world.presenceOf("B")).toEqual([{ lastListedAt: T3, goneAt: null }]);
      expect(back?.lastSeenAt).toEqual(T3);
    });

    /** @scenario "A refused listing marks nothing gone" */
    it("leaves both as they were when the next listing is refused", async () => {
      const { world, source } = await listedAandB();
      const before = JSON.stringify(world.store.agents);
      world.answer(agentsRefused({ reason: "unauthorized", status: 403 }));

      const result = await world.sync({ sourceId: source.id, now: T2 });

      expect(result.outcome).toBe("refused");
      expect(JSON.stringify(world.store.agents)).toBe(before);
      expect(await world.listed()).toEqual(["A", "B"]);
      expect(world.registry.reconciles).toBe(1);
    });

    /** @scenario "An agent another source still lists stays when one source stops listing it" */
    it("keeps A while a second source still lists it after the first source lists nothing", async () => {
      const { world, source, connection } = await listedAandB();
      const second = await world.awsSource({ awsConnectionId: connection.id });
      world.answer(agentsListed([bedrockAgent("A")]));
      await world.sync({ sourceId: second.id, now: T2 });

      world.answer(agentsListed([]));
      await world.sync({ sourceId: source.id, now: T3 });

      expect(await world.listed()).toEqual(["A"]);
      world.answer(agentsListed([]));
      await world.sync({ sourceId: second.id, now: T3.add({ hours: 1 }) });
      expect(await world.listed()).toEqual([]);
    });

    /** @scenario "Listing the same agents twice records no change" */
    it("changes nothing on the rows the registry reads when the same agents are listed again", async () => {
      const { world, source } = await listedAandB();
      const snapshot = () =>
        JSON.stringify(
          world.store.agents.map((row) => [
            row.displayText,
            row.metadata,
            row.firstSeenAt,
            world.presenceOf(row.displayText).map((listing) => listing.goneAt),
          ]),
        );
      const rowsBefore = snapshot();
      world.answer(agentsListed([bedrockAgent("A"), bedrockAgent("B")]));

      await world.sync({ sourceId: source.id, now: T2 });

      expect(snapshot()).toBe(rowsBefore);
      expect(await world.listed()).toEqual(["A", "B"]);
    });
  });
});

describe("AgentDiscoveryService test connection", () => {
  describe("given an AWS configuration whose regions answer three agents", () => {
    /** @scenario "Testing a source's connection lists without recording" */
    it("answers three agents found and records no sighting", async () => {
      const world = await cloudWorld();
      const connection = await world.connectionOf(ACME);
      world.answer(agentsListed([bedrockAgent("A"), bedrockAgent("B"), bedrockAgent("C")]));

      const result = await world.service.testListingForConfig({
        organizationId: ACME,
        sourceType: "aws_bedrock_agents",
        config: {
          adapter: "aws_bedrock_agents",
          awsConnectionId: connection.id,
          regions: ["eu-west-1"],
        },
        credentials: {},
      });

      expect(result).toEqual({ outcome: "listed", agentCount: 3 });
      expect(world.store.agents).toEqual([]);
      expect(world.registry.reconciles).toBe(0);
    });

    it("lists a saved source without recording either", async () => {
      const world = await cloudWorld();
      const connection = await world.connectionOf(ACME);
      const source = await world.awsSource({ awsConnectionId: connection.id });
      world.answer(agentsListed([bedrockAgent("A"), bedrockAgent("B"), bedrockAgent("C")]));

      const result = await world.service.testListingForSource({
        organizationId: ACME,
        ingestionSourceId: source.id,
      });

      expect(result).toEqual({ outcome: "listed", agentCount: 3 });
      expect(world.store.agents).toEqual([]);
    });
  });

  describe("given a Google Cloud configuration whose token exchange is refused", () => {
    /** @scenario "A test connection that the provider refuses answers the refusal reason" */
    it("answers refused with the reason", async () => {
      const world = await cloudWorld();
      world.vertex.answer({ listing: agentsRefused({ reason: "unauthorized", status: 400 }) });

      const result = await world.service.testListingForConfig({
        organizationId: ACME,
        sourceType: "gcp_vertex_agent_engine",
        config: {
          adapter: "gcp_vertex_agent_engine",
          targets: [{ projectId: "acme-ml", location: "europe-west4" }],
        },
        credentials: { serviceAccountJson: '{"type":"service_account"}' },
      });

      expect(result).toEqual({ outcome: "refused", reason: "unauthorized", status: 400 });
      expect(world.vertex.asked).toHaveLength(1);
    });
  });

  describe("given a Google Cloud configuration with no service account key", () => {
    it("refuses as not configured without asking Google", async () => {
      const world = await cloudWorld();

      const result = await world.service.testListingForConfig({
        organizationId: ACME,
        sourceType: "gcp_vertex_agent_engine",
        config: {
          adapter: "gcp_vertex_agent_engine",
          targets: [{ projectId: "acme-ml", location: "europe-west4" }],
        },
        credentials: {},
      });

      expect(result).toEqual({ outcome: "refused", reason: "not_configured", status: null });
      expect(world.vertex.asked).toEqual([]);
    });
  });

  describe("given an ARD configuration with a search endpoint and a token", () => {
    it("asks the registry with both", async () => {
      const world = await cloudWorld();
      world.ard.answer({ listing: agentsListed([]) });

      const result = await world.service.testListingForConfig({
        organizationId: ACME,
        sourceType: "ard_registry",
        config: {
          adapter: "ard_registry",
          registryUrl: "registry.acme.test",
          searchUrl: "https://registry.acme.test/search",
        },
        credentials: { bearerToken: "ard-token" },
      });

      expect(result).toEqual({ outcome: "empty" });
      expect(world.ard.asked).toEqual([
        {
          registryUrl: "registry.acme.test",
          searchUrl: "https://registry.acme.test/search",
          bearerToken: "ard-token",
        },
      ]);
    });
  });
});
