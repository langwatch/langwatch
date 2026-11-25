import { createServer, type Server } from "node:http";

import { WebSocketHost } from "@langwatch/api";
import { bindRestCredential } from "@langwatch/api/rest";
import {
  type LangyApi,
  LangySessionKeyInvalidError,
  LangySessionKeyUnboundError,
  LangySessionKeyWrongTypeError,
  type LocalControlConnectionOpened,
} from "@langwatch/langy-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { langyProcessModule } from "../../langy.module.ts";
import { localControlSessionKeyDoor } from "../langy-local-control-connect.rest.ts";
import {
  CONTROL_CONNECT_PATH,
  createLangyLocalControlWebSocketProtocol,
} from "../langy-local-control.ws.ts";

const CREDENTIAL = {
  apiKeyId: "key-1",
  projectId: "project_1",
  projectSlug: "project-one",
  userId: "user_1",
  conversationId: "conversation_1",
  requestId: "request_1",
};

/** The minting module's answer per presented key: a holder, or the refusal it throws. */
const KEYS: Record<string, () => Error> = {
  "lwsk-guessed": () => new LangySessionKeyInvalidError(),
  "lwsk-personal": () => new LangySessionKeyWrongTypeError(),
  "lwsk-lapsed": () => new LangySessionKeyUnboundError({ reason: "binding_lapsed" }),
};

describe("the local folder's socket", () => {
  const accepted: LocalControlConnectionOpened[] = [];
  const presented: { token: string; projectId: string | null }[] = [];
  const host = WebSocketHost.create();
  const door = localControlSessionKeyDoor.open(
    createApiFixture<LangyApi>({
      verifyLocalControlSessionKey: async ({ token, projectId }) => {
        presented.push({ token, projectId });
        const refusal = KEYS[token];
        if (refusal) throw refusal();
        return { actor: { type: "user", id: CREDENTIAL.userId }, ...CREDENTIAL };
      },
    }),
  );
  let server: Server;
  let url: string;

  beforeAll(async () => {
    host.mount(
      createLangyLocalControlWebSocketProtocol(),
      () =>
        createApiFixture<LangyApi>({
          acceptLocalControlConnection: async (connection, opened) => {
            accepted.push(opened);
            if ("refused" in opened) {
              connection.send(JSON.stringify({ type: "refused", ...opened.refused }));
              connection.close(1008, opened.refused.code);
              return;
            }
            connection.close(1000, "seen");
          },
        }),
      { middlewareBindings: [bindRestCredential("session_key", () => door)] },
    );
    server = createServer((_request, response) => response.writeHead(404).end());
    server.on("upgrade", (request, socket, head) => host.upgrade(request, socket, head));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no port bound");
    url = `ws://127.0.0.1:${address.port}${CONTROL_CONNECT_PATH}`;
  });

  afterAll(async () => {
    await host.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  /** @scenario "The langy module declares the local folder's socket where main served it" */
  it("is declared among the langy module's transports at main's path", () => {
    expect(CONTROL_CONNECT_PATH).toBe("/api/v1/langy/control/connect");
    expect(
      langyProcessModule.transports?.some((transport) => transport.protocol === "websocket"),
    ).toBe(true);
  });

  /** @scenario "An upgrade to the local folder's socket reaches langy with the session key" */
  it("asks langy's door and hands the langy application what it resolved", async () => {
    const socket = new WebSocket(url, {
      headers: {
        authorization: "Bearer lwsk-key",
        "x-project-id": "project_1",
      },
    });
    const code = await new Promise<number>((resolve, reject) => {
      socket.once("close", resolve);
      socket.once("error", reject);
    });

    expect(code).toBe(1000);
    expect(presented.at(-1)).toEqual({ token: "lwsk-key", projectId: "project_1" });
    expect(accepted.at(-1)).toEqual({ admitted: CREDENTIAL });
  });

  describe.each([
    {
      key: undefined,
      code: "api_key_invalid",
      message: "Send the Langy session key as a bearer token.",
    },
    {
      key: "lwsk-guessed",
      code: "api_key_invalid",
      message: "That key is not valid for this project.",
    },
    {
      key: "lwsk-personal",
      code: "key_type_not_allowed",
      message: expect.stringContaining("langwatch langy"),
    },
    {
      key: "lwsk-lapsed",
      code: "conversation_mismatch",
      message: expect.stringContaining("does not control"),
    },
  ])("given $key", ({ key, code, message }) => {
    /** @scenario "An upgrade to the local folder's socket with a refused key answers main's refused frame" */
    it(`opens the socket, answers the refused frame ${code} and closes 1008`, async () => {
      const socket = new WebSocket(url, {
        headers: key ? { authorization: `Bearer ${key}`, "x-project-id": "project_1" } : {},
      });
      const frames: unknown[] = [];
      socket.on("message", (data) =>
        frames.push(JSON.parse(Buffer.isBuffer(data) ? data.toString("utf8") : "")),
      );
      const closed = await new Promise<{ code: number; reason: string }>((resolve, reject) => {
        socket.once("close", (closeCode, reason) =>
          resolve({ code: closeCode, reason: String(reason) }),
        );
        socket.once("error", reject);
      });

      expect(closed).toEqual({ code: 1008, reason: code });
      expect(frames).toEqual([{ type: "refused", code, message }]);
      expect(accepted.at(-1)).toEqual({ refused: { code, message } });
    });
  });
});
