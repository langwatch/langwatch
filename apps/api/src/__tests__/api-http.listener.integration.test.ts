import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { ApiHttpListener } from "../api-http.listener";

describe("ApiHttpListener", () => {
  it("serves the composed Hono graph then stops accepting requests on close", async () => {
    const application = new Hono().get("/ready", (context) => context.text("ready"));
    const listener = ApiHttpListener.create({
      application,
      host: "127.0.0.1",
      port: 0,
      drainGraceMs: 1,
    });
    const address = await listener.start();

    const response = await fetch(`http://127.0.0.1:${address.port}/ready`);
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("ready");

    await Promise.all([listener.close(), listener.close()]);
    await expect(fetch(`http://127.0.0.1:${address.port}/ready`)).rejects.toThrow();
  });

  it("drains an in-flight request before closing the process intake", async () => {
    let release: (() => void) | undefined;
    let markEntered: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    const application = new Hono().get("/slow", async (context) => {
      markEntered?.();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return context.text("finished");
    });
    const listener = ApiHttpListener.create({
      application,
      host: "127.0.0.1",
      port: 0,
      drainGraceMs: 1_000,
    });
    const address = await listener.start();
    const response = fetch(`http://127.0.0.1:${address.port}/slow`);
    await entered;

    let closed = false;
    const closing = listener.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);

    release?.();
    await expect((await response).text()).resolves.toBe("finished");
    await closing;
  });

  it("reaps a request that outlives the bounded drain grace", async () => {
    let markEntered: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    const logger = { info: vi.fn(), error: vi.fn() };
    const application = new Hono().get("/stuck", async () => {
      markEntered?.();
      await new Promise<void>(() => undefined);
      return new Response("unreachable");
    });
    const listener = ApiHttpListener.create({
      application,
      host: "127.0.0.1",
      port: 0,
      drainGraceMs: 1,
      logger,
    });
    const address = await listener.start();
    const response = fetch(`http://127.0.0.1:${address.port}/stuck`);
    await entered;

    await listener.close();

    await expect(response).rejects.toThrow();
    expect(logger.info).toHaveBeenCalledWith(
      { drainGraceMs: 1 },
      "API requests outlived the drain grace, closing remaining connections",
    );
  });

  it("is idempotent and rejects a second listener that cannot bind", async () => {
    const application = new Hono().get("/ready", (context) => context.text("ready"));
    const first = ApiHttpListener.create({ application, host: "127.0.0.1", port: 0 });
    const firstAddress = await first.start();
    await expect(first.start()).resolves.toEqual(firstAddress);

    const second = ApiHttpListener.create({
      application,
      host: "127.0.0.1",
      port: firstAddress.port,
    });
    await expect(second.start()).rejects.toMatchObject({ code: "EADDRINUSE" });
    await Promise.all([second.close(), first.close(), first.close()]);
    expect(() => first.start()).toThrow("closing");
  });
});
