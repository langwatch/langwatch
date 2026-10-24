/**
 * @vitest-environment node
 * The image proxy door: the service's answer written as the HTTP response, with stored-object's
 * read headers on every answer.
 */
import { STORED_OBJECT_RESPONSE_BASE_HEADERS } from "@langwatch/api/rest";
import { describe, expect, it } from "vitest";

import { imageProxyResponseOf } from "../stored-object-image-proxy.rest.ts";

const PNG = new Uint8Array([137, 80, 78, 71]);

describe("imageProxyResponseOf", () => {
  describe("when the service answers a picture", () => {
    /** @scenario "A picture answer carries its own headers over stored-object's read headers" */
    it("writes its status, bytes and headers over the read headers", async () => {
      const response = imageProxyResponseOf({
        kind: "image",
        status: 200,
        body: PNG,
        headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=31536000" },
      });

      expect(response.status).toBe(200);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
      expect(response.headers.get("content-type")).toBe("image/png");
      expect(response.headers.get("cache-control")).toBe("public, max-age=31536000");
      for (const [name, value] of Object.entries(STORED_OBJECT_RESPONSE_BASE_HEADERS)) {
        if (name.toLowerCase() === "content-type") continue;
        expect(response.headers.get(name)).toBe(value);
      }
    });
  });

  describe("when the service answers a refusal", () => {
    /** @scenario "A picture over the size limit is refused rather than relayed" */
    it("writes the status and `{ error }` as JSON with the read headers", async () => {
      const response = imageProxyResponseOf({
        kind: "refused",
        status: 413,
        error: "Image is too large",
      });

      expect(response.status).toBe(413);
      expect(response.headers.get("content-type")).toBe("application/json");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(await response.text()).toBe('{"error":"Image is too large"}');
    });
  });
});
