import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { App } from "~/server/app-layer/app";
import { appContextMiddlewareFor, appFromContext } from "../app-context";

describe("appContextMiddlewareFor", () => {
  it("installs the captured App without consulting the process singleton", async () => {
    const capturedApp = {} as App;
    const app = new Hono();

    app.use("*", appContextMiddlewareFor(capturedApp));
    app.get("/", (context) =>
      context.json({
        sameContextApp: context.app === capturedApp,
        sameVariableApp: context.var.langwatchApp === capturedApp,
      }),
    );

    const response = await app.request("http://localhost/");
    expect(await response.json()).toEqual({
      sameContextApp: true,
      sameVariableApp: true,
    });
  });

  it("refuses a request that was not given a process App", async () => {
    const app = new Hono();
    app.get("/", (context) => context.json(appFromContext(context)));

    const response = await app.request("http://localhost/");
    expect(response.status).toBe(500);
  });
});
