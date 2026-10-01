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

describe("the by-path agent client", () => {
  describe("when an agent is deleted", () => {
    it("reads the archived row whose dates arrived as strings", async () => {
      const client = TrpcAgentClient.create(new JsonRpc(ARCHIVED_AGENT));

      const archived = await client.archive({ id: "agent_1", projectId: "project_1" });

      expect(archived.archivedAt).toEqual(new Date("2026-09-28T14:44:21.207Z"));
      expect(archived.createdAt).toBeInstanceOf(Date);
    });
  });
});
