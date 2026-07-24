import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { requestPublicJson, resolvePublicDestination } from "../public-http-request.js";

describe("public HTTP request security", () => {
  it.each([
    "http://127.0.0.1/secrets",
    "http://2130706433/secrets",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.1/internal",
    "http://[::1]/secrets",
    "file:///etc/passwd",
    "http://user:password@example.com/",
  ])("rejects unsafe destination %s", async (url) => {
    await expect(resolvePublicDestination(url)).rejects.toThrow(/globally routable public addresses/);
  });

  it("fails closed when any resolved address is not public", async () => {
    await expect(
      resolvePublicDestination("https://agent.example/run", async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.4", family: 4 },
      ])
    ).rejects.toThrow(/globally routable public addresses/);
  });

  it("pins a validated public destination", async () => {
    await expect(
      resolvePublicDestination("https://agent.example/run", async () => [{ address: "93.184.216.34", family: 4 }])
    ).resolves.toMatchObject({
      address: "93.184.216.34",
      family: 4,
    });
  });

  describe("real HTTP request", () => {
    let server: Server;
    let port: number;
    let hits = 0;

    beforeAll(async () => {
      server = createServer((_request, response) => {
        hits += 1;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ secret: true }));
      });
      await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address();
      port = typeof address === "object" && address ? address.port : 0;
    });

    afterAll(async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    });

    it("blocks loopback before opening a connection", async () => {
      await expect(
        requestPublicJson(`http://127.0.0.1:${port}/secrets`, {
          method: "POST",
          body: "{}",
        })
      ).rejects.toThrow(/globally routable public addresses/);
      expect(hits).toBe(0);
    });
  });
});
