/** The long-poll connect family answers main's relay bodies, byte for byte (ADR-129, §8). */
import { INSTANCE_TOKEN_HEADER } from "@langwatch/agent-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import {
  BearerIdentity,
  bindRestCredential,
  RestHost,
  SessionKeyIdentity,
} from "@langwatch/api/rest";
import {
  type LangyApi,
  type LangyControlRegistered,
  LangyLocalRecordNotFoundError,
  LangySessionKeyInvalidError,
  LangySessionKeyUnboundError,
  LangySessionKeyWrongTypeError,
  LOCAL_CONTROL_PROTOCOL_VERSION,
} from "@langwatch/langy-contract";
import { describe, expect, it, vi } from "vitest";

import { langyLocalControlConnectRest } from "../langy-local-control-connect.rest.ts";

const LIVE_KEY = "sk-lw-session-live";
const HOLDER = { type: "user", id: "user-1" } as const;

const REGISTER_FRAME = {
  protocol: LOCAL_CONTROL_PROTOCOL_VERSION,
  type: "register",
  cli: { name: "langwatch", version: "1.0.0" },
  instance: {
    id: "lci_instance",
    hostname: "rogerio-mbp",
    username: "dev",
    pid: 4242,
    startedAt: "2026-09-25T12:00:00.000Z",
    inFlightCallIds: [],
  },
  workspace: { root: "/Users/dev/acme-app", name: "acme-app", os: "darwin" },
};

const REGISTERED: LangyControlRegistered = {
  frame: {
    type: "registered",
    protocol: LOCAL_CONTROL_PROTOCOL_VERSION,
    instanceId: "lci_instance",
    heartbeatIntervalMs: 15_000,
    conversation: { id: "conversation-1", title: "A conversation", url: "https://app.test/c/1" },
    policy: { skipPermissions: false },
  },
  instanceToken: "lcs_token",
};

const KEY_REFUSALS: Readonly<Record<string, () => Error>> = {
  "sk-lw-guessed": () => new LangySessionKeyInvalidError(),
  "sk-lw-project-key": () => new LangySessionKeyWrongTypeError(),
  "sk-lw-session-lapsed": () => new LangySessionKeyUnboundError({ reason: "binding_lapsed" }),
};

function family() {
  const ops = {
    verifyLocalControlSessionKey: vi.fn<LangyApi["verifyLocalControlSessionKey"]>(async (key) => {
      const refusal = KEY_REFUSALS[key.token];
      if (refusal) throw refusal();
      return { actor: HOLDER, projectId: "project-1" };
    }),
    registerLocalControlSession: vi.fn<LangyApi["registerLocalControlSession"]>(
      async () => REGISTERED,
    ),
    pollLocalControlSession: vi.fn<LangyApi["pollLocalControlSession"]>(async (input) => {
      if (input.instanceToken !== "lcs_token") throw new LangyLocalRecordNotFoundError();
      return { frames: [] };
    }),
    postLocalControlFrames: vi.fn<LangyApi["postLocalControlFrames"]>(async (input) => {
      if (input.instanceToken !== "lcs_token") throw new LangyLocalRecordNotFoundError();
      return { accepted: input.frames.length };
    }),
  };
  const app = createApiFixture<LangyApi>(ops);
  const closed = BearerIdentity.create({ name: "unconfigured", token: void 0 });
  const host = RestHost.create({
    identities: {
      project: closed,
      organization: closed,
      apiKey: closed,
      scimToken: closed,
      "instance-admin": closed,
      browser: closed,
    },
    bearers: () => closed,
    audit: { record: async () => {} },
  });
  const door = SessionKeyIdentity.create({
    instanceTokenHeader: INSTANCE_TOKEN_HEADER,
    verify: (presented) => app.verifyLocalControlSessionKey(presented),
  });
  host.mount(langyLocalControlConnectRest.router(), () => app, {
    facts: [bindRestCredential("sessionKey", () => door)],
  });
  const request = (path: string, init: RequestInit = {}) =>
    host.app.request(`http://api.test/api/v1/langy/control/connect${path}`, init);
  const registerWith = (body: unknown, headers: Record<string, string>) =>
    request("/register", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", "x-project-id": "project-1", ...headers },
    });
  const register = (body: unknown, key?: string) =>
    registerWith(body, key ? { authorization: `Bearer ${key}` } : {});
  return { ops, request, register, registerWith };
}

function refused(code: string, message: string) {
  return { frame: { type: "refused", protocol: LOCAL_CONTROL_PROTOCOL_VERSION, code, message } };
}

