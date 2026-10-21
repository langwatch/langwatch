/**
 * The proxy's media type is bare and its disposition filename is sanitised.
 * Covers @unit scenarios from specs/security/image-proxy-response-hardening.feature.
 */
import { describe, expect, it } from "vitest";

import {
  type ExternalImageResponse,
  ExternalImageTooLargeError,
} from "../../channels/external-image.channel.ts";
import { MemoryExternalImageChannel } from "../../channels/memory/memory.external-image.channel.ts";
import type { ImageProxyAnswer } from "../../rules/image-proxy-answer.rules.ts";
import { ImageProxyService } from "../image-proxy.service.ts";

const BYTES = new Uint8Array([137, 80, 78, 71]);

const upstream = (contentType: string): ExternalImageResponse => ({
  ok: true,
  status: 200,
  statusText: "OK",
  contentType,
  bytes: async () => BYTES,
});

/** The headers of an image answer; a refusal fails the test that expected a picture. */
const imageHeaders = (answer: ImageProxyAnswer): Readonly<Record<string, string>> => {
  if (answer.kind !== "image") throw new Error(`expected an image, got ${answer.kind}`);
  return answer.headers;
};

const proxied = (url: string, contentType: string) =>
  ImageProxyService.create({
    images: MemoryExternalImageChannel.create({ [url]: upstream(contentType) }),
  }).proxy({ url });

describe("ImageProxyService.proxy", () => {
  describe("given an upstream host that answers with a PNG and a charset parameter", () => {
    describe("when a browser loads that image through the proxy", () => {
      /** @scenario "A proxied image keeps its own media type and stays cacheable" */
      it("names the media type without the parameters and stays cacheable", async () => {
        const answer = await proxied("https://host.test/logo.png", "image/PNG; charset=binary");

        expect(answer.status).toBe(200);
        expect(imageHeaders(answer)["Content-Type"]).toBe("image/png");
        expect(imageHeaders(answer)["Cache-Control"]).toBe("public, max-age=31536000");
        expect(imageHeaders(answer)["Content-Disposition"]).toBe('inline; filename="logo.png"');
      });
    });
  });

  describe("given an upstream host that answers with a scriptable picture type", () => {
    describe("when a browser loads that image through the proxy", () => {
      it("relays the bytes as an opaque download", async () => {
        const answer = await proxied("https://host.test/logo.svg", "image/svg+xml");

        expect(imageHeaders(answer)["Content-Type"]).toBe("application/octet-stream");
      });
    });
  });

  describe("given a requested URL whose last path segment carries quotes and separators", () => {
    describe("when a browser loads that image through the proxy", () => {
      /** @scenario "A proxied filename cannot inject a response header" */
      it("holds only filename-safe characters in the disposition filename", async () => {
        const url = 'https://host.test/a"; x=y\r\nSet-Cookie: s=1';
        const answer = await proxied(url, "image/png");

        const disposition = imageHeaders(answer)["Content-Disposition"] ?? "";
        expect(disposition).toMatch(/^inline; filename="[A-Za-z0-9._-]+"$/);
        expect(disposition).not.toContain("Set-Cookie:");
      });

      /** @scenario "A proxied filename cannot inject a response header" */
      it("falls back to a fixed name when the URL names no file", async () => {
        const answer = await proxied("https://host.test/", "image/png");

        expect(imageHeaders(answer)["Content-Disposition"]).toBe('inline; filename="image"');
      });
    });
  });

  describe("given an upstream host that answers with a picture over the size limit", () => {
    describe("when a browser loads that image through the proxy", () => {
      /** @scenario "A picture over the size limit is refused rather than relayed" */
      it("answers 413 with its refusal", async () => {
        const answer = await ImageProxyService.create({
          images: {
            fetch: async () => {
              throw new ExternalImageTooLargeError();
            },
          },
        }).proxy({ url: "https://host.test/huge.png" });

        expect(answer).toEqual({ kind: "refused", status: 413, error: "Image is too large" });
      });
    });
  });
});
