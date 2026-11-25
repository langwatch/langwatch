/* The Haven docs mount against a real `--base-path /docs` build: an app front over a mock app
   (SSE, websocket) and a docs-only mount. Read-only; no stack.
   node scripts/mount.smoke.test.mjs --haven-binary <haven> [--out-dir <build>]
   [--base-path /docs] */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { parseArgs } from "node:util";

import { chromium } from "playwright";

const { values } = parseArgs({
  options: {
    "haven-binary": { type: "string" },
    "out-dir": { type: "string" },
    "base-path": { type: "string" },
  },
});
const haven = values["haven-binary"] ?? process.env.DOCS_HAVEN_BINARY ?? "haven";
const outDir = path.resolve(values["out-dir"] ?? "node_modules/.cache/haven-docs");
const base = values["base-path"] ?? "/docs";
const PRODUCTION = "https://langwatch.ai/docs";

if (!existsSync(path.join(outDir, "index.html")))
  throw new Error(`No build in ${outDir}; build with --base-path ${base} first.`);

/* The mock app: what the front must hand through untouched. */
const APP_PAGE = `<!doctype html><title>App</title><h1>App home</h1>`;

function startApp() {
  const seen = [];
  const server = http.createServer((request, response) => {
    seen.push({ method: request.method, url: request.url, host: request.headers.host });
    const { pathname } = new URL(request.url, "http://app");
    if (pathname === "/")
      return response.writeHead(200, { "content-type": "text/html" }).end(APP_PAGE);
    if (pathname === "/api/stream") {
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      response.write("data: first\n\n");
      const timer = setTimeout(() => response.end("data: last\n\n"), 1500);
      response.on("close", () => clearTimeout(timer));
      return;
    }
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () =>
      response
        .writeHead(200, { "content-type": "text/plain" })
        .end(`app:${request.method}:${pathname}:${body}`),
    );
  });
  server.on("upgrade", (request, socket) => {
    seen.push({ method: "UPGRADE", url: request.url, host: request.headers.host });
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n",
    );
    socket.on("data", (chunk) => socket.write(chunk));
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ server, seen, port: server.address().port })),
  );
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
    probe.on("error", reject);
  });
}

async function waitForPort({ port, child }) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`${haven} docs-mount exited ${child.exitCode}`);
    const open = await new Promise((resolve) => {
      const socket = net.connect(port, "127.0.0.1", () => resolve(socket.end() && true));
      socket.on("error", () => resolve(false));
    });
    if (open) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`docs-mount never listened on ${port}`);
}

/** One `haven docs-mount`; with an app it is the app hostname's front. */
async function startMount({ appPort }) {
  const port = await freePort();
  const args = ["docs-mount", outDir, String(port), base];
  if (appPort) args.push(`http://127.0.0.1:${appPort}`, "127.0.0.1");
  const child = spawn(haven, args, { stdio: ["ignore", "inherit", "inherit"] });
  await waitForPort({ port, child });
  return { child, origin: `http://127.0.0.1:${port}` };
}

const get = (url, init = {}) => fetch(url, { redirect: "manual", ...init });

/** Root-absolute addresses in a page: href, src, action, poster, data-src, srcset candidates. */
function rootAddresses({ html }) {
  const single = [...html.matchAll(/\b(?:href|src|action|poster|data-src)="([^"]*)"/gi)];
  const sets = [...html.matchAll(/\bsrcset="([^"]*)"/gi)].flatMap((match) =>
    match[1].split(",").map((candidate) => candidate.trim().split(/\s+/)[0]),
  );
  return [...single.map((match) => match[1]), ...sets].filter(
    (address) => address.startsWith("/") && !address.startsWith("//"),
  );
}

/* Pages whose authored media used to escape the mount: the home and product shots (srcset),
   and a guide with a legacy direct <video src>. */
const MEDIA_PAGES = [
  "",
  "introduction",
  "coding-agents/overview",
  "prompt-management/prompt-playground",
];

