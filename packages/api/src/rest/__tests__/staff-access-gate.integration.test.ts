/**
 * Every request by an approved staff agent's key passes the staff access gate after its
 * authorization and before its handler (ADR-202). The gate here is a recording double: what it
 * records and refuses is the staff-access module's business, and its own suite proves that.
 * @vitest-environment node
 * @see modules/staff-access/specs/staff-access-use.feature (bound end to end by staff-access)
 */
import type {
  RestResolvedOrganizationCredential,
  RestResolvedProjectCredential,
} from "@langwatch/authorization";
import { HandledError } from "@langwatch/handled-error";
import { moduleApi } from "@langwatch/module";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { authorizationPort } from "../../__tests__/api-double.ts";
import { StaffAccessRevokedError, StaffSpendNotApprovedError } from "../../errors.ts";
import type { RestAuditRow, RestCaller, RestIdentity } from "../../hosting/api-door.ts";
import { recordOrganizationCredential, recordProjectCredential } from "../credential.ts";
import { defineRestRouter } from "../declaration.ts";
import { canonicalErrorResponse } from "../response.ts";
import { createRestRuntime } from "../runtime.ts";
import type {
  RestStaffAccessGate,
  RestStaffAccessOutcome,
  RestStaffAccessRefusal,
  RestStaffAccessRequest,
} from "../staff-access.ts";

const VERSION = "2026-10-05";

class KeyPermissionDeniedError extends HandledError {
  constructor() {
    super("api_key_permission_denied", "denied", { httpStatus: 403 });
  }
}

class RunFailedError extends HandledError {
  constructor() {
    super("run_failed", "The run failed", { httpStatus: 409 });
  }
}

interface ItemsApi {
  list(): Promise<unknown>;
  run(): Promise<unknown>;
  search(): Promise<unknown>;
  remove(): Promise<unknown>;
  results(): Promise<unknown>;
}

const ItemsApi = moduleApi<ItemsApi>()("evaluator");

const PROJECT = { id: "project-1", slug: "p", teamId: "team-1" } as never;
const CALLER: RestCaller = {
  actor: { type: "api_key", id: "key" },
  scope: { tier: "project", id: "project-1" },
};

const KEYS: Record<string, RestResolvedProjectCredential> = {
  staff: {
    type: "apiKey",
    apiKeyId: "staff-key",
    userId: null,
    organizationId: "org-1",
    ingestSourceType: null,
    ingestionTemplateId: null,
    isStaffAccessKey: true,
    project: PROJECT,
  },
  customer: {
    type: "apiKey",
    apiKeyId: "customer-key",
    userId: null,
    organizationId: "org-1",
    ingestSourceType: null,
    ingestionTemplateId: null,
    project: PROJECT,
  },
};

/** Refuses any permission named here after recording the key, as the project door does. */
const REFUSED_PERMISSIONS = new Set(["secrets:view"]);

const door: RestIdentity = {
  authenticate: ({ request, permissions }) => {
    const token = request.headers.get("x-auth-token") ?? "";
    if (token === "unrecorded") return CALLER;
    const resolved = KEYS[token];
    if (!resolved) throw new Error("unknown test key");
    recordProjectCredential(request, resolved);
    if (permissions?.some((permission) => REFUSED_PERMISSIONS.has(permission))) {
      throw new KeyPermissionDeniedError();
    }
    return CALLER;
  },
};

const ORGANIZATION_STAFF_KEY: RestResolvedOrganizationCredential = {
  type: "apiKey-org",
  apiKeyId: "staff-org-key",
  userId: null,
  organizationId: "org-1",
  isStaffAccessKey: true,
};

const organizationDoor: RestIdentity = {
  authenticate: ({ request }) => {
    recordOrganizationCredential(request, ORGANIZATION_STAFF_KEY);
    return { actor: { type: "api_key", id: "key" }, scope: { tier: "organization", id: "org-1" } };
  },
};

