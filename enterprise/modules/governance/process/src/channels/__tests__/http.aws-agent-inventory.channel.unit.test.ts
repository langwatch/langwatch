// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The AWS agent inventory against a local listener speaking the Bedrock Agents and AgentCore
 * control REST routes, so the real SDK serializers, signing and pagination run end to end.
 * Spec: enterprise/modules/governance/specs/cloud-agent-discovery.feature
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { GovernanceAwsCredentials } from "../../repositories/governance-aws-connection.repository.ts";
import { HttpAwsAgentInventoryChannel } from "../http/http.aws-agent-inventory.channel.ts";

const ACCOUNT = "111122223333";
const KEY_PAIR: GovernanceAwsCredentials = {
  accessKeyId: "AKIAEXAMPLE",
  secretAccessKey: "example-secret",
  roleArn: null,
  externalId: null,
};

interface Call {
  method: string;
  path: string;
  region: string;
  service: string;
  body: Record<string, unknown>;
  query: URLSearchParams;
}

type Answer = { status: number; body: unknown; errorType?: string };
type Route = (call: Call) => Answer | undefined;

const agentArn = (region: string, id: string) => `arn:aws:bedrock:${region}:${ACCOUNT}:agent/${id}`;
const runtimeArn = (region: string, id: string) =>
  `arn:aws:bedrock-agentcore:${region}:${ACCOUNT}:runtime/${id}`;
const ok = (body: unknown): Answer => ({ status: 200, body });

/** Empty Bedrock and AgentCore answers for anything a test does not route itself. */
const emptyAccount: Route = (call) => {
  if (call.method === "POST" && call.path === "/agents/") return ok({ agentSummaries: [] });
  if (call.method === "POST" && call.path === "/runtimes/") return ok({ agentRuntimes: [] });
  if (call.method === "POST" && call.path.endsWith("/agentaliases/")) {
    return ok({ agentAliasSummaries: [] });
  }
  if (call.method === "GET" && call.path.startsWith("/tags/")) return ok({ tags: {} });
  return undefined;
};

function bedrockAgent({
  region,
  agentId,
  agentName,
  foundationModel = "anthropic.claude-sonnet-5",
}: {
  region: string;
  agentId: string;
  agentName: string;
  foundationModel?: string;
}): Route {
  return (call) => {
    if (call.region !== region) return undefined;
    if (call.method === "GET" && call.path === `/agents/${agentId}/`) {
      return ok({
        agent: {
          agentId,
          agentName,
          agentArn: agentArn(region, agentId),
          agentVersion: "DRAFT",
          agentStatus: "PREPARED",
          foundationModel,
          agentResourceRoleArn: `arn:aws:iam::${ACCOUNT}:role/agent`,
          idleSessionTTLInSeconds: 600,
          createdAt: "2026-07-01T10:00:00.000Z",
          updatedAt: "2026-11-01T10:00:00.000Z",
        },
      });
    }
    return undefined;
  };
}

function agentSummary(agentId: string, agentName: string) {
  return {
    agentId,
    agentName,
    agentStatus: "PREPARED",
    updatedAt: "2026-11-01T10:00:00.000Z",
  };
}

function runtimeSummary(region: string, id: string) {
  return {
    agentRuntimeArn: runtimeArn(region, id),
    agentRuntimeId: id,
    agentRuntimeName: id.split("-")[0],
    agentRuntimeVersion: "1",
    description: "ACME support",
    lastUpdatedAt: "2026-11-02T10:00:00.000Z",
    status: "READY",
  };
}

function callOf(req: IncomingMessage, raw: string): Call {
  const url = new URL(req.url ?? "/", "http://listener");
  const scope = /Credential=[^/]+\/\d+\/([^/]+)\/([^/]+)\//.exec(req.headers.authorization ?? "");
  return {
    method: req.method ?? "GET",
    path: decodeURIComponent(url.pathname),
    region: scope?.[1] ?? "",
    service: scope?.[2] ?? "",
    body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
    query: url.searchParams,
  };
}

const NO_ROUTE: Answer = {
  status: 404,
  body: { message: "no route" },
  errorType: "ResourceNotFoundException",
};

function answerFor({ routes, call }: { routes: Route[]; call: Call }): Answer {
  for (const route of [...routes, emptyAccount]) {
    const reply = route(call);
    if (reply) return reply;
  }
  return NO_ROUTE;
}

function reply(res: ServerResponse, answer: Answer) {
  res.writeHead(answer.status, {
    "content-type": "application/json",
    ...(answer.errorType ? { "x-amzn-errortype": answer.errorType } : {}),
  });
  res.end(JSON.stringify(answer.body));
}

