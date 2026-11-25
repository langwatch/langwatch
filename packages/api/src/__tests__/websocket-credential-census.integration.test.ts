/**
 * @vitest-environment node
 * A connected agent's socket is counted into the credential census once the door admits it.
 * @see modules/auth/specs/request-credential-census.feature
 */
import { createServer } from "node:http";

import type * as Census from "@langwatch/observability/credential-census";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { z } from "zod";

import { ProjectInvalidCredentialsError } from "../errors.ts";
import type { RestIdentity } from "../hosting/api-door.ts";
import { recordProjectCredential } from "../rest/credential.ts";
import { type ProtocolConnection, WebSocketHost, WebSocketProtocol } from "../websocket.ts";

const counted = vi.hoisted(() => [] as Census.CensusRequest[]);

vi.mock("@langwatch/observability/credential-census", async (importOriginal) => {
  const actual = await importOriginal<typeof Census>();
  return {
    ...actual,
    recordCredentialCensus: (request: Census.CensusRequest) => counted.push(request),
  };
});

const headerContext = z.object({ authorization: z.string().optional() });
const PROJECT = {
  id: "project_1",
  name: "Project",
  slug: "project-one",
  teamId: "team_1",
  organizationId: "org_1",
  isPersonal: false,
  ownerUserId: null,
  kind: "application",
};

const door: RestIdentity = {
  authenticate: ({ request }) => {
    if (request.headers.get("authorization") !== "Bearer legacy-key") {
      throw new ProjectInvalidCredentialsError();
    }
    recordProjectCredential(request, { type: "legacyProjectKey", project: PROJECT });
    return { actor: null, scope: { tier: "project", id: PROJECT.id } };
  },
};

function firstFrame(url: string, headers: Record<string, string>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers });
    socket.once("message", (data) => {
      resolve(JSON.parse(Buffer.isBuffer(data) ? data.toString("utf8") : ""));
      socket.close();
    });
    socket.once("error", reject);
  });
}

describe("the credential census on a doored socket", () => {
  const host = WebSocketHost.create();
  const listener = createServer((_request, response) => response.writeHead(404).end());
  let port = 0;

  beforeAll(async () => {
    host.withDoor({ identities: { project: door, organization: door, api_key: door } });
    host.mount(
      WebSocketProtocol.create({
        path: "/api/agents/connect",
        maxPayloadBytes: 1024,
        middlewareContext: headerContext,
        headers: { authorization: "authorization" },
        door: { credential: "project", permission: "scenarios:manage" },
        handle: async (_app: object, connection: ProtocolConnection) => {
          connection.send(JSON.stringify({ admitted: true }));
        },
        refuse: async (_app: object, connection) => {
          connection.send(JSON.stringify({ admitted: false }));
        },
      }),
      () => ({}),
    );
    listener.on("upgrade", (request, socket, head) => host.upgrade(request, socket, head));
    await new Promise<void>((resolve) => listener.listen(0, resolve));
    const address = listener.address();
    if (address === null || typeof address === "string") throw new Error("no port bound");
    port = address.port;
  });

  afterAll(async () => {
    await host.close();
    await new Promise<void>((resolve) => listener.close(() => resolve()));
  });

  beforeEach(() => {
    counted.length = 0;
  });

  describe("given a project key", () => {
    /** @scenario "A connected agent's socket is counted when the door admits it" */
    it("counts one upgrade for the socket path and its project, without the query", async () => {
      await expect(
        firstFrame(`ws://127.0.0.1:${port}/api/agents/connect?session=abc`, {
          authorization: "Bearer legacy-key",
          "user-agent": "langwatch-typescript/3.1.0",
        }),
      ).resolves.toEqual({ admitted: true });

      expect(counted).toEqual([
        expect.objectContaining({
          credentialType: "legacy_project_key",
          projectId: PROJECT.id,
          method: "GET",
          route: "/api/agents/connect",
          client: "sdk-typescript",
          status: 101,
        }),
      ]);
      expect(JSON.stringify(counted)).not.toContain("legacy-key");
    });
  });

  describe("given a key the door refuses", () => {
    it("counts nothing", async () => {
      await expect(
        firstFrame(`ws://127.0.0.1:${port}/api/agents/connect`, { authorization: "Bearer nope" }),
      ).resolves.toEqual({ admitted: false });

      expect(counted).toEqual([]);
    });
  });
});