const router = defineRestRouter(ItemsApi)
  .withNamespace("items")
  .withVersion(VERSION)
  .get("/", "list")
  .withPermission("prompts:view")
  .withOutput(z.object({ items: z.array(z.string()) }))
  .handle(async ({ app }) => {
    await app.list();
    return { items: ["a"] };
  })
  .post("/run", "run")
  .withAudit("items.run")
  .keepsRecords()
  .withPermission("evaluations:create")
  .spends()
  .withOutput(z.object({ started: z.boolean() }))
  .handle(async ({ app }) => {
    await app.run();
    return { started: true };
  })
  .post("/search", "search")
  .withoutAudit("read sent as a POST")
  .keepsRecords()
  .withPermission("traces:view")
  .withOutput(z.object({ items: z.array(z.string()) }))
  .handle(async ({ app }) => {
    await app.search();
    return { items: [] };
  })
  .post("/remove", "remove")
  .withAudit("items.remove")
  .withInput(z.object({ id: z.string() }))
  .withConfirmation({ resource: "item", action: "delete", idParam: "id", name: async () => null })
  .withPermission("evaluations:update")
  .withOutput(z.object({ removed: z.boolean() }))
  .handle(async ({ app }) => {
    await app.remove();
    return { removed: true };
  })
  .get("/results", "results")
  .withPermission("evaluations:view")
  .servesContent()
  .withOutput(z.object({ items: z.array(z.string()) }))
  .handle(async ({ app }) => {
    await app.results();
    return { items: [] };
  })
  .get("/secrets", "secrets")
  .withPermission("secrets:view")
  .withOutput(z.object({ items: z.array(z.string()) }))
  .handle(async ({ app }) => {
    await app.list();
    return { items: [] };
  })
  .get("/organization", "listOrganization")
  .withCredential("organization")
  .withPermission("organization:view")
  .withOutput(z.object({ items: z.array(z.string()) }))
  .handle(async ({ app }) => {
    await app.list();
    return { items: [] };
  })
  .build()
  .router();

let order: string[];
let admitted: RestStaffAccessRequest[];
let finished: RestStaffAccessOutcome[];
let audited: RestAuditRow[];
let refusals: RestStaffAccessRefusal[];

const STAFF = {
  principal: "LangWatch Support",
  approverUserId: "operator-1",
  reason: "ACME asked",
};
let runFails: boolean;

const app: ItemsApi = {
  search: async () => void order.push("handler"),
  remove: async () => void order.push("handler"),
  results: async () => void order.push("handler"),
  list: async () => void order.push("handler"),
  run: async () => {
    order.push("handler");
    if (runFails) throw new RunFailedError();
  },
};

/** Admits every request, or refuses the ones `refuse` names an error for. */
function recordingGate({
  refuse,
  finishFails = false,
}: {
  refuse?: (request: RestStaffAccessRequest) => Error | undefined;
  finishFails?: boolean;
} = {}): RestStaffAccessGate {
  return {
    admit: async (request) => {
      order.push("admit");
      admitted.push(request);
      const refusal = refuse?.(request);
      if (refusal) throw refusal;
      return {
        staff: STAFF,
        spendApproved: false,
        finish: async (outcome) => {
          order.push("finish");
          finished.push(outcome);
          if (finishFails) throw new Error("trail store down");
        },
      };
    },
    refused: async (refusal) => {
      order.push("refused");
      refusals.push(refusal);
    },
  };
}