describe("registering a folder over long-poll", () => {
  describe("given the session key an approval minted", () => {
    it("answers the registered frame and the instance token, status 200", async () => {
      const api = family();

      const response = await api.register(REGISTER_FRAME, LIVE_KEY);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(REGISTERED);
      expect(api.ops.registerLocalControlSession).toHaveBeenCalledWith({
        actor: HOLDER,
        projectId: "project-1",
        authorization: `Bearer ${LIVE_KEY}`,
        frame: REGISTER_FRAME,
      });
    });
  });

  describe("given the session key as Basic base64(projectId:key)", () => {
    /** @scenario "The CLI may send the session key as a bearer token or as Basic credentials" */
    it("registers with the key and project the header carries, status 200", async () => {
      const api = family();
      const authorization = `Basic ${Buffer.from(`project-1:${LIVE_KEY}`).toString("base64")}`;

      const response = await api.registerWith(REGISTER_FRAME, { authorization });

      expect(response.status).toBe(200);
      expect(api.ops.verifyLocalControlSessionKey).toHaveBeenCalledWith({
        token: LIVE_KEY,
        projectId: "project-1",
        instanceToken: null,
      });
      expect(api.ops.registerLocalControlSession).toHaveBeenCalledWith(
        expect.objectContaining({ authorization }),
      );
    });
  });

  describe("given the session key only in X-Auth-Token", () => {
    /** @scenario "The CLI may send the session key as a bearer token or as Basic credentials" */
    it("answers main's bearer-token refused frame without asking Langy, status 403", async () => {
      const api = family();

      const response = await api.registerWith(REGISTER_FRAME, { "x-auth-token": LIVE_KEY });

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual(
        refused("api_key_invalid", "Send the Langy session key as a bearer token."),
      );
      expect(api.ops.verifyLocalControlSessionKey).not.toHaveBeenCalled();
    });
  });

  describe("given no key", () => {
    it("answers main's refused frame without asking Langy, status 403", async () => {
      const api = family();

      const response = await api.register(REGISTER_FRAME);

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual(
        refused("api_key_invalid", "Send the Langy session key as a bearer token."),
      );
      expect(api.ops.verifyLocalControlSessionKey).not.toHaveBeenCalled();
    });
  });

  describe.each([
    ["sk-lw-guessed", "api_key_invalid", "That key is not valid for this project."],
    [
      "sk-lw-project-key",
      "key_type_not_allowed",
      "Only the key that approving a control request mints can share a folder. Run `langwatch langy --share-control` and approve the request.",
    ],
    [
      "sk-lw-session-lapsed",
      "conversation_mismatch",
      "That key does not control a conversation any more. Ask Langy for the code change again.",
    ],
  ])("given the key %s", (key, code, message) => {
    /** @scenario "A long-poll register with a key that is not a Langy session key answers a refused frame" */
    it(`answers the refused frame ${code}, status 403`, async () => {
      const api = family();

      const response = await api.register(REGISTER_FRAME, key);

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual(refused(code, message));
      expect(api.ops.registerLocalControlSession).not.toHaveBeenCalled();
    });
  });

  describe("given a body that is no register frame", () => {
    it("answers main's protocol_invalid frame, status 422", async () => {
      const api = family();

      const response = await api.register({ type: "hello" }, LIVE_KEY);

      expect(response.status).toBe(422);
      expect(await response.json()).toEqual(
        refused(
          "protocol_invalid",
          `The body must be a register frame with protocol ${LOCAL_CONTROL_PROTOCOL_VERSION}.`,
        ),
      );
    });
  });
});

describe("polling a long-poll share", () => {
  describe("given the instance token register handed out", () => {
    it("hands the token and the calls still held to Langy, status 200", async () => {
      const api = family();

      const response = await api.request("/poll?inFlight=call-1,call-2", {
        headers: { [INSTANCE_TOKEN_HEADER]: "lcs_token" },
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ frames: [] });
      expect(api.ops.pollLocalControlSession).toHaveBeenCalledWith(
        expect.objectContaining({
          instanceToken: "lcs_token",
          inFlightCallIds: ["call-1", "call-2"],
        }),
      );
    });
  });

  describe("given no instance token this pod knows", () => {
    /** @scenario "A long-poll poll or post for an unknown instance token answers 410" */
    it("answers main's empty frames, status 410", async () => {
      const api = family();

      const response = await api.request("/poll");

      expect(response.status).toBe(410);
      expect(await response.text()).toBe(JSON.stringify({ frames: [] }));
    });
  });
});

describe("posting a long-poll share's frames", () => {
  const post = (api: ReturnType<typeof family>, body: unknown, token: string) =>
    api.request("/frames", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", [INSTANCE_TOKEN_HEADER]: token },
    });
  const ack = { protocol: LOCAL_CONTROL_PROTOCOL_VERSION, type: "ack", callId: "call-1" };

  it("answers how many frames were taken, status 200", async () => {
    const response = await post(family(), { frames: [ack] }, "lcs_token");

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(JSON.stringify({ accepted: 1 }));
  });

  /** @scenario "A long-poll poll or post for an unknown instance token answers 410" */
  it("answers main's 410 for an instance token this pod does not know", async () => {
    const response = await post(family(), { frames: [ack] }, "lcs_other");

    expect(response.status).toBe(410);
    expect(await response.text()).toBe(JSON.stringify({ accepted: 0 }));
  });

  it("answers main's 422 for a body that is no frame list", async () => {
    const response = await post(family(), { frames: [] }, "lcs_token");

    expect(response.status).toBe(422);
    expect(await response.text()).toBe(JSON.stringify({ accepted: 0 }));
  });
});
