import { HandledError } from "@langwatch/handled-error";
import { moduleApi } from "@langwatch/kernel";
import type { ErrorHandler } from "hono";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { RateLimitedError } from "../../errors.ts";
import { defineRestRouter } from "../declaration.ts";
import { canonicalErrorFor, canonicalErrorResponse } from "../response.ts";
import { createRestRuntime } from "../runtime.ts";

// ARCHITECTURE.md §8 (2026-09-23): an absent body reads as `{}`, and a handled refusal's
// `meta.retryAfterMs` is rendered as `Retry-After`.

const VERSION = "2026-09-08";
const BASE = `/api/annotations/${VERSION}`;
const JSON_TYPE = { "Content-Type": "application/json" };

class ProviderBusyError extends HandledError {
  constructor({ status, meta }: { status: number; meta: Record<string, unknown> }) {
    super("provider_busy", "The provider is busy", { httpStatus: status, meta, retryable: true });
    this.name = "ProviderBusyError";
  }
}

interface ActionApi {
  run(input: Record<string, unknown>): Promise<{ ok: boolean }>;
  refuse(input: { waitMs?: unknown; status?: number }): Promise<{ ok: boolean }>;
}

const ActionApi = moduleApi<ActionApi>()("annotation");

const ok = z.object({ ok: z.boolean() });

const actions = defineRestRouter(ActionApi)
  .withNamespace("annotations")
  .withVersion(VERSION)
  .post("/archive", "archiveAnnotation")
  .withInput(z.object({}))
  .withPermission("annotations:manage")
  .withOutput(ok)
  .handle(async ({ app, input }) => app.run(input))

  .put("/archive", "replaceArchive")
  .withInput(z.object({}))
  .withPermission("annotations:manage")
  .withOutput(ok)
  .handle(async ({ app, input }) => app.run(input))

  .patch("/archive", "patchArchive")
  .withInput(z.object({ reason: z.string().optional() }))
  .withPermission("annotations:manage")
  .withOutput(ok)
  .handle(async ({ app, input }) => app.run(input))

  .post("/rename", "renameAnnotation")
  .withInput(z.object({ name: z.string() }))
  .withPermission("annotations:manage")
  .withOutput(ok)
  .handle(async ({ app, input }) => app.run(input))

  .post("/refuse", "refuseAnnotation")
  .withInput(z.object({ waitMs: z.unknown().optional(), status: z.number().optional() }))
  .withPermission("annotations:manage")
  .withOutput(ok)
  .handle(async ({ app, input }) => app.refuse(input))

  .get("/limited", "readLimited")
  .withRateLimit({ requests: 1, seconds: 60 })
  .withPermission("annotations:view")
  .withOutput(ok)
  .handle(async () => ({ ok: true }))
  .build();

function actionsApp({ onError = canonicalErrorResponse }: { onError?: ErrorHandler } = {}) {
  const run = vi.fn(async (_input: Record<string, unknown>) => ({ ok: true }));

  const refuse = vi.fn(async ({ waitMs, status }: { waitMs?: unknown; status?: number }) => {
    throw new ProviderBusyError({
      status: status ?? 429,
      meta: waitMs === undefined ? {} : { retryAfterMs: waitMs },
    });
  });

  const app = createRestRuntime({
    identity: {
      authenticate: () => ({ actor: null, scope: { tier: "project", id: "project-1" } as const }),
    },
    rateLimiter: { check: async () => ({ allowed: false, retryAfterSeconds: 30 }) },
  }).mount(actions.router(), { app: () => ({ run, refuse }), credential: "project", onError });

  return { app, run };
}

describe("a declared action called without a body", () => {
  describe("given its input schema accepts the empty object", () => {
    /** @scenario "A bodiless call to an action that takes no body reads the empty object" */
    it.each(["POST", "PUT", "PATCH"])("reads a %s with no body attached as {}", async (method) => {
      const { app, run } = actionsApp();
      const response = await app.request(`${BASE}/archive`, { method, headers: JSON_TYPE });

      expect(response.status).toBe(200);
      expect(run).toHaveBeenCalledWith({});
    });

    /** @scenario "A bodiless call to an action that takes no body reads the empty object" */
    it("reads a declared length of zero as {}", async () => {
      const { app, run } = actionsApp();
      const response = await app.request(`${BASE}/archive`, {
        method: "POST",
        headers: { ...JSON_TYPE, "Content-Length": "0" },
        body: "",
      });

      expect(response.status).toBe(200);
      expect(run).toHaveBeenCalledWith({});
    });

    /** @scenario "A bodiless call to an action that takes no body reads the empty object" */
    it("reads a body stream that ends without a byte, its length undeclared, as {}", async () => {
      const { app, run } = actionsApp();
      const request = new Request(`http://localhost${BASE}/archive`, {
        method: "POST",
        headers: JSON_TYPE,
        body: "",
      });

      expect(request.body).not.toBeNull();
      expect(request.headers.has("Content-Length")).toBe(false);

      const response = await app.request(request);

      expect(response.status).toBe(200);
      expect(run).toHaveBeenCalledWith({});
    });
  });

  describe("given its input schema requires a field", () => {
    /** @scenario "A bodiless call to an action that needs fields is refused as a validation error" */
    it("refuses with the same validation error a call with no content type receives", async () => {
      const { app, run } = actionsApp();
      const typed = await app.request(`${BASE}/rename`, { method: "POST", headers: JSON_TYPE });
      const untyped = await app.request(`${BASE}/rename`, { method: "POST" });

      expect(typed.status).toBe(422);
      expect(untyped.status).toBe(422);
      await expect(typed.json()).resolves.toEqual(await untyped.json());
      expect(run).not.toHaveBeenCalled();
    });
  });
});

