/**
 * The channel reads a body only for a successful picture answer, and only up to its size limit.
 * Covers @unit scenarios from specs/security/image-proxy-response-hardening.feature.
 */
import http from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ExternalImageTooLargeError } from "../../external-image.channel.ts";
import { HttpExternalImageChannel } from "../http.external-image.channel.ts";

const MAX_BYTES = 1024;
const CHUNK = Buffer.alloc(512, 1);

/** Sends chunks until the reader goes away, and reports how many bytes left the server. */
function endless(res: http.ServerResponse, headers: http.OutgoingHttpHeaders, status = 200): void {
  res.writeHead(status, headers);
  const timer = setInterval(() => {
    sent += CHUNK.byteLength;
    res.write(CHUNK);
  }, 5);
  res.on("close", () => {
    clearInterval(timer);
    closed += 1;
  });
}

let server: http.Server;
let sent = 0;
let closed = 0;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    switch (req.url) {
      case "/small.png":
        return res.writeHead(200, { "content-type": "image/png" }).end(CHUNK);
      case "/declared-large.png":
        return endless(res, { "content-type": "image/png", "content-length": MAX_BYTES + 1 });
      case "/undeclared-large.png":
        return endless(res, { "content-type": "image/png" });
      case "/page":
        return endless(res, { "content-type": "text/html" });
      default:
        return endless(res, { "content-type": "image/png" }, 404);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

const fetched = (path: string) => {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server is not listening");
  sent = 0;
  closed = 0;

  return HttpExternalImageChannel.create({
    policy: { blockLocal: false, allowedHosts: [], verifyTls: true },
    maxBytes: MAX_BYTES,
  }).fetch(`http://127.0.0.1:${address.port}${path}`);
};

async function untilClosed(): Promise<void> {
  await expect.poll(() => closed).toBe(1);
}

describe("HttpExternalImageChannel.fetch", () => {
  describe("given a picture within the size limit", () => {
    it("answers its bytes", async () => {
      const answer = await fetched("/small.png");

      expect(answer.contentType).toBe("image/png");
      expect(await answer.bytes()).toEqual(new Uint8Array(CHUNK));
    });
  });

  describe("given a picture that declares a length over the size limit", () => {
    /** @scenario "A picture that declares a size over the limit is refused unread" */
    it("refuses it from the headers and drops the connection", async () => {
      await expect(fetched("/declared-large.png")).rejects.toBeInstanceOf(
        ExternalImageTooLargeError,
      );
      await untilClosed();
    });
  });

  describe("given a picture that declares no length and never ends", () => {
    /** @scenario "A picture that grows past the limit without declaring a size is cut off" */
    it("stops reading once the limit is passed and drops the connection", async () => {
      await expect(fetched("/undeclared-large.png")).rejects.toBeInstanceOf(
        ExternalImageTooLargeError,
      );
      await untilClosed();
      expect(sent).toBeLessThan(MAX_BYTES * 20);
    });
  });

  describe("given an answer that is not a picture", () => {
    /** @scenario "A response that is not a picture is refused without reading its body" */
    it("answers the media type with no bytes and drops the connection", async () => {
      const answer = await fetched("/page");

      expect(answer.contentType).toBe("text/html");
      expect(await answer.bytes()).toHaveLength(0);
      await untilClosed();
    });
  });

  describe("given an outside refusal", () => {
    it("answers the status without reading its body", async () => {
      const answer = await fetched("/gone");

      expect(answer.status).toBe(404);
      expect(await answer.bytes()).toHaveLength(0);
      await untilClosed();
    });
  });
});
