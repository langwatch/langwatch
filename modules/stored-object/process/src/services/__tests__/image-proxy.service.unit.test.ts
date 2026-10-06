/**
 * The proxy's media type is bare and its disposition filename is sanitised.
 * Covers @unit scenarios from specs/security/image-proxy-response-hardening.feature.
 */
import { describe, expect, it } from "vitest";

import type { ExternalImageResponse } from "../../channels/external-image.channel.ts";
import { MemoryExternalImageChannel } from "../../channels/memory/memory.external-image.channel.ts";
import { ImageProxyService } from "../image-proxy.service.ts";

const BYTES = new Uint8Array([137, 80, 78, 71]);

const upstream = (contentType: string): ExternalImageResponse => ({
  ok: true,
  status: 200,
  statusText: "OK",
  contentType,
  bytes: async () => BYTES,
});

const proxied = (url: string, contentType: string) =>
  ImageProxyService.create({
    images: MemoryExternalImageChannel.create({ [url]: upstream(contentType) }),
  }).proxy({ url });

describe("ImageProxyService.proxy", () => {
  describe("given an upstream host that answers with a PNG and a charset parameter", () => {
    describe("when a browser loads that image through the proxy", () => {
      /** @scenario "A proxied image keeps its own media type and stays cacheable" */
      it("names the media type without the parameters and stays cacheable", async () => {
        const response = await proxied("https://host.test/logo.png", "image/PNG; charset=binary");

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("image/png");
        expect(response.headers.get("cache-control")).toBe("public, max-age=31536000");
        expect(response.headers.get("content-disposition")).toBe('inline; filename="logo.png"');
      });
    });
  });

  describe("given a requested URL whose last path segment carries quotes and separators", () => {
    describe("when a browser loads that image through the proxy", () => {
      /** @scenario "A proxied filename cannot inject a response header" */
      it("holds only filename-safe characters in the disposition filename", async () => {
        const url = 'https://host.test/a"; x=y\r\nSet-Cookie: s=1';
        const response = await proxied(url, "image/png");

        const disposition = response.headers.get("content-disposition") ?? "";
        expect(disposition).toMatch(/^inline; filename="[A-Za-z0-9._-]+"$/);
        expect(disposition).not.toContain("Set-Cookie:");
      });

      /** @scenario "A proxied filename cannot inject a response header" */
      it("falls back to a fixed name when the URL names no file", async () => {
        const response = await proxied("https://host.test/", "image/png");

        expect(response.headers.get("content-disposition")).toBe('inline; filename="image"');
      });
    });
  });
});
