import { SecretService } from "@langwatch/secret-contract";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { ApiApplication } from "../api.application";
import {
  ApiMetricsPort,
  ApiProcessLifecycleRoutes,
  ApiRequestFailureCapturePort,
} from "../api-process.lifecycle";

describe("ApiProcessLifecycleRoutes", () => {
  it("preserves the empty 204 liveness response for GET and HEAD", async () => {
    const routes = ApiProcessLifecycleRoutes.create({});

    const getResponse = await routes.request("http://api.test/api/health");
    const headResponse = await routes.request("http://api.test/api/health", { method: "HEAD" });

    expect(getResponse.status).toBe(204);
    await expect(getResponse.text()).resolves.toBe("");
    expect(headResponse.status).toBe(204);
    await expect(headResponse.text()).resolves.toBe("");
  });

  it("delegates metrics handling to the injected process capability", async () => {
    const metrics = new TestMetrics();
    const routes = ApiProcessLifecycleRoutes.create({ metrics });

    const response = await routes.request("http://api.test/metrics");

    expect(metrics.respond).toHaveBeenCalledWith(
      expect.objectContaining({ url: "http://api.test/metrics" }),
    );
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("api_requests_total 1\n");
  });
});

describe("ApiApplication HTTP failures", () => {
  it("captures uncaught transport failures and preserves the platform 500 response", async () => {
    const capture = new TestFailureCapture();
    const rest = new Hono().get("/explode", () => {
      throw new Error("boom");
    });
    const application = ApiApplication.create({
      secrets: new TestSecretService(),
      rest,
      http: {
        createContext: async () => ({
          actor: () => ({ id: "user-1" }),
          authorize: async () => undefined,
        }),
        errorCapture: capture,
      },
    });
    if (!application.hono) throw new Error("HTTP composition was not created.");

    const response = await application.hono.request("http://api.test/explode");

    expect(response.status).toBe(500);
    await expect(response.text()).resolves.toBe("internal server error");
    expect(capture.capture).toHaveBeenCalledWith({
      error: expect.objectContaining({ message: "boom" }),
      request: expect.objectContaining({ url: "http://api.test/explode" }),
    });
  });

  it("leaves a child transport's own error response untouched", async () => {
    const capture = new TestFailureCapture();
    const rest = new Hono();
    rest.onError((error, context) => context.json({ code: error.message }, 418));
    rest.get("/child-failure", () => {
      throw new Error("child-handled");
    });
    const application = ApiApplication.create({
      secrets: new TestSecretService(),
      rest,
      http: {
        createContext: async () => ({
          actor: () => ({ id: "user-1" }),
          authorize: async () => undefined,
        }),
        errorCapture: capture,
      },
    });
    if (!application.hono) throw new Error("HTTP composition was not created.");

    const response = await application.hono.request("http://api.test/child-failure");

    expect(response.status).toBe(418);
    await expect(response.json()).resolves.toEqual({ code: "child-handled" });
    expect(capture.capture).not.toHaveBeenCalled();
  });
});

class TestMetrics extends ApiMetricsPort {
  readonly respond = vi.fn(async () => new Response("api_requests_total 1\n"));
}

class TestFailureCapture extends ApiRequestFailureCapturePort {
  readonly capture = vi.fn(async () => undefined);
}

class TestSecretService extends SecretService {
  async list() {
    return [];
  }

  async getValues() {
    return {};
  }

  get() {
    return this.unavailable();
  }

  create() {
    return this.unavailable();
  }

  update() {
    return this.unavailable();
  }

  async delete() {}

  private unavailable(): never {
    throw new Error("Not used by this test.");
  }
}
