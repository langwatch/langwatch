// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The AWS agent inventory against a local listener speaking the Bedrock Agents and AgentCore
 * control REST routes, so the real SDK serializers, signing and pagination run end to end.
 * Spec: enterprise/modules/governance/specs/cloud-agent-discovery.feature
 */

import type { Server } from "node:http";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { HttpAwsAgentInventoryChannel } from "../http/http.aws-agent-inventory.channel.ts";
import {
  agentArn,
  agentSummary,
  bedrockAgent,
  type Call,
  KEY_PAIR,
  ok,
  on,
  type Route,
  runtimeArn,
  runtimeSummary,
  startListener,
} from "./aws-agent-listener.fixtures.ts";

describe("HttpAwsAgentInventoryChannel", () => {
  let server: Server;
  let routes: Route[];
  let calls: Call[];
  let channel: HttpAwsAgentInventoryChannel;

  beforeEach(async () => {
    const listener = await startListener();
    ({ server, routes, calls } = listener);
    channel = HttpAwsAgentInventoryChannel.create({
      vendorBases: { bedrockAgent: listener.endpoint, bedrockAgentCoreControl: listener.endpoint },
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  /** @scenario "A Bedrock agent listed in a region becomes a sighting keyed by its ARN" */
  it("lists a Bedrock agent as a sighting keyed by its ARN with model, owner and match ids", async () => {
    const region = "eu-west-1";
    const arn = agentArn({ region, id: "AGENT12345" });
    routes.push(
      on({
        match: { method: "POST", path: "/agents/", region },
        answer: ok({
          agentSummaries: [agentSummary({ agentId: "AGENT12345", agentName: "refund-bot" })],
        }),
      }),
      bedrockAgent({ region, agentId: "AGENT12345", agentName: "refund-bot" }),
      on({
        match: { method: "POST", path: "/agents/AGENT12345/agentaliases/" },
        answer: ok({
          agentAliasSummaries: [
            {
              agentAliasId: "PRODALIAS1",
              agentAliasName: "prod",
              createdAt: "2026-07-01T10:00:00.000Z",
              updatedAt: "2026-11-01T10:00:00.000Z",
            },
          ],
        }),
      }),
      on({
        match: { method: "GET", path: `/tags/${arn}` },
        answer: ok({ tags: { owner: "payments", env: "prod" } }),
      }),
    );

    const listing = await channel.listAgents({
      credentials: KEY_PAIR,
      regions: ["eu-west-1", "us-east-1"],
    });

    expect(listing.outcome).toBe("listed");
    if (listing.outcome !== "listed") return;
    expect(listing.items).toHaveLength(1);
    const [sighting] = listing.items;
    expect(sighting?.rawAgentId).toBe("arn:aws:bedrock:eu-west-1:111122223333:agent/AGENT12345");
    expect(sighting?.displayText).toBe("refund-bot");
    expect(sighting?.metadata).toMatchObject({
      platform: "aws_bedrock",
      model: "anthropic.claude-sonnet-5",
      owner: "payments",
      region: "eu-west-1",
      createdAt: "2026-07-01T10:00:00.000Z",
      updatedAt: "2026-11-01T10:00:00.000Z",
      consoleUrl:
        "https://eu-west-1.console.aws.amazon.com/bedrock/home?region=eu-west-1#/agents/AGENT12345",
    });
    expect(JSON.parse(sighting?.metadata.tags ?? "{}")).toEqual({ owner: "payments", env: "prod" });
    expect(JSON.parse(sighting?.metadata.matchIds ?? "[]")).toEqual([
      "AGENT12345",
      "PRODALIAS1",
      "arn:aws:bedrock:eu-west-1:111122223333:agent-alias/AGENT12345/PRODALIAS1",
      arn,
    ]);
    expect(calls.filter((call) => call.path === "/agents/").map((call) => call.region)).toEqual([
      "eu-west-1",
      "us-east-1",
    ]);
  });

  it("keeps the shared test alias id out of the bare match ids, keeping its agent-scoped ARN", async () => {
    const region = "eu-west-1";
    routes.push(
      on({
        match: { method: "POST", path: "/agents/" },
        answer: ok({
          agentSummaries: [agentSummary({ agentId: "AGENT12345", agentName: "refund-bot" })],
        }),
      }),
      bedrockAgent({ region, agentId: "AGENT12345", agentName: "refund-bot" }),
      on({
        match: { method: "POST", path: "/agents/AGENT12345/agentaliases/" },
        answer: ok({
          agentAliasSummaries: [
            { agentAliasId: "TSTALIASID", agentAliasName: "AgentTestAlias" },
            { agentAliasId: "PRODALIAS1", agentAliasName: "prod" },
          ],
        }),
      }),
    );

    const listing = await channel.listAgents({ credentials: KEY_PAIR, regions: [region] });

    expect(listing.outcome).toBe("listed");
    if (listing.outcome !== "listed") return;
    expect(JSON.parse(listing.items[0]?.metadata.matchIds ?? "[]")).toEqual([
      "AGENT12345",
      "PRODALIAS1",
      "arn:aws:bedrock:eu-west-1:111122223333:agent-alias/AGENT12345/TSTALIASID",
      "arn:aws:bedrock:eu-west-1:111122223333:agent-alias/AGENT12345/PRODALIAS1",
      agentArn({ region, id: "AGENT12345" }),
    ]);
  });

  it("refuses as malformed when GetAgent answers without an agent ARN, so nothing is marked gone", async () => {
    routes.push(
      on({
        match: { method: "POST", path: "/agents/" },
        answer: ok({
          agentSummaries: [agentSummary({ agentId: "AGENT12345", agentName: "refund-bot" })],
        }),
      }),
      on({
        match: { method: "GET", path: "/agents/AGENT12345/" },
        answer: ok({ agent: { agentId: "AGENT12345" } }),
      }),
    );

    const listing = await channel.listAgents({ credentials: KEY_PAIR, regions: ["eu-west-1"] });

    expect(listing).toEqual({
      outcome: "refused",
      refusal: { reason: "malformed_response", status: null },
    });
  });

  /** @scenario "A Bedrock AgentCore runtime becomes a sighting keyed by its ARN" */
  it("lists an AgentCore runtime as a sighting keyed by its runtime ARN", async () => {
    const region = "us-east-1";
    const arn = runtimeArn({ region, id: "support_runtime-abc123" });
    routes.push(
      on({
        match: { method: "POST", path: "/runtimes/" },
        answer: ok({ agentRuntimes: [runtimeSummary({ region, id: "support_runtime-abc123" })] }),
      }),
      on({
        match: { method: "GET", path: `/tags/${arn}`, service: "bedrock-agentcore" },
        answer: ok({ tags: { team: "support" } }),
      }),
    );

    const listing = await channel.listAgents({ credentials: KEY_PAIR, regions: [region] });

    expect(listing.outcome).toBe("listed");
    if (listing.outcome !== "listed") return;
    expect(listing.items).toHaveLength(1);
    expect(listing.items[0]?.rawAgentId).toBe(arn);
    expect(listing.items[0]?.metadata).toMatchObject({
      platform: "aws_agentcore",
      owner: "support",
      region,
      status: "READY",
      createdAt: "2026-06-01T10:00:00.000Z",
      updatedAt: "2026-11-02T10:00:00.000Z",
    });
    expect(JSON.parse(listing.items[0]?.metadata.matchIds ?? "[]")).toEqual([
      "support_runtime-abc123",
      arn,
    ]);
  });

  /** @scenario "The AWS listing follows every page in every region" */
  it("follows nextToken through every ListAgents and ListAgentRuntimes page", async () => {
    const region = "eu-west-1";
    routes.push(
      on({
        match: { method: "POST", path: "/agents/" },
        answer: (call) =>
          call.body.nextToken === "page-2"
            ? ok({ agentSummaries: [agentSummary({ agentId: "AGENTTWO02", agentName: "two" })] })
            : ok({
                agentSummaries: [agentSummary({ agentId: "AGENTONE01", agentName: "one" })],
                nextToken: "page-2",
              }),
      }),
      bedrockAgent({ region, agentId: "AGENTONE01", agentName: "one" }),
      bedrockAgent({ region, agentId: "AGENTTWO02", agentName: "two" }),
      on({
        match: { method: "POST", path: "/runtimes/" },
        answer: (call) =>
          call.query.get("nextToken") === "runtimes-2"
            ? ok({ agentRuntimes: [runtimeSummary({ region, id: "second-r2" })] })
            : ok({
                agentRuntimes: [runtimeSummary({ region, id: "first-r1" })],
                nextToken: "runtimes-2",
              }),
      }),
    );

    const listing = await channel.listAgents({ credentials: KEY_PAIR, regions: [region] });

    expect(listing.outcome).toBe("listed");
    if (listing.outcome !== "listed") return;
    expect(listing.items.map((item) => item.rawAgentId)).toEqual([
      agentArn({ region, id: "AGENTONE01" }),
      agentArn({ region, id: "AGENTTWO02" }),
      runtimeArn({ region, id: "first-r1" }),
      runtimeArn({ region, id: "second-r2" }),
    ]);
  });

  /** @scenario "An AWS region that refuses fails the whole listing and records nothing" */
  it("refuses the whole listing as unauthorized when one region answers 403", async () => {
    routes.push(
      on({
        match: { method: "POST", path: "/agents/", region: "eu-west-1" },
        answer: ok({
          agentSummaries: [agentSummary({ agentId: "AGENT12345", agentName: "refund-bot" })],
        }),
      }),
      bedrockAgent({ region: "eu-west-1", agentId: "AGENT12345", agentName: "refund-bot" }),
      on({
        match: { method: "POST", path: "/agents/", region: "us-east-1" },
        answer: {
          status: 403,
          body: { message: "not authorized" },
          errorType: "AccessDeniedException",
        },
      }),
    );

    const listing = await channel.listAgents({
      credentials: KEY_PAIR,
      regions: ["eu-west-1", "us-east-1"],
    });

    expect(listing).toEqual({
      outcome: "refused",
      refusal: { reason: "unauthorized", status: 403 },
    });
  });

  it("refuses as too_many_pages when a provider keeps answering a next page", async () => {
    let page = 0;
    routes.push(
      on({
        match: { method: "POST", path: "/agents/" },
        answer: () => ok({ agentSummaries: [], nextToken: `page-${++page}` }),
      }),
    );

    const listing = await channel.listAgents({ credentials: KEY_PAIR, regions: ["eu-west-1"] });

    expect(listing).toEqual({
      outcome: "refused",
      refusal: { reason: "too_many_pages", status: null },
    });
  });

  /** @scenario "An AWS source whose connection holds no credentials refuses as not configured" */
  it("refuses as not_configured without signing when the connection holds no key pair or role", async () => {
    const listing = await channel.listAgents({
      credentials: { accessKeyId: null, secretAccessKey: null, roleArn: null, externalId: null },
      regions: ["eu-west-1"],
    });

    expect(listing).toEqual({
      outcome: "refused",
      refusal: { reason: "not_configured", status: null },
    });
    expect(calls).toHaveLength(0);
  });
});