/** Upgrades to a websocket through the mount, sends "ping" and returns all it got back. */
async function upgradeAndEcho({ origin }) {
  const { port } = new URL(origin);
  const socket = net.connect(Number(port), "127.0.0.1");
  try {
    return await new Promise((resolve, reject) => {
      let text = "";
      socket.on("data", (chunk) => {
        text += chunk;
        if (text.includes("\r\n\r\n") && !text.includes("ping")) socket.write("ping");
        if (text.endsWith("ping")) resolve(text);
      });
      socket.on("error", reject);
      socket.write(
        `GET /@vite/hmr HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n`,
      );
    });
  } finally {
    socket.destroy();
  }
}

let app, front, alone, browser;
before(async () => {
  app = await startApp();
  front = await startMount({ appPort: app.port });
  alone = await startMount({ appPort: 0 });
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  for (const mount of [front, alone]) mount?.child.kill("SIGTERM");
  app?.server.close();
});

void describe("the app front", () => {
  void it("serves the prefixed build with its static-host contract", async () => {
    const bare = await get(`${front.origin}${base}`);
    assert.equal(bare.status, 301);
    assert.equal(bare.headers.get("location"), `${base}/`);
    const home = await get(`${front.origin}${base}/`);
    assert.equal(home.status, 200);
    assert.match(home.headers.get("content-type"), /text\/html/);
    const html = await home.text();
    const escaped = rootAddresses({ html }).filter((address) => !address.startsWith(`${base}/`));
    assert.deepEqual(escaped, [], "every root-absolute address stays under the mount");
    assert.match(html, new RegExp(`<link rel="canonical" href="${PRODUCTION}/introduction">`));
    const markdown = await get(`${front.origin}${base}/introduction.md`);
    assert.equal(markdown.status, 200);
    assert.match(markdown.headers.get("content-type"), /text\/markdown/);
    assert.match(await markdown.text(), new RegExp(`> Page: ${PRODUCTION}/`));
    const missingPage = await get(`${front.origin}${base}/no-such-page`);
    assert.equal(missingPage.status, 404);
    assert.match(missingPage.headers.get("content-type"), /text\/html/);
    const recovery = rootAddresses({ html: await missingPage.text() });
    assert.deepEqual(
      recovery.filter(
        (address) => !address.startsWith(`${base}/`) || address.startsWith(`${base}${base}/`),
      ),
      [],
      "the 404 page's recovery links are prefixed exactly once",
    );
    const missingAsset = await get(`${front.origin}${base}/assets/gone-Zz99.js`);
    assert.equal(missingAsset.status, 404);
    assert.doesNotMatch(missingAsset.headers.get("content-type") ?? "", /text\/html/);
  });

  void it("keeps authored media, srcset and video addresses under the mount", async () => {
    for (const slug of MEDIA_PAGES) {
      const html = await (await get(`${front.origin}${base}/${slug}`)).text();
      const escaped = rootAddresses({ html }).filter((address) => !address.startsWith(`${base}/`));
      assert.deepEqual(escaped, [], `${slug || "home"} keeps every address under ${base}/`);
    }
    const guide = await (
      await get(`${front.origin}${base}/prompt-management/prompt-playground`)
    ).text();
    assert.match(
      guide,
      new RegExp(`${base}/media/videos/add-prompt\\.[0-9a-f]{12}\\.mp4`),
      "the legacy video is transcoded, hashed and prefixed",
    );
  });

  void it("keeps discovery files canonical to production", async () => {
    const sitemap = await (await get(`${front.origin}${base}/sitemap.xml`)).text();
    assert.ok(sitemap.includes(`<loc>${PRODUCTION}/introduction</loc>`));
    const locations = [...sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)].map((match) => match[1]);
    assert.ok(
      locations.length > 0 && locations.every((loc) => loc.startsWith(`${PRODUCTION}/`)),
      "the sitemap names production, never the mount",
    );
    const llms = await (await get(`${front.origin}${base}/llms.txt`)).text();
    assert.ok(llms.includes(`${PRODUCTION}/`) && !llms.includes(`localhost${base}`));
  });

  void it("redirects docs.json sources under the mount, keeping the query", async () => {
    const redirects = JSON.parse(readFileSync(path.join(outDir, "redirects.json"), "utf8"));
    const [source, destination] =
      Object.entries(redirects).find(([from, to]) => !/[:*]/.test(from) && to.startsWith("/")) ??
      [];
    assert.ok(source, "the build has a static redirect to try");
    const response = await get(`${front.origin}${base}${source}?from=smoke`);
    assert.equal(response.status, 301);
    const location = response.headers.get("location");
    assert.ok(location.startsWith(`${base}${destination.split(/[?#]/)[0]}`), location);
    assert.match(location, /from=smoke/);
  });

  void it("hands every other path to the app unchanged", async () => {
    const post = await get(`${front.origin}/api/trpc/x?batch=1`, { method: "POST", body: "{}" });
    assert.equal(await post.text(), "app:POST:/api/trpc/x:{}");
    assert.equal(app.seen.at(-1).url, "/api/trpc/x?batch=1");
    assert.equal(app.seen.at(-1).host, new URL(front.origin).host);
    const root = await get(`${front.origin}/`);
    assert.match(await root.text(), /App home/);
  });

  void it("streams server-sent events as they are written", async () => {
    const started = Date.now();
    const response = await get(`${front.origin}/api/stream`);
    const reader = response.body.getReader();
    const { value } = await reader.read();
    assert.match(new TextDecoder().decode(value), /data: first/);
    assert.ok(Date.now() - started < 1000, "the first event arrived before the stream ended");
    await reader.cancel();
  });

  void it("passes websocket upgrades through", async () => {
    assert.match(await upgradeAndEcho({ origin: front.origin }), /^HTTP\/1\.1 101/);
  });
});

