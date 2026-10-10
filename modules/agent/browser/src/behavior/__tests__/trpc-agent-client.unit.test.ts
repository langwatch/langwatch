/**
 * @vitest-environment node
 * The by-path agent client reads rows off a JSON transport, where dates are ISO strings.
 */
import { UiRpc, type UiRpcSubscription } from "@langwatch/browser-host/capabilities";
import { describe, expect, it } from "vitest";

import { TrpcAgentClient } from "../trpc-agent-client.ts";

/** Answers every call with one fixed JSON body, as the wire would. */
class JsonRpc extends UiRpc {
  constructor(private readonly body: unknown) {
    super();
  }

  async query(): Promise<unknown> {
    return this.body;
  }

  async mutate(): Promise<unknown> {
    return this.body;
  }

  subscribe(): UiRpcSubscription {
    return { unsubscribe: () => undefined };
  }
}

const ARCHIVED_AGENT = {
  id: "agent_1",
  projectId: "project_1",
  name: "Echo",
  workflowId: null,
  copiedFromAgentId: null,
  archivedAt: "2026-09-28T14:44:21.207Z",
  createdAt: "2026-09-28T14:44:11.931Z",
  updatedAt: "2026-09-28T14:44:21.210Z",
  environment: null,
  ownerUserId: null,
  hostLabel: null,
  identityKey: null,
  lastSeenAt: null,
  type: "http",
  config: {
    name: "HTTP",
    description: "HTTP API endpoint",
    url: "http://127.0.0.1:9/agent",
    method: "POST",
    headers: [],
    outputPath: "$.output",
  },
};

/** Answers each path from its own table and records every call, as a host mount would. */
class RoutedRpc extends UiRpc {
  readonly calls: { path: string; input: unknown }[] = [];

  constructor(private readonly bodies: Record<string, unknown>) {
    super();
  }

  async query(path: string, input: unknown): Promise<unknown> {
    this.calls.push({ path, input });
    return this.bodies[path];
  }

  async mutate(path: string, input: unknown): Promise<unknown> {
    return this.query(path, input);
  }

  subscribe(): UiRpcSubscription {
    return { unsubscribe: () => undefined };
  }
}

const WORKFLOW_AGENT = {
  ...ARCHIVED_AGENT,
  id: "agent_2",
  type: "workflow",
  archivedAt: null,
  workflowId: "workflow_1",
  config: { name: "Studio", workflow_id: "workflow_1" },
  inputFields: [],
  outputFields: [],
  fieldsResolved: false,
};

const REFERENCE = { id: "agent_2", projectId: "project_1" };

describe("the by-path agent client", () => {
  describe("when the archive dialog asks for the linked workflow", () => {
    /** @scenario "The archive dialog names the linked workflow through Workflow" */
    it("names it from Workflow's own list for the agent's project", async () => {
      const rpc = new RoutedRpc({
        "agents.getById": WORKFLOW_AGENT,
        "workflow.getAll": [
          { id: "workflow_0", name: "Other" },
          { id: "workflow_1", name: "Answering workflow" },
        ],
      });

      const related = await TrpcAgentClient.create(rpc).relatedEntities(REFERENCE);

      expect(related).toEqual({ workflow: { id: "workflow_1", name: "Answering workflow" } });
      expect(rpc.calls).toContainEqual({
        path: "workflow.getAll",
        input: { projectId: "project_1" },
      });
    });

    it("names none when the graph is archived or missing from that list", async () => {
      const rpc = new RoutedRpc({
        "agents.getById": WORKFLOW_AGENT,
        "workflow.getAll": [{ id: "workflow_0", name: "Other" }],
      });

      const related = await TrpcAgentClient.create(rpc).relatedEntities(REFERENCE);

      expect(related).toEqual({ workflow: null });
    });

    it("asks Workflow nothing for an agent without a graph", async () => {
      const rpc = new RoutedRpc({
        "agents.getById": {
          ...ARCHIVED_AGENT,
          archivedAt: null,
          inputFields: [],
          outputFields: [],
          fieldsResolved: true,
        },
      });

      const related = await TrpcAgentClient.create(rpc).relatedEntities({
        id: "agent_1",
        projectId: "project_1",
      });

      expect(related).toEqual({ workflow: null });
      expect(rpc.calls.map((call) => call.path)).toEqual(["agents.getById"]);
    });
  });

  describe("when an agent is deleted", () => {
    it("reads the archived row whose dates arrived as strings", async () => {
      const client = TrpcAgentClient.create(new JsonRpc(ARCHIVED_AGENT));

      const archived = await client.archive({ id: "agent_1", projectId: "project_1" });

      expect(archived.archivedAt).toEqual(new Date("2026-09-28T14:44:21.207Z"));
      expect(archived.createdAt).toBeInstanceOf(Date);
    });
  });
});
