/**
 * A protocol route's refusals, rendered in its own document at every stage a request can
 * be refused. Mounted through RestHost, the process's own mount, whose family boundary is
 * the canonical envelope. Spec: packages/api/specs/transport-conventions.feature.
 */
import { HandledError } from "@langwatch/handled-error";
import { moduleApi } from "@langwatch/kernel";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { anyAuthenticated } from "../../access/access.ts";
import { MANAGEMENT_API_VERSION } from "../addressing.ts";
import { BearerIdentity } from "../bearer-identity.ts";
import { defineRestRouter } from "../declaration.ts";
import { RestHost } from "../host.ts";
import type { RestProtocolRefusal } from "../response-kind.ts";
import type { RestIdentity } from "../runtime.ts";

const PROTOCOL = "application/example+json";
const BECAUSE = "the directory protocol's wire is its own, not ours";
const GATE = "the bearer is the whole gate";
const AUTHORIZED = { authorization: "Bearer good" };

class DoorRefusedError extends HandledError {
  constructor() {
    super("door_refused", "The bearer is not valid", { httpStatus: 401 });
    this.name = "DoorRefusedError";
  }
}

class ResourceTakenError extends HandledError {
  constructor() {
    super("resource_taken", "That name is taken", { httpStatus: 409 });
    this.name = "ResourceTakenError";
  }
}

interface DirectoryApi {
  create(input: { userName: string }): Promise<{ id: string; userName: string }>;
  refuse(): Promise<{ ok: boolean }>;
  crash(): Promise<{ ok: boolean }>;
  remove(input: { id: string }): Promise<void>;
}

const DirectoryApi = moduleApi<DirectoryApi>()("scim");

const refusal: RestProtocolRefusal = ({ failure, response }) => {
  const status = HandledError.isHandled(failure) ? (failure.httpStatus ?? 500) : 500;
  const code = HandledError.isHandled(failure) ? failure.code : "unhandled";

  return response.write({
    status,
    mediaType: PROTOCOL,
    body: JSON.stringify({ status: String(status), code }),
  });
};

const directory = defineRestRouter(DirectoryApi)
  .withNamespace("directory")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })
  .withCredential("scimToken")

  .post("/directory/Users", "directoryCreateUser")
  .withInput(z.object({ userName: z.string() }))
  .withAccess(anyAuthenticated({ reason: GATE }))
  .withResponse("protocol", { produces: PROTOCOL, because: BECAUSE, refusal })
  .handle(async ({ app, input, response }) =>
    response.write({
      status: 201,
      mediaType: PROTOCOL,
      body: JSON.stringify(await app.create(input)),
    }),
  )

  .get("/directory/refuse", "directoryRefuse")
  .withAccess(anyAuthenticated({ reason: GATE }))
  .withResponse("protocol", { produces: PROTOCOL, because: BECAUSE, refusal })
  .handle(async ({ app, response }) =>
    response.write({ status: 200, mediaType: PROTOCOL, body: JSON.stringify(await app.refuse()) }),
  )

  .get("/directory/crash", "directoryCrash")
  .withAccess(anyAuthenticated({ reason: GATE }))
  .withResponse("protocol", { produces: PROTOCOL, because: BECAUSE, refusal })
  .handle(async ({ app, response }) =>
    response.write({ status: 200, mediaType: PROTOCOL, body: JSON.stringify(await app.crash()) }),
  )

  .delete("/directory/Users/:id", "directoryDeleteUser")
  .withParams(z.object({ id: z.string() }))
  .withAccess(anyAuthenticated({ reason: GATE }))
  .withResponse("protocol", { produces: PROTOCOL, because: BECAUSE, refusal })
  .handle(async ({ app, input, response }) => {
    await app.remove({ id: input.id });

    return response.write({ status: 204, mediaType: PROTOCOL, body: null });
  })

  .post("/directory/plain", "directoryPlain")
  .withInput(z.object({ userName: z.string() }))
  .withAccess(anyAuthenticated({ reason: GATE }))
  .withOutput(z.object({ id: z.string(), userName: z.string() }))
  .handle(({ app, input }) => app.create(input))
  .build();

