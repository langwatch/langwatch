/**
 * Credential, then body, then what the body names (ARCHITECTURE.md §8, Alex, 2026-09-30): a public
 * route's credential fact refuses before its body is validated; a fact reading the parsed input
 * resolves after it. Spec: packages/api/specs/transport-conventions.feature.
 */

import { createApiFixture } from "@langwatch/api-fixture";
import { HandledError } from "@langwatch/handled-error";
import { moduleApi } from "@langwatch/module";
import type { Context } from "hono";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { publicRoute } from "../../access/access.ts";
import { createErrorHandler } from "../../errors.ts";
import { defineRestRouter } from "../declaration.ts";
import { bindRestMiddleware, defineRestMiddleware } from "../request.ts";
import { createRestRuntime } from "../runtime.ts";

interface DeskApi {
  open(input: { title: string; staff: string }): Promise<{ id: string }>;
}

const DeskApi = moduleApi<DeskApi>()("ops");

/** A hidden surface's refusal: a caller who is not staff learns nothing. */
class HiddenError extends HandledError {
  constructor() {
    super("not_found", "Not found", { httpStatus: 404, fault: "customer" });
  }
}

const staff = defineRestMiddleware("staff", z.string());
const title = defineRestMiddleware("title", z.object({ title: z.string() }), { source: "input" });

const desk = defineRestRouter(DeskApi)
  .withNamespace("desk")
  .withVersion("2026-09-30")
  .withAddressing("literal", { v1Twin: false })

  .post("/api/desk", "openDesk")
  .withInput(z.object({ title: z.string().min(1) }))
  .withAccess(publicRoute({ reason: "staff is resolved by the route's own fact" }))
  .withOutput(z.object({ id: z.string() }))
  .withMiddleware(staff)
  .handle(async ({ app, input }, who) => app.open({ title: input.title, staff: who }))

  .post("/api/desk/echo", "echoDesk")
  .withInput(z.object({ title: z.string().min(1) }))
  .withAccess(publicRoute({ reason: "the fact reads the parsed body" }))
  .withOutput(z.object({ id: z.string() }))
  .withMiddleware(title)
  .handle(async ({ app }, parsed) => app.open({ title: parsed.title, staff: "nobody" }))
  .build();

function deskApp() {
  const open = vi.fn(async ({ title, staff }: { title: string; staff: string }) => ({
    id: `${staff}:${title}`,
  }));
  const readTitle = vi.fn((context: Context) => context.req.valid("json" as never));

  const hono = createRestRuntime({
    identity: { authenticate: () => Promise.reject(new Error("public routes open no door")) },
  }).mount(desk.router(), {
    app: () => createApiFixture<DeskApi>({ open }),
    onError: createErrorHandler(),
    facts: [
      bindRestMiddleware(staff, (context) => {
        const who = context.req.header("X-Staff");
        if (!who) throw new HiddenError();

        return who;
      }),
      bindRestMiddleware(title, readTitle),
    ],
  });

  return { hono, open, readTitle };
}

function post(body: string, headers: Record<string, string> = {}): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body };
}

describe("a public route's credential fact", () => {
  /** @scenario "A public route's credential fact refuses before the body is validated" */
  it("answers a caller it refuses with its 404, not the 422 the body earned", async () => {
    const { hono, open } = deskApp();

    const response = await hono.request("/api/desk", post(JSON.stringify({ title: "" })));

    expect(response.status).toBe(404);
    expect(open).not.toHaveBeenCalled();
  });

  /** @scenario "A public route's credential fact refuses before the body is validated" */
  it("answers a caller it admits 422 for the same body", async () => {
    const { hono, open } = deskApp();

    const response = await hono.request(
      "/api/desk",
      post(JSON.stringify({ title: "" }), { "X-Staff": "ada" }),
    );

    expect(response.status).toBe(422);
    expect(open).not.toHaveBeenCalled();
  });

  /** @scenario "A public route's credential fact refuses before the body is validated" */
  it("hands an admitted caller with a valid body to the handler, resolving the fact once", async () => {
    const { hono, open } = deskApp();

    const response = await hono.request(
      "/api/desk",
      post(JSON.stringify({ title: "rota" }), { "X-Staff": "ada" }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: "ada:rota" });
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe("a fact that reads the parsed input", () => {
  /** @scenario "A fact that reads the parsed input resolves after the body is validated" */
  it("sees the validated body", async () => {
    const response = await deskApp().hono.request(
      "/api/desk/echo",
      post(JSON.stringify({ title: "rota" })),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: "nobody:rota" });
  });

  /** @scenario "A fact that reads the parsed input resolves after the body is validated" */
  it("is not reached by a body that fails its schema", async () => {
    const { hono, readTitle } = deskApp();

    const response = await hono.request("/api/desk/echo", post(JSON.stringify({ title: "" })));

    expect(response.status).toBe(422);
    expect(readTitle).not.toHaveBeenCalled();
  });
});
