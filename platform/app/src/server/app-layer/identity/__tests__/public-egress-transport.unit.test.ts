/** @vitest-environment node */

/**
 * The pinning agent and the fetch it is handed to have to come from the same
 * undici.
 *
 * Every other test around this guard injects `fetchImpl`, which is right for
 * asking what the guard DECIDES — and it is why nothing noticed that the
 * transport it decides with could not run at all. `pinnedTo` builds its agent
 * from the workspace's undici; the default fetch used to be Node's bundled
 * copy, a different undici, which rejects a foreign dispatcher outright:
 *
 *     TypeError: fetch failed
 *       cause: UND_ERR_INVALID_ARG: invalid onRequestStart method
 *
 * A caller cannot tell that apart from the host being down, so the issuer
 * check reported every identity provider unreachable and the domain proof
 * reported every file missing — on every environment, for as long as the
 * guard has had callers.
 *
 * So this test opens a real socket to a real server and asserts the bytes
 * came back. A fake fetch cannot fail the way the real one did, which is the
 * whole point of not using one here.
 *
 * Corresponds to specs/identity/sso-connection-lifecycle.feature.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pinnedFetch, pinnedTo } from "../public-egress";

let server: Server;
let origin: string;

beforeAll(async () => {
  server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ answered: true }));
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe("the guard's own transport", () => {
  describe("when a pinned dispatcher is handed to the module's fetch", () => {
    it("completes the request rather than refusing the dispatcher", async () => {
      const response = await pinnedFetch(origin, {
        dispatcher: pinnedTo(["127.0.0.1"]),
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ answered: true });
    });

    it("dials the pinned address rather than the one in the url", async () => {
      // The name says one thing and the pin says another; the pin is what a
      // socket is opened to. This is the rebinding property the agent exists
      // for, and it only means anything if the agent is actually in use — a
      // rejected dispatcher would fall back to resolving the name for real
      // and this would fail on DNS instead of proving anything.
      const port = (server.address() as AddressInfo).port;
      const response = await pinnedFetch(
        `http://this-name-does-not-resolve.invalid:${port}`,
        {
          dispatcher: pinnedTo(["127.0.0.1"]),
          redirect: "manual",
          signal: AbortSignal.timeout(5_000),
        },
      );

      expect(response.status).toBe(200);
    });
  });
});
