/**
 * `/api/admin/*` answers main's hidden 404 to anyone not on the staff list before its body is
 * read (ARCHITECTURE.md §8, Alex, 2026-09-30): the `adminActor` binding refuses.
 */

import { createServer } from "node:http";

import { RawHttpHost, WebSocketHost } from "@langwatch/api";
import { publicRoute } from "@langwatch/api/access";
import { type NodeHandler, TransportSelection } from "@langwatch/api/hosting";
import { defineRestMiddleware, defineRestRouter } from "@langwatch/api/rest";
import { moduleApi } from "@langwatch/module";
import { createLogger } from "@langwatch/observability";
import { OpsApi } from "@langwatch/ops-contract";
import type { ProcessMemberSource } from "@langwatch/process-stores";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { inertApiDoor, peersWithDoor } from "../../__tests__/support/api-door.ts";
import { apiSurface, bearerDoor } from "../api-surface.ts";

const STAFF_EMAIL = "staff@example.com";
const users = new Map([
  ["staff", { id: "user-staff", email: STAFF_EMAIL }],
  ["customer", { id: "user-customer", email: "customer@example.com" }],
]);

function userOf(headers: Headers) {
  const token = /session=(\w+)/.exec(headers.get("cookie") ?? "")?.[1];
  return token ? users.get(token) : undefined;
}

/** auth's door, reading the session these tests' cookies name. */
const door = inertApiDoor({
  sessions: async (request) => {
    const user = userOf(request.headers);
    return user
      ? { authSessionId: "s-1", sessionId: "live-1", userId: user.id, email: user.email }
      : null;
  },
});

const ops = {
  operatorScope: (operator: { email?: string | null } | null) =>
    operator?.email === STAFF_EMAIL ? { kind: "platform" as const } : { kind: "none" as const },
};

const peers = new Map<unknown, unknown>([[OpsApi, ops]]);

const members: ProcessMemberSource = {
  order: [],
  read: (name) => {
    throw new Error(`the admin door reads no ${name}`);
  },
  close: () => Promise.resolve(),
  [Symbol.asyncDispose]: () => Promise.resolve(),
};

interface DeskApi {
  run(input: { reason: string; actor: unknown }): Promise<{ ok: true }>;
  audited(input: { req: unknown }): Promise<{ ok: true }>;
}
const DeskApi = moduleApi<DeskApi>()("ops");
const adminActor = defineRestMiddleware("adminActor", z.object({ id: z.string() }).nullable());
const adminAuditRequest = defineRestMiddleware(
  "adminAuditRequest",
  z.object({ headers: z.record(z.string(), z.string()), remoteAddress: z.string().optional() }),
);
const run = vi.fn(async () => ({ ok: true as const }));
const audited = vi.fn(async () => ({ ok: true as const }));

const desk = defineRestRouter(DeskApi)
  .withNamespace("admin")
  .withVersion("2026-09-30")
  .withAddressing("literal", { v1Twin: false })
  .post("/api/admin/desk", "runAdminDesk")
  .withInput(z.object({ reason: z.string().min(1) }))
  .withAccess(publicRoute({ reason: "staff is resolved by the adminActor fact" }))
  .withOutput(z.object({ ok: z.literal(true) }))
  .withMiddleware(adminActor)
  .handle(async ({ app, input }, actor) => app.run({ reason: input.reason, actor }))

  .post("/api/admin/audited", "runAuditedAdminDesk")
  .withInput(z.object({}))
  .withAccess(publicRoute({ reason: "staff is resolved by the adminActor fact" }))
  .withOutput(z.object({ ok: z.literal(true) }))
  .withMiddleware(adminActor, adminAuditRequest)
  .handle(async ({ app }, _actor, req) => app.audited({ req }))
  .build();

const surface = apiSurface({
  members,
  logger: createLogger("process-server:admin-actor-hidden-test"),
  stores: { database: false, redis: false },
  bundle: void 0,
  storage: {},
  internalBearers: new Map(),
  instanceAdmin: bearerDoor({ name: "instance-admin", token: void 0 }),
  trustedProxies: void 0,
  executionProxyBaseUrl: void 0,
  publicBaseUrl: void 0,
  production: false,
  selection: TransportSelection.create().rest().browserBundle(false),
  sockets: WebSocketHost.create(),
  doors: RawHttpHost.create(),
})(peersWithDoor({ resolve: (token) => peers.get(token), door }));
const rest = surface.hosts.rest;
if (!rest) throw new Error("the surface selected REST");
rest.mount(desk.router(), () => ({ run, audited }));

const handler = surface.serve();
if (!isNodeHandler(handler)) throw new Error("the api surface composed no handler");
const server = createServer(handler);
let origin = "";

beforeAll(async () => {
  await new Promise<void>((listening) => server.listen(0, "127.0.0.1", listening));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("the test server has no port");
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(() => new Promise<void>((closed) => server.close(() => closed())));

function post(body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${origin}/api/admin/desk`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("the admin family's adminActor binding", () => {
  it("answers 404, not 422, to a request with no session and a bad body", async () => {
    run.mockClear();
    expect((await post({ reason: "" })).status).toBe(404);
    expect(run).not.toHaveBeenCalled();
  });

  it("answers 404, not 422, to a signed-in customer with a bad body", async () => {
    run.mockClear();
    expect((await post({ reason: "" }, { cookie: "session=customer" })).status).toBe(404);
    expect(run).not.toHaveBeenCalled();
  });

  it("answers 422 to staff with a bad body", async () => {
    run.mockClear();
    expect((await post({ reason: "" }, { cookie: "session=staff" })).status).toBe(422);
    expect(run).not.toHaveBeenCalled();
  });

  it("hands staff with a valid body to the handler, as the acting operator", async () => {
    run.mockClear();
    expect((await post({ reason: "support" }, { cookie: "session=staff" })).status).toBe(200);
    expect(run).toHaveBeenCalledWith({
      reason: "support",
      actor: expect.objectContaining({ id: "user-staff" }),
    });
  });
});

describe("the admin family's adminAuditRequest binding", () => {
  it("hands the handler the caller's address and headers for the audit entry", async () => {
    audited.mockClear();
    const response = await fetch(`${origin}/api/admin/audited`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "audit-test",
        cookie: "session=staff",
      },
      body: "{}",
    });

    expect(response.status).toBe(200);
    expect(audited).toHaveBeenCalledWith({
      req: {
        headers: expect.objectContaining({ "user-agent": "audit-test" }),
        remoteAddress: expect.stringContaining("127.0.0.1"),
      },
    });
  });
});

function isNodeHandler(value: unknown): value is NodeHandler {
  return typeof value === "function";
}
