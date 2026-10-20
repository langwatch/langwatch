/**
 * A route marked as removing something asks the confirmation gate before its handler runs, for a
 * Langy session key only. The gate here is a recording double: what it keeps is the Langy
 * module's business, and its own suite proves that.
 * @vitest-environment node
 * @see specs/langy/langy-delete-confirmation.feature
 */
import type {
  RestKeyDoorPrincipal,
  RestResolvedOrganizationCredential,
  RestResolvedProjectCredential,
} from "@langwatch/authorization";
import { moduleApi } from "@langwatch/module";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { authorizationPort } from "../../__tests__/api-double.ts";
import { ConfirmationRequiredError } from "../../errors.ts";
import type { RestCaller, RestIdentity } from "../../hosting/api-door.ts";
import type { RestConfirmationGate, RestConfirmationRequest } from "../confirmation.ts";
import {
  recordKeyCredential,
  recordOrganizationCredential,
  recordProjectCredential,
} from "../credential.ts";
import { defineRestRouter } from "../declaration.ts";
import { canonicalErrorResponse } from "../response.ts";
import { createRestRuntime } from "../runtime.ts";

const VERSION = "2026-10-05";

interface RecordsApi {
  remove(input: unknown): Promise<unknown>;
  removeMany(input: unknown): Promise<unknown>;
  toggle(input: unknown): Promise<unknown>;
  nameOf(id: string): Promise<string | null>;
}

const RecordsApi = moduleApi<RecordsApi>()("evaluator");

const PROJECT = { id: "project-1", slug: "p", teamId: "team-1" } as never;
const CALLER: RestCaller = {
  actor: { type: "api_key", id: "key" },
  scope: { tier: "project", id: "project-1" },
};

const KEYS: Record<string, RestResolvedProjectCredential> = {
  langy: {
    type: "apiKey",
    apiKeyId: "langy-key",
    userId: "user-1",
    organizationId: "org-1",
    ingestSourceType: null,
    ingestionTemplateId: null,
    isLangySessionKey: true,
    project: PROJECT,
  },
  personal: {
    type: "apiKey",
    apiKeyId: "personal-key",
    userId: "user-1",
    organizationId: "org-1",
    ingestSourceType: null,
    ingestionTemplateId: null,
    project: PROJECT,
  },
};

const door: RestIdentity = {
  authenticate: ({ request }) => {
    const resolved = KEYS[request.headers.get("x-auth-token") ?? ""];
    if (!resolved) throw new Error("unknown test key");
    recordProjectCredential(request, resolved);
    return CALLER;
  },
};

/** What the key door resolves per token: "silent" stands for a door that records nothing. */
const KEY_DOOR_KEYS: Record<string, RestKeyDoorPrincipal | null> = {
  langy: {
    kind: "apiKey",
    apiKeyId: "langy-key",
    userId: "user-1",
    organizationId: "org-1",
    resolvedProject: { id: "project-1", teamId: "team-1" },
    isLangySessionKey: true,
  },
  personal: {
    kind: "apiKey",
    apiKeyId: "personal-key",
    userId: "user-1",
    organizationId: "org-1",
    resolvedProject: { id: "project-1", teamId: "team-1" },
  },
  silent: null,
};

const keyDoor: RestIdentity = {
  authenticate: ({ request }) => {
    const token = request.headers.get("x-auth-token") ?? "";
    const principal = KEY_DOOR_KEYS[token];
    if (principal === undefined) throw new Error("unknown test key");
    if (principal) recordKeyCredential(request, principal);
    return { actor: { type: "api_key", id: "key" }, scope: { tier: "organization", id: "org-1" } };
  },
};

const ORGANIZATION_LANGY_KEY: RestResolvedOrganizationCredential = {
  type: "apiKey-org",
  apiKeyId: "langy-key",
  userId: "user-1",
  organizationId: "org-1",
  isLangySessionKey: true,
};

const organizationDoor: RestIdentity = {
  authenticate: ({ request }) => {
    recordOrganizationCredential(request, ORGANIZATION_LANGY_KEY);
    return { actor: { type: "api_key", id: "key" }, scope: { tier: "organization", id: "org-1" } };
  },
};

