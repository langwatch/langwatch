import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

type Listener = (event: FakeEvent) => void;
type FakeEvent = {
  request: Request;
  respondWith: (response: Promise<Response>) => void;
  waitUntil: (work: Promise<unknown>) => void;
};

class FakeCache {
  entries = new Map<string, Response>();
  constructor(private readonly full: boolean) {}
  async put(request: Request | string, response: Response) {
    if (this.full) throw new DOMException("Quota exceeded", "QuotaExceededError");
    const url = typeof request === "string" ? request : request.url;
    this.entries.delete(url);
    this.entries.set(url, response);
  }
  async match(request: Request | string) {
    const url = new URL(typeof request === "string" ? request : request.url, ORIGIN).href;
    return this.entries.get(url)?.clone();
  }
  async keys() {
    return [...this.entries.keys()].map((url) => new Request(url));
  }
  async delete(request: Request) {
    return this.entries.delete(request.url);
  }
  async addAll(urls: string[]) {
    for (const url of urls) await this.put(new URL(url, ORIGIN).href, new Response(url));
  }
}

const ORIGIN = "https://app.example";

async function startWorker({ scope = "/docs/", full = false, precache = [] as string[] } = {}) {
  const source = (await readFile(new URL("../service-worker.js", import.meta.url), "utf8"))
    .replace("__DOCS_VERSION__", "test")
    .replace("const PRECACHE = [];", `const PRECACHE = ${JSON.stringify(precache)};`);
  const stores = new Map<string, FakeCache>();
  const listeners = new Map<string, Listener>();
  const fetched: string[] = [];
  const network = { online: true };
  const caches = {
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new FakeCache(full));
      return stores.get(name)!;
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
  };
  const fetch = async (request: Request) => {
    const url = new URL(request.url);
    if (!network.online) throw new TypeError("Failed to fetch");
    fetched.push(url.pathname + url.search);
    const type = request.url.includes("/fonts/") ? "font/woff2" : "text/html";
    return new Response(`body of ${request.url}`, { headers: { "content-type": type } });
  };
  const self = {
    registration: { scope: `${ORIGIN}${scope}` },
    location: new URL(ORIGIN),
    addEventListener: (name: string, listener: Listener) => listeners.set(name, listener),
    skipWaiting: async () => {},
  };
  runInNewContext(source, { self, caches, fetch, URL, Request, Response, Headers, Date });

  async function request({ path, mode = "navigate" }: { path: string; mode?: string }) {
    const pending: Promise<unknown>[] = [];
    let response: Promise<Response> | undefined;
    const request = new Request(`${ORIGIN}${path}`);
    Object.defineProperty(request, "mode", { value: mode });
    listeners.get("fetch")!({
      request,
      respondWith: (value) => (response = value),
      waitUntil: (work) => pending.push(work),
    });
    const result = await response;
    await Promise.all(pending);
    return result;
  }
  return { request, stores, fetched, caches, network };
}

describe("documentation service worker", () => {
  describe("when storage is full", () => {
    /** @scenario "Keep a network response when the offline cache cannot store it" */
    it("still returns the fetched page and asset", async () => {
      const worker = await startWorker({ full: true });
      const page = await worker.request({ path: "/docs/guide" });
      const asset = await worker.request({ path: "/docs/assets/app.js", mode: "no-cors" });
      expect(await page?.text()).toBe(`body of ${ORIGIN}/docs/guide`);
      expect(await asset?.text()).toBe(`body of ${ORIGIN}/docs/assets/app.js`);
    });
  });

  describe("when a request is outside the worker's base path", () => {
    /** @scenario "Keep a network response when the offline cache cannot store it" */
    it("leaves it to the browser", async () => {
      const worker = await startWorker();
      expect(await worker.request({ path: "/settings" })).toBeUndefined();
      expect(await worker.request({ path: "/api/traces" })).toBeUndefined();
    });
  });

  describe("when many pages and assets are visited", () => {
    /** @scenario "Keep a network response when the offline cache cannot store it" */
    it("keeps the runtime caches within their limits but never drops precached files", async () => {
      const worker = await startWorker({ scope: "/", precache: ["/offline.html"] });
      await (await worker.caches.open("lw-docs-static-test")).addAll(["/offline.html"]);
      for (let index = 0; index < 45; index++) await worker.request({ path: `/page-${index}` });
      for (let index = 0; index < 65; index++)
        await worker.request({ path: `/assets/chunk-${index}.js`, mode: "no-cors" });
      const pages = await worker.stores.get("lw-docs-pages-test")!.keys();
      const assets = await worker.stores.get("lw-docs-static-test")!.keys();
      expect(pages).toHaveLength(40);
      expect(pages[0]?.url).toBe(`${ORIGIN}/page-5`);
      expect(assets.map((key) => new URL(key.url).pathname)).toContain("/offline.html");
      expect(assets).toHaveLength(61);
    });
  });

  describe("when a page asks for the Latin-ext reading font", () => {
    /** @scenario "Keep a network response when the offline cache cannot store it" */
    it("caches the face on first use and serves it from the cache afterwards", async () => {
      const worker = await startWorker();
      const path = "/docs/fonts/Inter-Variable-latin-ext.woff2";
      await worker.request({ path, mode: "cors" });
      await worker.request({ path, mode: "cors" });
      expect(worker.fetched.filter((fetched) => fetched === path)).toHaveLength(1);
    });
  });

  describe("when search reopens offline after loading this build's index", () => {
    it("serves the versioned index from the cache", async () => {
      const worker = await startWorker();
      const path = "/docs/search-index.json?v=test";
      await worker.request({ path, mode: "cors" });
      worker.network.online = false;
      const offline = await worker.request({ path, mode: "cors" });
      expect(await offline?.text()).toBe(`body of ${ORIGIN}${path}`);
    });
  });

  describe("when a query is anything but the build-versioned index", () => {
    it("leaves the request to the browser", async () => {
      const worker = await startWorker();
      const paths = [
        "/docs/search-index.json?v=test&q=secret",
        "/docs/search-index.json?q=secret",
        "/docs/search-index.json?v=../../x",
        "/docs/guide?v=test",
      ];
      for (const path of paths) expect(await worker.request({ path })).toBeUndefined();
    });
  });

  describe("when search asks for indices from many other builds", () => {
    it("caches none of them, so only this build's index is ever stored", async () => {
      const worker = await startWorker();
      for (let build = 0; build < 20; build++)
        await worker.request({ path: `/docs/search-index.json?v=old-${build}`, mode: "cors" });
      await worker.request({ path: "/docs/search-index.json?v=test", mode: "cors" });
      const stored = await Promise.all(
        [...worker.stores.values()].map(async (cache) => cache.keys()),
      );
      const indices = stored.flat().filter((key) => key.url.includes("search-index.json"));
      expect(indices.map((key) => new URL(key.url).search)).toEqual(["?v=test"]);
    });
  });
});