/** A listener answering each call from the first route that knows it, recording every call. */
async function startListener(): Promise<{
  server: Server;
  endpoint: string;
  routes: Route[];
  calls: Call[];
}> {
  const routes: Route[] = [];
  const calls: Call[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => (raw += chunk.toString()));
    req.on("end", () => {
      const call = callOf(req, raw);
      calls.push(call);
      reply(res, answerFor({ routes, call }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, endpoint, routes, calls };
}

/** A route answering one method and path, optionally only for one region or signing service. */
function on(
  match: { method: string; path: string; region?: string; service?: string },
  answer: Answer | ((call: Call) => Answer),
): Route {
  return (call) => {
    if (call.method !== match.method || call.path !== match.path) return undefined;
    if (match.region && call.region !== match.region) return undefined;
    if (match.service && call.service !== match.service) return undefined;
    return typeof answer === "function" ? answer(call) : answer;
  };
}

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
    const arn = agentArn(region, "AGENT12345");
    routes.push(
      on(
        { method: "POST", path: "/agents/", region },
        ok({ agentSummaries: [agentSummary("AGENT12345", "refund-bot")] }),
      ),
      bedrockAgent({ region, agentId: "AGENT12345", agentName: "refund-bot" }),
      on(
        { method: "POST", path: "/agents/AGENT12345/agentaliases/" },
        ok({
          agentAliasSummaries: [
            {
              agentAliasId: "PRODALIAS1",
              agentAliasName: "prod",
              createdAt: "2026-07-01T10:00:00.000Z",
              updatedAt: "2026-11-01T10:00:00.000Z",
            },
          ],
        }),
      ),
      on({ method: "GET", path: `/tags/${arn}` }, ok({ tags: { owner: "payments", env: "prod" } })),
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

  /** @scenario "A Bedrock AgentCore runtime becomes a sighting keyed by its ARN" */
  it("lists an AgentCore runtime as a sighting keyed by its runtime ARN", async () => {
    const region = "us-east-1";
    const arn = runtimeArn(region, "support_runtime-abc123");
    routes.push(
      on(
        { method: "POST", path: "/runtimes/" },
        ok({ agentRuntimes: [runtimeSummary(region, "support_runtime-abc123")] }),
      ),
      on(
        { method: "GET", path: `/tags/${arn}`, service: "bedrock-agentcore" },
        ok({ tags: { team: "support" } }),
      ),
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
      on({ method: "POST", path: "/agents/" }, (call) =>
        call.body.nextToken === "page-2"
          ? ok({ agentSummaries: [agentSummary("AGENTTWO02", "two")] })
          : ok({ agentSummaries: [agentSummary("AGENTONE01", "one")], nextToken: "page-2" }),
      ),
      bedrockAgent({ region, agentId: "AGENTONE01", agentName: "one" }),
      bedrockAgent({ region, agentId: "AGENTTWO02", agentName: "two" }),
      on({ method: "POST", path: "/runtimes/" }, (call) =>
        call.query.get("nextToken") === "runtimes-2"
          ? ok({ agentRuntimes: [runtimeSummary(region, "second-r2")] })
          : ok({ agentRuntimes: [runtimeSummary(region, "first-r1")], nextToken: "runtimes-2" }),
      ),
    );

    const listing = await channel.listAgents({ credentials: KEY_PAIR, regions: [region] });

    expect(listing.outcome).toBe("listed");
    if (listing.outcome !== "listed") return;
    expect(listing.items.map((item) => item.rawAgentId)).toEqual([
      agentArn(region, "AGENTONE01"),
      agentArn(region, "AGENTTWO02"),
      runtimeArn(region, "first-r1"),
      runtimeArn(region, "second-r2"),
    ]);
  });

  /** @scenario "An AWS region that refuses fails the whole listing and records nothing" */
  it("refuses the whole listing as unauthorized when one region answers 403", async () => {
    routes.push(
      on(
        { method: "POST", path: "/agents/", region: "eu-west-1" },
        ok({ agentSummaries: [agentSummary("AGENT12345", "refund-bot")] }),
      ),
      bedrockAgent({ region: "eu-west-1", agentId: "AGENT12345", agentName: "refund-bot" }),
      on(
        { method: "POST", path: "/agents/", region: "us-east-1" },
        { status: 403, body: { message: "not authorized" }, errorType: "AccessDeniedException" },
      ),
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
      on({ method: "POST", path: "/agents/" }, () =>
        ok({ agentSummaries: [], nextToken: `page-${++page}` }),
      ),
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
