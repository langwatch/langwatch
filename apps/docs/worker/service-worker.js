const VERSION = "__DOCS_VERSION__";
const PRECACHE = [];
const STATIC = `lw-docs-static-${VERSION}`;
const PAGES = `lw-docs-pages-${VERSION}`;
const MAX_AGE = 60_000;
const PAGE_LIMIT = 40;
const STATIC_LIMIT = 60;
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;
const BASE = new URL(self.registration.scope).pathname;
const OFFLINE = `${BASE}offline.html`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("lw-docs-") && key !== STATIC && key !== PAGES)
            .map((key) => caches.delete(key)),
        ),
      ),
  );
});

/** The one query the worker caches: this build's search index, `?v=<VERSION>`; one at most. */
function isVersionedIndex({ url }) {
  if (url.pathname !== `${BASE}search-index.json`) return false;
  const keys = [...url.searchParams.keys()];
  return keys.length === 1 && url.searchParams.get("v") === VERSION;
}

function cacheable({ request, url }) {
  return (
    request.method === "GET" &&
    url.origin === self.location.origin &&
    url.pathname.startsWith(BASE) &&
    (!url.search || isVersionedIndex({ url })) &&
    !request.headers.has("authorization") &&
    !request.headers.has("x-auth-token") &&
    !request.headers.has("range") &&
    !url.pathname.startsWith("/api/") &&
    !url.pathname.startsWith("/trpc/")
  );
}

function storable({ response }) {
  const size = Number(response.headers.get("content-length") ?? 0);
  return (
    response.ok &&
    response.status === 200 &&
    size <= MAX_ENTRY_BYTES &&
    !/no-store|private/i.test(response.headers.get("cache-control") ?? "")
  );
}

async function cached({ name, request }) {
  try {
    return await (await caches.open(name)).match(request);
  } catch {
    return undefined;
  }
}

/** Writes are best effort: a full quota or a storage error never fails the network response. */
async function put({ name, request, response, limit }) {
  try {
    const cache = await caches.open(name);
    await cache.put(request, response);
    const keys = (await cache.keys()).filter((key) => {
      const url = new URL(key.url);
      return !PRECACHE.includes(url.pathname) && !isVersionedIndex({ url });
    });
    await Promise.all(
      keys.slice(0, Math.max(0, keys.length - limit)).map((key) => cache.delete(key)),
    );
  } catch {
    /* Storage is optional. */
  }
}

async function storePage({ request, response }) {
  if (!storable({ response })) return;
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("text/html") && !type.includes("application/json")) return;
  const headers = new Headers(response.headers);
  headers.set("x-docs-cached-at", String(Date.now()));
  const body = await response.arrayBuffer();
  if (body.byteLength > MAX_ENTRY_BYTES) return;
  await put({
    name: PAGES,
    request,
    response: new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    }),
    limit: PAGE_LIMIT,
  });
}

async function pageResponse({ event }) {
  const stored = await cached({ name: PAGES, request: event.request });
  const network = fetch(event.request);
  event.waitUntil(
    network
      .then((response) => storePage({ request: event.request, response: response.clone() }))
      .catch(() => {}),
  );
  const age = Date.now() - Number(stored?.headers.get("x-docs-cached-at") ?? 0);
  if (stored && age < MAX_AGE) return stored;
  try {
    return await network;
  } catch {
    return stored ?? (await cached({ name: STATIC, request: OFFLINE })) ?? Response.error();
  }
}

/** Hashed assets, precached files and fonts; a Latin-ext face is cached once a page needs it. */
async function assetResponse({ event }) {
  const stored = await cached({ name: STATIC, request: event.request });
  if (stored) return stored;
  const response = await fetch(event.request);
  if (storable({ response }))
    event.waitUntil(
      put({
        name: STATIC,
        request: event.request,
        response: response.clone(),
        limit: STATIC_LIMIT,
      }),
    );
  return response;
}

function isAsset({ url }) {
  const { pathname } = url;
  if (PRECACHE.includes(pathname) || isVersionedIndex({ url })) return true;
  return pathname.startsWith(`${BASE}assets/`) || pathname.startsWith(`${BASE}fonts/`);
}

function isPage({ request, url }) {
  if (request.mode === "navigate") return true;
  return (
    url.pathname === `${BASE}search-index.json` || request.headers.get("accept") === "text/html"
  );
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (!cacheable({ request: event.request, url })) return;
  if (isAsset({ url })) event.respondWith(assetResponse({ event }));
  else if (isPage({ request: event.request, url })) event.respondWith(pageResponse({ event }));
});