const router = defineRestRouter(RecordsApi)
  .withNamespace("records")
  .withVersion(VERSION)
  .delete("/:id", "remove")
  .withAudit("records.delete")
  .withParams(z.object({ id: z.string() }))
  .withPermission("evaluations:manage")
  .withConfirmation({
    resource: "evaluator",
    action: "delete",
    idParam: "id",
    name: ({ app, id }) => app.nameOf(id),
  })
  .withOutput(z.object({ removed: z.string() }))
  .handle(async ({ app, input }) => {
    await app.remove(input);
    return { removed: input.id };
  })
  .post("/bulk-delete", "removeMany")
  .withAudit("records.deleteMany")
  .withInput(z.object({ ids: z.array(z.string()) }))
  .withPermission("evaluations:manage")
  .withConfirmation({
    resource: "dataset row",
    action: "delete",
    idsField: "ids",
    name: ({ app, id }) => app.nameOf(id),
  })
  .withOutput(z.object({ removed: z.number() }))
  .handle(async ({ app, input }) => {
    await app.removeMany(input);
    return { removed: input.ids.length };
  })
  .post("/:id/toggle", "toggle")
  .withAudit("records.toggle")
  .withParams(z.object({ id: z.string() }))
  .withInput(z.object({ enabled: z.boolean() }))
  .withPermission("evaluations:update")
  .withConfirmation({
    resource: "monitor",
    action: "disable",
    idParam: "id",
    when: (input) => input.enabled === false,
    name: ({ app, id }) => app.nameOf(id),
  })
  .withOutput(z.object({ enabled: z.boolean() }))
  .handle(async ({ app, input }) => {
    await app.toggle(input);
    return { enabled: input.enabled };
  })
  .post("/:id/revoke", "revokeOne")
  .withAudit("records.revoke")
  .withCredential("api_key")
  .withParams(z.object({ id: z.string() }))
  .withPermission("virtualKeys:delete", { at: "grants" })
  .withConfirmation({
    resource: "virtual key",
    action: "revoke",
    idParam: "id",
    name: ({ app, id }) => app.nameOf(id),
  })
  .withOutput(z.object({ removed: z.string() }))
  .handle(async ({ app, input }) => {
    await app.remove(input);
    return { removed: input.id };
  })
  .post("/:id/archive", "archiveOne")
  .withAudit("records.archive")
  .withCredential("organization")
  .withParams(z.object({ id: z.string() }))
  .withPermission("evaluations:manage")
  .withConfirmation({
    resource: "evaluator",
    action: "archive",
    idParam: "id",
    name: ({ app, id }) => app.nameOf(id),
  })
  .withOutput(z.object({ removed: z.string() }))
  .handle(async ({ app, input }) => {
    await app.remove(input);
    return { removed: input.id };
  })
  .build()
  .router();

let ran: string[];
let asked: { request: RestConfirmationRequest; names: (string | null | undefined)[] }[];

const app: RecordsApi = {
  remove: async () => void ran.push("remove"),
  removeMany: async () => void ran.push("removeMany"),
  toggle: async () => void ran.push("toggle"),
  nameOf: async (id) => `Record ${id}`,
};

/** A gate holding a click for exactly the ids in `confirmed`; it reads every name it is shown. */
function gateFor(confirmed: readonly string[]): RestConfirmationGate {
  return {
    confirm: async (request) => {
      const names = await Promise.all(request.targets.map((target) => target.name()));
      asked.push({ request, names });
      if (request.targets.every((target) => confirmed.includes(target.id))) return;
      throw new ConfirmationRequiredError({
        message: "Deleting needs a confirmation click.",
        resource: request.resource,
        action: request.action,
      });
    },
  };
}

function mount(gate: RestConfirmationGate | undefined) {
  return createRestRuntime({
    authorization: authorizationPort,
    identity: door,
    doors: { api_key: keyDoor, organization: organizationDoor },
    audit: { record: async () => {} },
    ...(gate ? { confirmations: gate } : {}),
    // The envelope every REST family answers with, so the refusal reads as Langy reads it.
  }).mount(router, { app: () => app, onError: canonicalErrorResponse });
}

