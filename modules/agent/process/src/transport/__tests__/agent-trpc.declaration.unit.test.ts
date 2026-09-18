import { agentTrpc } from "@langwatch/agent-contract";
import { expect, it } from "vitest";
import { createAgentAppFixture } from "../../app/__tests__/agent.fixture.ts";
import { agentTrpcTransport } from "../agent.trpc.ts";
import { accessDeclaredBy, agentTrpcCaller } from "./agent-trpc.fixture.ts";

it("binds every existing tRPC procedure once and preserves its permission", () => {
  const declarations = accessDeclaredBy(agentTrpcTransport);

  expect(
    Object.entries(agentTrpc.members).map(([name, member], index) => [
      name,
      member.kind,
      declarations[index],
    ]),
  ).toEqual([
    ["getAll", "query", "evaluations:view"],
    ["getById", "query", "evaluations:view"],
    ["create", "mutation", "evaluations:manage"],
    ["update", "mutation", "evaluations:manage"],
    ["getRelatedEntities", "query", "evaluations:view"],
    ["cascadeArchive", "mutation", "evaluations:manage"],
    ["delete", "mutation", "evaluations:manage"],
    ["getCopies", "query", "evaluations:view"],
    ["copy", "mutation", "evaluations:manage"],
    ["pushToCopies", "mutation", "evaluations:manage"],
    ["syncFromSource", "mutation", "evaluations:manage"],
    ["getHistory", "query", "evaluations:view"],
    ["testTurn", "mutation", "evaluations:manage"],
    ["testRun", "mutation", "scenarios:create"],
  ]);
});

it("preserves the full connected view through the declared output parser", async () => {
  const { app } = createAgentAppFixture();
  await app.create({
    id: "agent_1",
    projectId: "project_1",
    name: "Assistant",
    type: "signature",
    config: {},
  });
  const caller = agentTrpcCaller({ declaration: agentTrpcTransport, app });
  const result = await caller.getById({ id: "agent_1", projectId: "project_1" });

  expect(result).toMatchObject({
    id: "agent_1",
    status: "offline",
    instances: [],
    owner: null,
    selectable: true,
    notSelectableReason: null,
    parameters: [],
    _count: { copiedAgents: 0 },
    environment: null,
    ownerUserId: null,
    hostLabel: null,
    lastSeenAt: null,
  });
});
