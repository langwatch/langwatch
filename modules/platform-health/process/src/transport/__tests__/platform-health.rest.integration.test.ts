import { createApiFixture } from "@langwatch/api-fixture";
/**
 * @vitest-environment node
 */
import { apiErrorBody, bindRestMiddleware, createRestRuntime } from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import {
  type PlatformHealthApi as PlatformHealthCapability,
  PlatformHealthUnauthorizedError,
} from "@langwatch/platform-health-contract";
import type { ErrorHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { describe, expect, it, vi } from "vitest";

import { platformHealthAuthorization, platformHealthRest } from "../platform-health.rest.ts";

const renderError: ErrorHandler = (error, context) => {
  if (!HandledError.isHandled(error)) throw error;

  return context.json(
    apiErrorBody({
      status: error.httpStatus,
      code: error.code,
      message: error.message,
      meta: error.meta,
      retryable: error.retryable,
    }),
    error.httpStatus as ContentfulStatusCode,
  );
};

function mount(app: PlatformHealthCapability) {
  return createRestRuntime({
    identity: {
      authenticate: () => {
        throw new Error("platform health resolves no tenant credential");
      },
    },
  }).mount(platformHealthRest.router(), {
    app: () => app,
    onError: renderError,
    facts: [
      bindRestMiddleware(
        platformHealthAuthorization,
        (context) => context.req.header("authorization") ?? null,
      ),
    ],
  });
}

const healthyReport = {
  status: "healthy" as const,
  checkedAt: "2026-09-17T12:00:00.000Z",
  checks: [
    {
      name: "collector" as const,
      status: "healthy" as const,
      durationMs: 4,
    },
  ],
};

describe("platform health REST family", () => {
  /** @scenario "A request with no key runs no probe" */
  it("refuses a missing monitoring key before running a probe", async () => {
    const checkAll = vi.fn(async () => healthyReport);
    const hono = mount(
      createApiFixture<PlatformHealthCapability>({
        acceptsKey: () => false,
        checkAll,
      }),
    );

    const response = await hono.request("/api/v1/platform-health");

    expect(response.status).toBe(new PlatformHealthUnauthorizedError().httpStatus);
    expect(checkAll).not.toHaveBeenCalled();
  });

  /** @scenario "A working platform answers success" */
  it("serves the canonical monitoring route when the key and probes are healthy", async () => {
    const checkAll = vi.fn(async () => healthyReport);
    const hono = mount(
      createApiFixture<PlatformHealthCapability>({
        acceptsKey: (key) => key === "monitor-key",
        checkAll,
      }),
    );

    const response = await hono.request("/api/v1/platform-health", {
      headers: { authorization: "Bearer monitor-key" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(healthyReport);
    expect(checkAll).toHaveBeenCalledWith({});
  });

  it.each(["/api/health/langy", "/api/health/scenarios"])(
    "does not revive retired tenant canary route %s",
    async (path) => {
      const hono = mount(createApiFixture<PlatformHealthCapability>());

      expect((await hono.request(path)).status).toBe(404);
    },
  );
});
