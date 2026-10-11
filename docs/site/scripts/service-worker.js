const VERSION = "__DOCS_VERSION__";
const PRECACHE = [];
const STATIC = `lw-docs-static-${VERSION}`;
const PAGES = `lw-docs-pages-${VERSION}`;
const MAX_AGE = 60_000;
const LIMIT = 40;

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

function cacheable({ request, url }) {
  return (
    request.method === "GET" &&
    url.origin === self.location.origin &&
    !url.search &&
    !request.headers.has("authorization") &&
    !request.headers.has("x-auth-token") &&
    !url.pathname.startsWith("/api/") &&
    !url.pathname.startsWith("/trpc/")
  );
}

async function storePage({ cache, request, response }) {
  if (!response.ok || /no-store|private/i.test(response.headers.get("cache-control") ?? "")) return;
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("text/html") && !type.includes("application/json")) return;
  const headers = new Headers(response.headers);
  headers.set("x-docs-cached-at", String(Date.now()));
  await cache.put(
    request,
    new Response(await response.clone().arrayBuffer(), {
      status: response.status,
      statusText: response.statusText,
      headers,
    }),
  );
  const keys = await cache.keys();
  await Promise.all(
    keys.slice(0, Math.max(0, keys.length - LIMIT)).map((key) => cache.delete(key)),
  );
}

async function pageResponse({ event }) {
  const cache = await caches.open(PAGES);
  const cached = await cache.match(event.request);
  const refresh = fetch(event.request).then(async (response) => {
    await storePage({ cache, request: event.request, response });
    return response;
  });
  event.waitUntil(refresh.catch(() => {}));
  const age = Date.now() - Number(cached?.headers.get("x-docs-cached-at") ?? 0);
  if (cached && age < MAX_AGE) return cached;
  try {
    return await refresh;
  } catch {
    return cached ?? (await caches.match("/offline.html")) ?? Response.error();
  }
}

async function assetResponse({ request }) {
  const cache = await caches.open(STATIC);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && !/no-store|private/i.test(response.headers.get("cache-control") ?? ""))
    await cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (!cacheable({ request: event.request, url })) return;
  if (url.pathname.startsWith("/assets/") || PRECACHE.includes(url.pathname)) {
    event.respondWith(assetResponse({ request: event.request }));
  } else if (
    event.request.mode === "navigate" ||
    url.pathname === "/search-index.json" ||
    event.request.headers.get("accept") === "text/html"
  ) {
    event.respondWith(pageResponse({ event }));
  }
});