void describe("in a browser on the app front", () => {
  void it("loads every asset under the mount and navigates within it", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const failures = [];
    const outside = [];
    page.on("console", (message) => message.type() === "error" && failures.push(message.text()));
    page.on("pageerror", (error) => failures.push(error.message));
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (url.origin !== front.origin) return;
      if (response.status() >= 400) failures.push(`${response.status()} ${url.pathname}`);
      if (!url.pathname.startsWith(`${base}/`)) outside.push(url.pathname);
    });
    for (const slug of MEDIA_PAGES.slice(2))
      await page.goto(`${front.origin}${base}/${slug}`, { waitUntil: "networkidle" });
    await page.goto(`${front.origin}${base}/introduction`, { waitUntil: "networkidle" });
    await page.locator("h1").first().waitFor();
    const fonts = await page.evaluate(() =>
      [...document.fonts].filter((font) => font.status === "loaded").map((font) => font.family),
    );
    const link = page.locator(`#content a[href^="${base}/"]`).first();
    const target = await link.getAttribute("href");
    await link.click();
    await page.waitForURL((url) => url.pathname === target.split("#")[0]);
    assert.deepEqual(outside, [], "the docs never request a path outside the mount");
    assert.deepEqual(failures, []);
    assert.ok(fonts.length > 0, "the reading font loaded through the mount");
    const workers = await page.evaluate(
      async () => (await navigator.serviceWorker.getRegistrations()).length,
    );
    assert.equal(workers, 0, "the docs install no service worker");
    await context.close();
  });
});

void describe("the docs alone", () => {
  void it("sends the root to the docs and answers nothing else outside the mount", async () => {
    const root = await get(`${alone.origin}/`);
    assert.equal(root.status, 302);
    assert.equal(root.headers.get("location"), `${base}/`);
    const api = await get(`${alone.origin}/api/health`);
    assert.equal(api.status, 404);
    assert.match(await api.text(), new RegExp(`served under ${base}/`));
  });

  void it("serves pages and exports under the mount", async () => {
    for (const [address, type] of [
      [`${base}/`, /text\/html/],
      [`${base}/introduction`, /text\/html/],
      [`${base}/introduction.md`, /text\/markdown/],
      [`${base}/llms.txt`, /text\/plain/],
    ]) {
      const response = await get(`${alone.origin}${address}`);
      assert.equal(response.status, 200, address);
      assert.match(response.headers.get("content-type"), type, address);
      assert.equal(response.headers.get("x-robots-tag"), "noindex", address);
    }
    const page = await browser.newPage();
    const response = await page.goto(`${alone.origin}/`, { waitUntil: "load" });
    assert.equal(new URL(page.url()).pathname, `${base}/`);
    assert.equal(response.status(), 200);
    await page.close();
  });
});