describe("a declared action called with a body", () => {
  /** @scenario "A body that was sent is parsed as sent, never read as the empty object" */
  it.each([
    ["an explicit null", "null"],
    ["an empty JSON string", '""'],
  ])("refuses %s as a validation error", async (_label, body) => {
    const { app, run } = actionsApp();
    const response = await app.request(`${BASE}/archive`, {
      method: "POST",
      headers: JSON_TYPE,
      body,
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ code: "validation_error" });
    expect(run).not.toHaveBeenCalled();
  });

  /** @scenario "A body that was sent is parsed as sent, never read as the empty object" */
  it.each([
    ["malformed JSON", "{"],
    ["whitespace alone", " "],
  ])("refuses %s before the handler, never reading it as {}", async (_label, body) => {
    const { app, run } = actionsApp();
    const response = await app.request(`${BASE}/archive`, {
      method: "POST",
      headers: JSON_TYPE,
      body,
    });

    expect(response.ok).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  /** @scenario "A body that was sent is parsed as sent, never read as the empty object" */
  it("hands the handler the fields a body carried", async () => {
    const { app, run } = actionsApp();
    const response = await app.request(`${BASE}/archive`, {
      method: "PATCH",
      headers: JSON_TYPE,
      body: JSON.stringify({ reason: "duplicate" }),
    });

    expect(response.status).toBe(200);
    expect(run).toHaveBeenCalledWith({ reason: "duplicate" });
  });
});

async function refused({
  waitMs,
  status,
  onError,
}: {
  waitMs?: unknown;
  status?: number;
  onError?: ErrorHandler;
}): Promise<Response> {
  const { app } = actionsApp({ onError });

  return app.request(`${BASE}/refuse`, {
    method: "POST",
    headers: JSON_TYPE,
    body: JSON.stringify({ ...(waitMs === undefined ? {} : { waitMs }), status }),
  });
}

describe("a handled refusal that names how long to wait", () => {
  /** @scenario "A handled refusal naming its wait is answered with Retry-After in whole seconds" */
  it.each([
    [0, "0"],
    [1, "1"],
    [1000, "1"],
    [1001, "2"],
    [90_000, "90"],
  ])("renders %d ms as Retry-After: %s", async (waitMs, seconds) => {
    const response = await refused({ waitMs });

    expect(response.headers.get("Retry-After")).toBe(seconds);
  });

  /** @scenario "A refusal naming no usable wait carries no Retry-After" */
  it.each([
    ["no wait at all", undefined],
    ["a wait written as text", "30"],
    ["a negative wait", -1000],
    ["a wait that is not a value", null],
  ])("carries no Retry-After for %s", async (_label, waitMs) => {
    const response = await refused({ waitMs });

    expect(response.status).toBe(429);
    expect(response.headers.has("Retry-After")).toBe(false);
  });

  /** @scenario "Retry-After leaves the refusal's status, body and an existing Retry-After as they were" */
  it.each([429, 503])("keeps the %d status and the body the boundary renders", async (status) => {
    const response = await refused({ waitMs: 2500, status });
    const expected = canonicalErrorFor(
      new ProviderBusyError({ status, meta: { retryAfterMs: 2500 } }),
    );

    expect(response.status).toBe(status);
    expect(response.headers.get("Retry-After")).toBe("3");
    expect(response.headers.get("Content-Type")).toMatch(/^application\/json/);
    await expect(response.json()).resolves.toEqual(expected.body);
  });

  /** @scenario "Retry-After leaves the refusal's status, body and an existing Retry-After as they were" */
  it("keeps a Retry-After the family's own boundary already set", async () => {
    const response = await refused({
      waitMs: 2500,
      onError: (error, c) => {
        c.header("Retry-After", "7");
        return canonicalErrorResponse(error, c);
      },
    });

    expect(response.headers.get("Retry-After")).toBe("7");
  });

  /** @scenario "Retry-After leaves the refusal's status, body and an existing Retry-After as they were" */
  it("leaves the rate limiter's refusal with the wait the counter named", async () => {
    const { app } = actionsApp();
    const response = await app.request(`${BASE}/limited`);

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("30");
    await expect(response.json()).resolves.toEqual(canonicalErrorFor(new RateLimitedError()).body);
  });
});
