/**
 * @vitest-environment node
 * `GET /api/image-proxy` pinned to main's statuses, bodies and cache header.
 */
import { canonicalErrorResponse, createRestRuntime } from "@langwatch/api/rest";
import { describe, expect, it } from "vitest";

import { createStoredObjectTestApp } from "../../app/__tests__/stored-object.fixture.ts";
import type { ExternalImageResponse } from "../../channels/external-image.channel.ts";
import { MemoryExternalImageChannel } from "../../channels/memory/memory.external-image.channel.ts";
import { storedObjectImageProxyRest } from "../stored-object-image-proxy.rest.ts";

const PNG = new Uint8Array([137, 80, 78, 71]);

const answered = (over: Partial<ExternalImageResponse>): ExternalImageResponse => ({
  ok: true,
  status: 200,
  statusText: "OK",
  contentType: "image/png",
  bytes: async () => PNG,
  ...over,
});

function proxy() {
  const images = MemoryExternalImageChannel.create({
    "https://pics.test/cat.png": answered({}),
    "https://pics.test/evil.svg": answered({ contentType: "image/svg+xml" }),
    "https://pics.test/page": answered({ contentType: "text/html" }),
    "https://pics.test/gone": answered({ ok: false, status: 404, statusText: "Not Found" }),
    "https://pics.test/origin-down": answered({ ok: false, status: 520, statusText: "" }),
  });
  const app = createStoredObjectTestApp({ images });
  const runtime = createRestRuntime({
    identity: {
      authenticate: () => {
        throw new Error("The image proxy asks no credential.");
      },
      identify: () => ({ actor: null, scope: null }),
    },
  });
  const hono = runtime.mount(storedObjectImageProxyRest.router(), {
    app: () => app,
    onError: canonicalErrorResponse,
  });

  return (query: string) => hono.fetch(new Request(`http://api.test/api/image-proxy${query}`));
}

const at = (url: string) => `?url=${encodeURIComponent(url)}`;

describe("GET /api/image-proxy", () => {
  /** @scenario "the image proxy serves a picture with a year-long cache" */
  it("serves the picture with its media type, main's cache header and the read headers", async () => {
    const response = await proxy()(at("https://pics.test/cat.png"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
  });

  /** @scenario "Proxied image bytes cannot run script on the product origin" */
  it("sandboxes a relayed SVG, forbids sniffing and leaks no referrer", async () => {
    const response = await proxy()(at("https://pics.test/evil.svg"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  /** @scenario "the image proxy refuses a request that names no address" */
  it("answers 400 Missing url", async () => {
    const response = await proxy()("");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Missing url" });
  });

  /** @scenario "the image proxy refuses an address that is not a picture" */
  it("answers 400 for something other than a picture", async () => {
    const response = await proxy()(at("https://pics.test/page"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "URL does not point to an image" });
  });

  /** @scenario "the image proxy passes on an outside refusal" */
  it("answers the upstream status with main's sentence", async () => {
    const response = await proxy()(at("https://pics.test/gone"));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Failed to fetch image: Not Found" });
  });

  /** @scenario "the image proxy passes on an outside refusal" */
  it("echoes an upstream status no registry names, as main did", async () => {
    const response = await proxy()(at("https://pics.test/origin-down"));

    expect(response.status).toBe(520);
    expect(await response.json()).toEqual({ error: "Failed to fetch image: " });
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  /** @scenario "the image proxy answers 500 when the address cannot be reached" */
  it("answers 500 when the fetch fails", async () => {
    const response = await proxy()(at("http://169.254.169.254/latest"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to fetch image" });
  });
});
