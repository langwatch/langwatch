// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** A local listener speaking the Bedrock Agents and AgentCore control REST routes, for the channel tests. */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import type { GovernanceAwsCredentials } from "../../repositories/governance-aws-connection.repository.ts";

export const ACCOUNT = "111122223333";
export const KEY_PAIR: GovernanceAwsCredentials = {
  accessKeyId: "AKIAEXAMPLE",
  secretAccessKey: "example-secret",
  roleArn: null,
  externalId: null,
};

export interface Call {
  method: string;
  path: string;
  region: string;
  service: string;
  body: Record<string, unknown>;
  query: URLSearchParams;
}

export type Answer = { status: number; body: unknown; errorType?: string };
export type Route = (call: Call) => Answer | undefined;

export const agentArn = ({ region, id }: { region: string; id: string }) =>
  `arn:aws:bedrock:${region}:${ACCOUNT}:agent/${id}`;
export const runtimeArn = ({ region, id }: { region: string; id: string }) =>
  `arn:aws:bedrock-agentcore:${region}:${ACCOUNT}:runtime/${id}`;
export const ok = (body: unknown): Answer => ({ status: 200, body });

/** Empty Bedrock and AgentCore answers for anything a test does not route itself. */
export const emptyAccount: Route = (call) => {
  if (call.method === "POST" && call.path === "/agents/") return ok({ agentSummaries: [] });
  if (call.method === "POST" && call.path === "/runtimes/") return ok({ agentRuntimes: [] });
  if (call.method === "POST" && call.path.endsWith("/agentaliases/")) {
    return ok({ agentAliasSummaries: [] });
  }
  if (call.method === "GET" && call.path.startsWith("/tags/")) return ok({ tags: {} });
  const runtime = /^\/runtimes\/([^/]+)\/$/.exec(call.path);
  if (call.method === "GET" && runtime) {
    return ok({ agentRuntimeId: runtime[1], createdAt: "2026-06-01T10:00:00.000Z" });
  }
  return undefined;
};

export function bedrockAgent({
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
          agentArn: agentArn({ region, id: agentId }),
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

export function agentSummary({ agentId, agentName }: { agentId: string; agentName: string }) {
  return {
    agentId,
    agentName,
    agentStatus: "PREPARED",
    updatedAt: "2026-11-01T10:00:00.000Z",
  };
}

export function runtimeSummary({ region, id }: { region: string; id: string }) {
  return {
    agentRuntimeArn: runtimeArn({ region, id }),
    agentRuntimeId: id,
    agentRuntimeName: id.split("-")[0],
    agentRuntimeVersion: "1",
    description: "ACME support",
    lastUpdatedAt: "2026-11-02T10:00:00.000Z",
    status: "READY",
  };
}

function callOf({ req, raw }: { req: IncomingMessage; raw: string }): Call {
  const url = new URL(req.url ?? "/", "http://listener");
  // SigV4: `Credential=<key>/<date>/<region>/<service>/aws4_request`, one of the comma parts.
  const credential = (req.headers.authorization ?? "")
    .split(",")
    .map((part) => part.trim())
    .find((part) => part.includes("Credential="));
  const [, , region, service] = credential?.split("Credential=")[1]?.split("/") ?? [];
  return {
    method: req.method ?? "GET",
    path: decodeURIComponent(url.pathname),
    region: region ?? "",
    service: service ?? "",
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

function reply({ res, answer }: { res: ServerResponse; answer: Answer }) {
  res.writeHead(answer.status, {
    "content-type": "application/json",
    ...(answer.errorType ? { "x-amzn-errortype": answer.errorType } : {}),
  });
  res.end(JSON.stringify(answer.body));
}

/** A listener answering each call from the first route that knows it, recording every call. */
export async function startListener(): Promise<{
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
      const call = callOf({ req, raw });
      calls.push(call);
      reply({ res, answer: answerFor({ routes, call }) });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, endpoint, routes, calls };
}

/** A route answering one method and path, optionally only for one region or signing service. */
export function on({
  match,
  answer,
}: {
  match: { method: string; path: string; region?: string; service?: string };
  answer: Answer | ((call: Call) => Answer);
}): Route {
  return (call) => {
    if (call.method !== match.method || call.path !== match.path) return undefined;
    if (match.region && call.region !== match.region) return undefined;
    if (match.service && call.service !== match.service) return undefined;
    return typeof answer === "function" ? answer(call) : answer;
  };
}
