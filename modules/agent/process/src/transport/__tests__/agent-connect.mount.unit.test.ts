import { createServer, type Server } from "node:http";

import {
  type AgentApi,
  type AgentConnectAdmission,
  AgentRegisterRefusedError,
} from "@langwatch/agent-contract";
import { ProjectRequiredError, WebSocketHost } from "@langwatch/api";
import type { RestIdentity } from "@langwatch/api/hosting";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { agentProcessModule } from "../../agent.module.ts";
import { CONNECT_PATH, createAgentWebSocketProtocol } from "../agent-connect.ws.ts";
import { CONNECT_TEST_CREDENTIAL, connectDoor } from "./agent-connect-door.fixture.ts";

const REACHABLE = [
  { id: "project_a", name: "Project A" },
  { id: "project_b", name: "Project B" },
];

/** Admits a key that names its project; one that names none reaches two and must pick. */
function doorByProjectHeader(): RestIdentity {
  const admits = connectDoor();
  const refuses = connectDoor({ refusal: new ProjectRequiredError({ projects: REACHABLE }) });
  return {
    authenticate: (input) =>
      input.request.headers.get("x-project-id")
        ? admits.authenticate(input)
        : refuses.authenticate(input),
  };
}

describe("the connected agents' socket", () => {
  const admissions: AgentConnectAdmission[] = [];
  const asked: Parameters<RestIdentity["authenticate"]>[0][] = [];
  const host = WebSocketHost.create();
  let server: Server;
  let url: string;

  beforeAll(async () => {
    const door = doorByProjectHeader();
    host.withDoor({
      identities: {
        project: {
          authenticate: (input) => {
            asked.push(input);
            return door.authenticate(input);
          },
        },
        organization: door,
        api_key: door,
      },
    });
    host.mount(createAgentWebSocketProtocol(), () =>
      createApiFixture<AgentApi>({
        acceptConnection: async (connection, admission) => {
          admissions.push(admission);
          connection.close(1000, "seen");
        },
      }),
    );
    server = createServer((_request, response) => response.writeHead(404).end());
    server.on("upgrade", (request, socket, head) => host.upgrade(request, socket, head));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no port bound");
    url = `ws://127.0.0.1:${address.port}${CONNECT_PATH}`;
  });

  afterAll(async () => {
    await host.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function connect(headers: Record<string, string>): Promise<number> {
    const socket = new WebSocket(url, { headers });
    return new Promise<number>((resolve, reject) => {
      socket.once("close", resolve);
      socket.once("error", reject);
    });
  }

  /** @scenario "The agent module declares its socket where main served it" */
  it("is declared among the agent module's transports at main's path", () => {
    expect(CONNECT_PATH).toBe("/api/v1/agents/connect");
    expect(
      agentProcessModule.transports?.some((transport) => transport.protocol === "websocket"),
    ).toBe(true);
  });

  /** @scenario "An upgrade to the agent socket reaches the agent module with its headers" */
  it("asks the project door for scenarios:manage and hands the caller and token on", async () => {
    admissions.length = 0;
    asked.length = 0;
    const code = await connect({
      authorization: "Bearer sk-lw-key",
      "x-project-id": "project_test",
      "x-agent-instance-token": "instance_1",
    });

    expect(code).toBe(1000);
    expect(asked[0]).toMatchObject({
      permission: "scenarios:manage",
      keyKinds: ["api_key", "legacy_project_key"],
    });
    expect(asked[0]?.request.headers.get("authorization")).toBe("Bearer sk-lw-key");
    expect(admissions).toEqual([
      {
        admitted: {
          instanceToken: "instance_1",
          caller: {
            project: { id: "project_test", slug: CONNECT_TEST_CREDENTIAL.project.slug },
            userId: "user_test",
            principalId: "user:user_test",
          },
        },
      },
    ]);
  });

  describe("when a key that reaches several projects names none", () => {
    /** @scenario "A key that reaches several projects must name one" */
    it("opens the socket and hands on a project_required refusal listing them", async () => {
      admissions.length = 0;
      const code = await connect({ authorization: "Bearer sk-lw-org" });

      expect(code).toBe(1000);
      const [admission] = admissions;
      if (!admission || !("refused" in admission)) throw new Error("expected a refusal");
      expect(admission.refused).toBeInstanceOf(AgentRegisterRefusedError);
      expect((admission.refused as AgentRegisterRefusedError).meta).toMatchObject({
        reason: "project_required",
        projects: REACHABLE,
        frame: { code: "project_required", meta: { projects: REACHABLE } },
      });
    });
  });
});
