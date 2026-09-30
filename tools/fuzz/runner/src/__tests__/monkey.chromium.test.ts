import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openSideBrowser, type SideBrowser } from "@langwatch/visual-diff-runner/capture";
import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Collector, walkRoute } from "../monkey.ts";
import { findingSchema, planSchema, type Finding } from "../protocol.ts";
import { FindingSink } from "../sink.ts";

const installed = existsSync(chromium.executablePath());

const PAGE = `<!doctype html><body><h1>Fixture</h1>
<button onclick="setTimeout(() => { throw new Error('boom 1') })">Throw</button>
<button onclick="fetch('/api/broken')">Break the API</button>
<button onclick="console.error('logged failure 3')">Log</button>
<button onclick="document.body.insertAdjacentHTML('beforeend', '<div role=dialog><p>Dialog</p><button onclick=&quot;this.parentElement.remove()&quot;>Close</button></div>')">Open</button>
<button onclick="window.signedOut = true">Sign out</button>
<input placeholder="name" /><a href="/missing">Missing page</a></body>`;

const serve = async (): Promise<Server> => {
  const server = createServer((request, response) => {
    if (request.url === "/api/broken") {
      response.writeHead(500).end("no");
    } else if (request.url === "/") {
      response.writeHead(200, { "content-type": "text/html" }).end(PAGE);
    } else {
      response
        .writeHead(200, { "content-type": "text/html" })
        .end("<body><p>Page not found</p><a href='/'>Home</a></body>");
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return server;
};

describe.skipIf(!installed)("the monkey against a fixture page", () => {
  let server: Server;
  let browser: SideBrowser;
  let baseUrl = "";

  beforeAll(async () => {
    server = await serve();
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    browser = await openSideBrowser({
      side: { name: "fixture", baseUrl },
      viewport: { width: 800, height: 600 },
      settle: { quietMillis: 50, deadlineMillis: 2000 },
    });
  });
  afterAll(async () => {
    await browser?.close();
    server?.close();
  });

  const run = async (seed: number): Promise<Finding[]> => {
    const plan = planSchema.parse({
      url: baseUrl,
      seed,
      actionsPerRoute: 40,
      slug: "p",
      credential: { email: "", password: "" },
    });
    const side = await browser.openPage();
    const dir = mkdtempSync(join(tmpdir(), "fuzz-"));
    const sink = new FindingSink(dir);
    const result = await walkRoute({
      side,
      collector: new Collector(side.page),
      plan,
      sink,
      route: "/",
      path: "/",
      visit: 0,
      navigation: "reload",
      avoid: [],
      now: Date.now,
      deadline: Number.POSITIVE_INFINITY,
    });
    const signedOut = await side.page.evaluate(
      () => (window as { signedOut?: boolean }).signedOut === true,
    );
    expect(signedOut).toBe(false);
    await side.dispose();
    expect(result.actions).toBe(40);
    await sink.flush();
    expect(sink.findings).toBe(result.findings);
    return readFileSync(join(dir, "findings.jsonl"), "utf8")
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => findingSchema.parse(JSON.parse(line)));
  };

  it("finds the page error, the 5xx, the console error and the not-found page, with trails", async () => {
    const findings = await run(1);
    const oracles = new Set(findings.map((finding) => finding.oracle));
    expect(oracles).toEqual(new Set(["page-error", "network-5xx", "console-error", "nav-404"]));
    expect(findings.every((finding) => finding.trail[0] === "goto /")).toBe(true);
    expect(findings.some((finding) => finding.trail.some((line) => line.startsWith("click")))).toBe(
      true,
    );
    expect(findings.filter((finding) => finding.evidence.screenshot !== undefined)).not.toEqual([]);
  }, 120_000);

  it("replays the same trail for the same seed", async () => {
    const trails = async (seed: number) =>
      (await run(seed)).map((finding) => [finding.signature, finding.trail]);
    const first = await trails(4);
    expect(first.length).toBeGreaterThan(0);
    expect(await trails(4)).toEqual(first);
  }, 120_000);
});
