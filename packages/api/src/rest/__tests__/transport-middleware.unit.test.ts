import { featureApi } from "@langwatch/runtime-composition/contract";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineRestRouter } from "../rest-router.ts";
import { bindRestMiddleware, defineRestMiddleware } from "../transport-middleware.ts";
import { mountProjectTransport, setProjectTransportAuthorization } from "../transport-mount.ts";
import type { DefaultsChain } from "../definition.ts";
import type { RestApiVersionedFamily } from "../security/rest-api-service.ts";
import { createTestService } from "./test-service.ts";

const Api = featureApi<object>("annotation");
const caller = defineRestMiddleware("caller", z.object({ userId: z.string() }).strip());
const trace = defineRestMiddleware("trace", z.string());

function harness(options: { malformed?: boolean; missing?: boolean } = {}) {
  const handle = vi.fn((input: { name: string }, userId: string, traceId: string) => ({
    name: input.name,
    userId,
    traceId,
  }));

  const router = defineRestRouter(Api)
    .withNamespace("annotations")
    .withVersion("2026-09-08")
    .post("/", "createAnnotation")
    .withInput(z.object({ name: z.string() }).strip())
    .withPermission("annotations:create")
    .withOutput(z.object({ name: z.string(), userId: z.string(), traceId: z.string() }))
    .withStatus(201)
    .withMiddleware(caller, trace)
    .handle(({ input }, caller, traceId) => handle(input, caller.userId, traceId))
    .build();

  const service = createTestService({ name: "annotations", basePath: "/api/annotations" });

  const family: RestApiVersionedFamily = {
    service,
    rest: service.asRestService(),
    policy:
      () =>
      <TChain extends DefaultsChain>(chain: TChain) =>
        chain,
  };

  const middleware = [
    options.malformed
      ? { middleware: caller, resolve: () => ({}) }
      : bindRestMiddleware(caller, () => ({ userId: "trusted-user", secret: "must-not-leak" })),
    bindRestMiddleware(trace, () => "trace-1"),
  ];

  mountProjectTransport({
    family,
    transport: router.router(),
    app: () => ({}),
    credential: "apiKey",
    authenticate: () => async (context, next) => {
      setProjectTransportAuthorization(context, {
        actor: null,
        scope: { tier: "project", id: "project-1" },
      });

      await next();
    },
    authorize: () => {},
    middleware: options.missing ? [] : middleware,
  });

  return { app: service.build(), handle };
}

describe("parsed transport middleware", () => {
  it("preserves an explicit create status and passes parsed facts in declaration order", async () => {
    const { app, handle } = harness();

    const response = await app.request("/api/annotations/2026-09-08", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Review", userId: "forged-user" }),
    });

    expect(response.status).toBe(201);

    expect(await response.json()).toEqual({
      name: "Review",
      userId: "trusted-user",
      traceId: "trace-1",
    });

    expect(handle).toHaveBeenCalledWith({ name: "Review" }, "trusted-user", "trace-1");
  });

  it("refuses missing middleware bindings during mounting", () => {
    expect(() => harness({ missing: true })).toThrow(
      'REST middleware "caller" must have exactly one binding',
    );
  });

  it("rejects malformed middleware facts before invoking the handler", async () => {
    const { app, handle } = harness({ malformed: true });

    const response = await app.request("/api/annotations/2026-09-08", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Review" }),
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(handle).not.toHaveBeenCalled();
  });
});