function mounted() {
  const closed = BearerIdentity.create({ name: "unconfigured", token: void 0 });
  const door: RestIdentity = {
    authenticate: () => {
      throw new Error("The directory door asks no permission.");
    },
    identify: async ({ request }) => {
      if (request.headers.get("authorization") !== AUTHORIZED.authorization) {
        throw new DoorRefusedError();
      }

      return {
        actor: { type: "api_key", id: "token-1" },
        scope: { tier: "organization", id: "org-1" },
      };
    },
  };

  const app = {
    create: vi.fn(async ({ userName }: { userName: string }) => ({ id: "user-1", userName })),
    refuse: vi.fn(async (): Promise<{ ok: boolean }> => {
      throw new ResourceTakenError();
    }),
    crash: vi.fn(async (): Promise<{ ok: boolean }> => {
      throw new Error("the store went away");
    }),
    remove: vi.fn(async () => {}),
  };

  const host = RestHost.create({
    identities: {
      project: closed,
      organization: closed,
      apiKey: closed,
      scimToken: door,
      "instance-admin": closed,
      browser: closed,
    },
    bearers: () => closed,
    audit: { record: async () => {} },
  });

  host.mount(directory.router(), () => app);

  return { host: host.app, app };
}

async function protocolDocument(response: Response) {
  expect(response.headers.get("content-type")).toBe(PROTOCOL);

  return JSON.parse(await response.text()) as unknown;
}

describe("a protocol route that declares how its protocol renders a refusal", () => {
  describe("when its door refuses the caller", () => {
    /** @scenario "A refusal raised at the door answers in the protocol's document" */
    it("answers the protocol's document at the door's status", async () => {
      const { host, app } = mounted();
      const response = await host.request("/directory/Users", {
        method: "POST",
        headers: { authorization: "Bearer bad", "content-type": PROTOCOL },
        body: JSON.stringify({ userName: "ada" }),
      });

      expect(response.status).toBe(401);
      expect(await protocolDocument(response)).toEqual({ status: "401", code: "door_refused" });
      expect(app.create).not.toHaveBeenCalled();
    });
  });

  describe("when the request cannot be parsed", () => {
    /** @scenario "A refusal raised while parsing the request answers in the protocol's document" */
    it("answers malformed JSON as the protocol's 400", async () => {
      const { host, app } = mounted();
      const response = await host.request("/directory/Users", {
        method: "POST",
        headers: { ...AUTHORIZED, "content-type": PROTOCOL },
        body: "{",
      });

      expect(response.status).toBe(400);
      expect(await protocolDocument(response)).toEqual({
        status: "400",
        code: "malformed_request",
      });
      expect(app.create).not.toHaveBeenCalled();
    });

    /** @scenario "A refusal raised while parsing the request answers in the protocol's document" */
    it("answers a body that misses the declared input as the protocol's document", async () => {
      const { host } = mounted();
      const response = await host.request("/directory/Users", {
        method: "POST",
        headers: { ...AUTHORIZED, "content-type": PROTOCOL },
        body: JSON.stringify({ displayName: "ada" }),
      });

      expect(response.status).toBe(422);
      expect(await protocolDocument(response)).toEqual({ status: "422", code: "validation_error" });
    });
  });

  describe("when its handler fails", () => {
    /** @scenario "A refusal the handler throws answers in the protocol's document" */
    it("answers a handled refusal at its own status", async () => {
      const { host } = mounted();
      const response = await host.request("/directory/refuse", { headers: AUTHORIZED });

      expect(response.status).toBe(409);
      expect(await protocolDocument(response)).toEqual({ status: "409", code: "resource_taken" });
    });

    /** @scenario "A refusal the handler throws answers in the protocol's document" */
    it("answers an unhandled failure with the document the renderer wrote for it", async () => {
      const { host } = mounted();
      const response = await host.request("/directory/crash", { headers: AUTHORIZED });

      expect(response.status).toBe(500);
      expect(await protocolDocument(response)).toEqual({ status: "500", code: "unhandled" });
    });
  });

  describe("when it answers with no content", () => {
    /** @scenario "A protocol answer with no content names no media type" */
    it("writes the 204 with no Content-Type", async () => {
      const { host } = mounted();
      const response = await host.request("/directory/Users/user-1", {
        method: "DELETE",
        headers: AUTHORIZED,
      });

      expect(response.status).toBe(204);
      expect(response.headers.has("content-type")).toBe(false);
      expect(await response.text()).toBe("");
    });
  });
});

describe("a route in the same family that declares no refusal renderer", () => {
  /** @scenario "A route that declares no refusal renderer keeps the family's boundary" */
  it("answers its door's refusal in the canonical envelope", async () => {
    const { host } = mounted();
    const response = await host.request("/directory/plain", {
      method: "POST",
      headers: { authorization: "Bearer bad", "content-type": "application/json" },
      body: JSON.stringify({ userName: "ada" }),
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toMatchObject({ code: "door_refused" });
  });

  /** @scenario "A route that declares no refusal renderer keeps the family's boundary" */
  it("answers malformed JSON as the canonical 400 malformed_request", async () => {
    const { host } = mounted();
    const response = await host.request("/directory/plain", {
      method: "POST",
      headers: { ...AUTHORIZED, "content-type": "application/json" },
      body: "{",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "malformed_request" });
  });
});