async function call({
  gate,
  token,
  method,
  path,
  body,
}: {
  gate: RestConfirmationGate | undefined;
  token: string;
  method: string;
  path: string;
  body?: unknown;
}) {
  const response = await mount(gate).request(`/api/records/${VERSION}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-auth-token": token },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return {
    status: response.status,
    body: (await response.json()) as { code?: string; message?: string },
  };
}

beforeEach(() => {
  ran = [];
  asked = [];
});

describe("a route marked as removing something", () => {
  describe("when a Langy session key calls it with no click", () => {
    it("refuses with langy_confirmation_required before the handler runs", async () => {
      const answer = await call({
        gate: gateFor([]),
        token: "langy",
        method: "DELETE",
        path: "/ev-1",
      });

      expect(answer).toMatchObject({ status: 409, body: { code: "langy_confirmation_required" } });
      expect(ran).toEqual([]);
      expect(asked).toEqual([
        {
          request: expect.objectContaining({
            apiKeyId: "langy-key",
            ownerUserId: "user-1",
            projectId: "project-1",
            resource: "evaluator",
            action: "delete",
          }),
          names: ["Record ev-1"],
        },
      ]);
    });
  });

  describe("when the gate holds a click for the record", () => {
    it("runs the handler", async () => {
      const answer = await call({
        gate: gateFor(["ev-1"]),
        token: "langy",
        method: "DELETE",
        path: "/ev-1",
      });

      expect(answer).toMatchObject({ status: 200, body: { removed: "ev-1" } });
      expect(ran).toEqual(["remove"]);
    });
  });

  describe("when a person's own API key calls it", () => {
    /** @scenario "Other keys are not asked for a click" */
    it("runs without asking the gate", async () => {
      const answer = await call({
        gate: gateFor([]),
        token: "personal",
        method: "DELETE",
        path: "/ev-1",
      });

      expect(answer.status).toBe(200);
      expect(ran).toEqual(["remove"]);
      expect(asked).toEqual([]);
    });
  });

  describe("when no module bound a gate", () => {
    it("refuses a Langy key rather than run unconfirmed", async () => {
      const answer = await call({ gate: undefined, token: "langy", method: "DELETE", path: "/x" });

      expect(answer).toMatchObject({ status: 409, body: { code: "langy_confirmation_required" } });
      expect(ran).toEqual([]);
    });
  });

  describe("when a bulk route names several ids", () => {
    it("asks the gate about every id at once and runs only when all hold a click", async () => {
      const refused = await call({
        gate: gateFor(["row-1"]),
        token: "langy",
        method: "POST",
        path: "/bulk-delete",
        body: { ids: ["row-1", "row-2", "row-1"] },
      });

      expect(refused.status).toBe(409);
      expect(asked[0]?.request.targets.map((target) => target.id)).toEqual(["row-1", "row-2"]);
      expect(ran).toEqual([]);

      const allowed = await call({
        gate: gateFor(["row-1", "row-2"]),
        token: "langy",
        method: "POST",
        path: "/bulk-delete",
        body: { ids: ["row-1", "row-2"] },
      });
      expect(allowed.status).toBe(200);
      expect(ran).toEqual(["removeMany"]);
    });
  });

  describe("when a bulk route names more ids than one request may ask clicks for", () => {
    /** @scenario "A request naming more than ten items is refused with no card" */
    it("refuses in plain words, asking for batches of ten, and never asks the gate", async () => {
      const ids = Array.from({ length: 11 }, (_, index) => `row-${index}`);

      const answer = await call({
        gate: gateFor(ids),
        token: "langy",
        method: "POST",
        path: "/bulk-delete",
        body: { ids },
      });

      expect(answer).toMatchObject({ status: 409, body: { code: "langy_confirmation_required" } });
      expect(answer.body.message).toContain("batches of 10");
      expect(asked).toEqual([]);
      expect(ran).toEqual([]);
    });

    it("still asks the gate for exactly ten", async () => {
      const ids = Array.from({ length: 10 }, (_, index) => `row-${index}`);

      const answer = await call({
        gate: gateFor(ids),
        token: "langy",
        method: "POST",
        path: "/bulk-delete",
        body: { ids },
      });

      expect(answer.status).toBe(200);
      expect(asked).toHaveLength(1);
    });
  });

  describe("when a Langy key comes in through the key door", () => {
    /** @scenario "A Langy key needs the click on every door that lets a key in" */
    it("asks the gate in the project the key belongs to", async () => {
      const answer = await call({
        gate: gateFor([]),
        token: "langy",
        method: "POST",
        path: "/vk-1/revoke",
      });

      expect(answer).toMatchObject({ status: 409, body: { code: "langy_confirmation_required" } });
      expect(ran).toEqual([]);
      expect(asked.map(({ request }) => [request.apiKeyId, request.projectId])).toEqual([
        ["langy-key", "project-1"],
      ]);
    });

    it("lets a person's own key through without asking", async () => {
      const answer = await call({
        gate: gateFor([]),
        token: "personal",
        method: "POST",
        path: "/vk-1/revoke",
      });

      expect(answer.status).toBe(200);
      expect(asked).toEqual([]);
    });

    it("refuses when the door recorded no key, rather than run unasked", async () => {
      const answer = await call({
        gate: gateFor([]),
        token: "silent",
        method: "POST",
        path: "/vk-1/revoke",
      });

      expect(answer.status).toBe(500);
      expect(ran).toEqual([]);
    });
  });

  describe("when a Langy key comes in through the organization door", () => {
    /** @scenario "A Langy key needs the click on every door that lets a key in" */
    it("refuses, since no project names where a card could show", async () => {
      const answer = await call({
        gate: gateFor(["ev-1"]),
        token: "langy",
        method: "POST",
        path: "/ev-1/archive",
      });

      expect(answer).toMatchObject({ status: 409, body: { code: "langy_confirmation_required" } });
      expect(ran).toEqual([]);
    });
  });

  describe("when a toggle only sometimes disables", () => {
    it("asks only for the call that disables", async () => {
      const enabling = await call({
        gate: gateFor([]),
        token: "langy",
        method: "POST",
        path: "/mon-1/toggle",
        body: { enabled: true },
      });
      const disabling = await call({
        gate: gateFor([]),
        token: "langy",
        method: "POST",
        path: "/mon-1/toggle",
        body: { enabled: false },
      });

      expect([enabling.status, disabling.status]).toEqual([200, 409]);
      expect(asked.map(({ request }) => request.action)).toEqual(["disable"]);
    });
  });
});

describe("declaring the mark", () => {
  /** @scenario "Every route that removes or disables something asks for the click" */
  it("refuses a DELETE route, or one whose audit names a removal, that says nothing", () => {
    const family = () => defineRestRouter(RecordsApi).withNamespace("bad").withVersion(VERSION);

    expect(() =>
      family()
        .delete("/:id", "remove")
        .withAudit("records.delete")
        .withParams(z.object({ id: z.string() }))
        .withPermission("evaluations:manage")
        .withOutput(z.object({ removed: z.string() }))
        .handle(async ({ input }) => ({ removed: input.id })),
    ).toThrow(/removes or disables a record/);
    expect(() =>
      family()
        .post("/purge", "removeMany")
        .withAudit("records.purge")
        .withInput(z.object({ ids: z.array(z.string()) }))
        .withPermission("evaluations:manage")
        .withOutput(z.object({ removed: z.number() }))
        .handle(async ({ input }) => ({ removed: input.ids.length })),
    ).toThrow(/removes or disables a record/);
    expect(() =>
      family()
        .delete("/:id", "remove")
        .withAudit("records.delete")
        .withoutConfirmation("a Langy key cannot pass this door")
        .withParams(z.object({ id: z.string() }))
        .withPermission("evaluations:manage")
        .withOutput(z.object({ removed: z.string() }))
        .handle(async ({ input }) => ({ removed: input.id })),
    ).not.toThrow();
  });

  it("refuses a mark that names no id, or both", () => {
    const route = () =>
      defineRestRouter(RecordsApi)
        .withNamespace("bad")
        .withVersion(VERSION)
        .delete("/:id", "remove");

    expect(() =>
      route().withConfirmation({ resource: "evaluator", action: "delete", name: async () => null }),
    ).toThrow(/exactly one of idParam and idsField/);
    expect(() =>
      route().withConfirmation({
        resource: "evaluator",
        action: "delete",
        idParam: "id",
        idsField: "ids",
        name: async () => null,
      }),
    ).toThrow(/exactly one of idParam and idsField/);
  });
});
