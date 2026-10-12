import { existsSync } from "node:fs";
import { createServer } from "node:http";
import type { Server } from "node:net";

import { chromium } from "playwright";
import type { Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Side, closeBrowser } from "../capture.ts";
import { signIn } from "../flows/actions.ts";

const installed = existsSync(chromium.executablePath());

const FORM = `<form action="/home"><label>Email <input name="email"></label>
  <label>Password <input name="password" type="password"></label><button>Log in</button></form>`;

describe.skipIf(!installed)("Feature: the run signs in on a cold dev server", () => {
  let browser: Browser;
  let server: Server;
  const visits: string[] = [];

  beforeAll(async () => {
    browser = await chromium.launch();
    server = createServer((request, response) => {
      const path = new URL(request.url ?? "/", "http://x").pathname;
      visits.push(path);
      const firstSignIn = path === "/auth/signin" && visits.indexOf(path) === visits.length - 1;
      response.setHeader("content-type", "text/html");
      response.end(path === "/auth/signin" && !firstSignIn ? FORM : "<p>module failed</p>");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  });
  afterAll(async () => {
    server?.close();
    if (browser !== undefined) await closeBrowser(browser);
  });

  it("reloads a sign-in page whose first load rendered no form, instead of signing up", async () => {
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no port");
    const { port } = address;
    const page = await browser.newPage();
    const side = new Side("candidate", `http://127.0.0.1:${port}`, page, {
      quietMillis: 50,
      deadlineMillis: 2000,
    });

    await signIn({
      side,
      slug: "project",
      credential: {
        projectKey: "",
        slug: "project",
        email: "admin@example.com",
        password: "secret",
      },
      args: {},
      values: {},
      snapshot: async () => undefined,
    });

    expect(visits.filter((path) => path === "/auth/signin")).toHaveLength(2);
    expect(visits).not.toContain("/auth/signup");
    await page.close();
  }, 60_000);
});