async function call({
  gate,
  token = "staff",
  method = "GET",
  path = "/",
  body,
}: {
  gate: RestStaffAccessGate | undefined;
  token?: string;
  method?: string;
  path?: string;
  body?: unknown;
}) {
  const runtime = createRestRuntime({
    authorization: authorizationPort,
    identity: door,
    doors: { organization: organizationDoor },
    servedDoors: true,
    audit: {
      record: async (row) => {
        order.push("audit");
        audited.push(row);
      },
    },
    ...(gate ? { staffAccess: gate } : {}),
  }).mount(router, { app: () => app, onError: canonicalErrorResponse });
  const response = await runtime.request(`/api/items/${VERSION}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-auth-token": token,
      "user-agent": "langwatch-cli/1.0",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  return { status: response.status, body: (await response.json()) as { code?: string } };
}

beforeEach(() => {
  order = [];
  admitted = [];
  finished = [];
  audited = [];
  refusals = [];
  runFails = false;
});

describe("the staff access gate", () => {
  describe("given a key that is no staff key", () => {
    it("never asks the gate", async () => {
      const answer = await call({ gate: recordingGate(), token: "customer" });

      expect(answer.status).toBe(200);
      expect(order).toEqual(["handler"]);
    });

    it("runs with no gate bound", async () => {
      const answer = await call({ gate: undefined, token: "customer" });

      expect(answer.status).toBe(200);
      expect(order).toEqual(["handler"]);
    });
  });

  describe("given a door that recorded no key", () => {
    it("refuses rather than run a key it cannot tell apart, when a gate is bound", async () => {
      const answer = await call({ gate: recordingGate(), token: "unrecorded" });

      expect(answer.status).toBe(500);
      expect(order).toEqual([]);
    });

    it("runs with no gate bound, where no staff key can be served anyway", async () => {
      const answer = await call({ gate: undefined, token: "unrecorded" });

      expect(answer.status).toBe(200);
      expect(order).toEqual(["handler"]);
    });
  });

  describe("given a staff key", () => {
    it("admits before the handler and finishes after it, with the route and the caller", async () => {
      const answer = await call({ gate: recordingGate() });

      expect(answer.status).toBe(200);
      expect(order).toEqual(["admit", "handler", "finish"]);
      expect(admitted).toEqual([
        {
          apiKeyId: "staff-key",
          method: "GET",
          path: `/api/items/${VERSION}/`,
          operation: "items.list",
          permissions: ["prompts:view"],
          scope: { tier: "project", id: "project-1" },
          spends: false,
          writes: false,
          confirms: false,
          servesContent: false,
          ipAddress: null,
          userAgent: "langwatch-cli/1.0",
        },
      ]);
      expect(finished).toEqual([{ status: 200, errorCode: null, durationMs: expect.any(Number) }]);
    });

    it("tells the gate the route spends on a route marked as starting a run", async () => {
      await call({ gate: recordingGate(), method: "POST", path: "/run" });

      expect(order).toEqual(["admit", "handler", "audit", "finish"]);
      expect(admitted.map(({ operation, spends }) => ({ operation, spends }))).toEqual([
        { operation: "items.run", spends: true },
      ]);
    });

    it("names the approved staff access on the route's audit row", async () => {
      await call({ gate: recordingGate(), method: "POST", path: "/run" });

      expect(audited).toEqual([
        expect.objectContaining({ action: "items.run", staffAccess: STAFF }),
      ]);
    });

    it("refuses with the gate's error and never runs the handler", async () => {
      const gate = recordingGate({
        refuse: (request) => (request.spends ? new StaffSpendNotApprovedError() : undefined),
      });

      const answer = await call({ gate, method: "POST", path: "/run" });

      expect(answer).toMatchObject({ status: 403, body: { code: "staff_spend_not_approved" } });
      expect(order).toEqual(["admit"]);
    });

    it("refuses a revoked key before its handler", async () => {
      const gate = recordingGate({ refuse: () => new StaffAccessRevokedError() });

      const answer = await call({ gate });

      expect(answer).toMatchObject({ status: 403, body: { code: "staff_access_revoked" } });
      expect(order).toEqual(["admit"]);
    });

    it("refuses with staff_access_unavailable when no gate is bound", async () => {
      const answer = await call({ gate: undefined });

      expect(answer).toMatchObject({ status: 403, body: { code: "staff_access_unavailable" } });
      expect(order).toEqual([]);
    });

    it("finishes with the route's own refusal, which still reaches the caller", async () => {
      runFails = true;

      const answer = await call({ gate: recordingGate(), method: "POST", path: "/run" });

      expect(answer).toMatchObject({ status: 409, body: { code: "run_failed" } });
      expect(finished).toEqual([
        { status: 409, errorCode: "run_failed", durationMs: expect.any(Number) },
      ]);
    });

    it("answers the route when finishing fails", async () => {
      const answer = await call({ gate: recordingGate({ finishFails: true }) });

      expect(answer.status).toBe(200);
      expect(order).toEqual(["admit", "handler", "finish"]);
    });

    /** @scenario "The customer's log tells reads from writes by the route's declared kind" */
    it("tells the gate a POST is a write, and a declared read sent as a POST is not", async () => {
      await call({ gate: recordingGate(), method: "POST", path: "/run" });
      await call({ gate: recordingGate(), method: "POST", path: "/search" });

      expect(admitted.map(({ operation, writes }) => ({ operation, writes }))).toEqual([
        { operation: "items.run", writes: true },
        { operation: "items.search", writes: false },
      ]);
    });

    it("tells the gate a route asks a confirmation or serves content", async () => {
      await call({
        gate: recordingGate(),
        method: "POST",
        path: "/remove",
        body: { id: "item-1" },
      });
      await call({ gate: recordingGate(), path: "/results" });

      expect(
        admitted.map(({ operation, confirms, servesContent }) => ({
          operation,
          confirms,
          servesContent,
        })),
      ).toEqual([
        { operation: "items.remove", confirms: true, servesContent: false },
        { operation: "items.results", confirms: false, servesContent: true },
      ]);
    });

    /** @scenario "Refused staff calls leave a trail row" */
    it("reports a refusal before the gate, so the trail holds it, and still answers it", async () => {
      const answer = await call({ gate: recordingGate(), path: "/secrets" });

      expect(answer).toMatchObject({ status: 403, body: { code: "api_key_permission_denied" } });
      expect(order).toEqual(["refused"]);
      expect(refusals).toMatchObject([
        {
          apiKeyId: "staff-key",
          operation: "items.secrets",
          permissions: ["secrets:view"],
          status: 403,
          errorCode: "api_key_permission_denied",
        },
      ]);
    });

    it("reports no refusal for a key that is no staff key", async () => {
      await call({ gate: recordingGate(), token: "customer", path: "/secrets" });

      expect(refusals).toEqual([]);
    });

    it("asks the gate at the organization door too", async () => {
      const answer = await call({ gate: recordingGate(), path: "/organization" });

      expect(answer.status).toBe(200);
      expect(admitted).toMatchObject([
        { apiKeyId: "staff-org-key", scope: { tier: "organization", id: "org-1" } },
      ]);
    });
  });
});

describe("the staff access credential", () => {
  /** An ops token door: "ops" holds `opsRead:view`, "org" is a token approved without it. */
  const staffDoor: RestIdentity = {
    authenticate: () => {
      throw new Error("the staff access door asks no permission of the caller it identifies");
    },
    identify: ({ request }) => {
      const token = request.headers.get("authorization");
      if (token !== "Bearer ops" && token !== "Bearer org") throw new StaffAccessRevokedError();
      return { actor: null, scope: null, session: { token } };
    },
    authorizePlatform: ({ caller, permission }) => ({
      permitted:
        permission === "opsRead:view" &&
        (caller.session as { token: string }).token === "Bearer ops",
    }),
  };

  const opsRouter = defineRestRouter(ItemsApi)
    .withNamespace("staff-ops")
    .withVersion(VERSION)
    .withCredential("staff_access")
    .get("/organizations", "list")
    .withPermission("opsRead:view", { at: "platform" })
    .withOutput(z.object({ items: z.array(z.string()) }))
    .handle(async ({ app }) => {
      await app.list();
      return { items: ["acme"] };
    })
    .build()
    .router();

  async function callOps(token: string) {
    const runtime = createRestRuntime({
      authorization: authorizationPort,
      identity: staffDoor,
      doors: { staff_access: staffDoor },
      servedDoors: true,
    }).mount(opsRouter, { app: () => app, onError: canonicalErrorResponse });
    const response = await runtime.request(`/api/staff-ops/${VERSION}/organizations`, {
      headers: { authorization: token },
    });

    return { status: response.status, body: (await response.json()) as { code?: string } };
  }

  it("serves a platform route to a token its door says holds opsRead:view", async () => {
    const answer = await callOps("Bearer ops");

    expect(answer.status).toBe(200);
    expect(order).toEqual(["handler"]);
  });

  it("refuses a token its door says lacks opsRead:view, before the handler", async () => {
    const answer = await callOps("Bearer org");

    expect(answer.status).toBe(403);
    expect(order).toEqual([]);
  });

  it("refuses a mount whose staff access door cannot answer the platform question", () => {
    const { authorizePlatform: _unanswered, ...blind } = staffDoor;

    expect(() =>
      createRestRuntime({
        authorization: authorizationPort,
        identity: blind,
        doors: { staff_access: blind },
      }).mount(opsRouter, { app: () => app, onError: canonicalErrorResponse }),
    ).toThrow(/authorizePlatform/);
  });
});
