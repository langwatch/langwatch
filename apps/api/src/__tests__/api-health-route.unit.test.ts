import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiHealthRoute } from "../api-health-route.ts";

describe("the api's health route", () => {
  it("is mounted at the path operational infrastructure already probes", () => {
    expect(apiHealthRoute.path).toBe("/api/health");
  });

  describe("given it is hosted on a real listener", () => {
    let server: Server;
    let baseURL: string;

    beforeEach(async () => {
      server = createServer((request, response) => apiHealthRoute.handle(request, response));
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const { port } = server.address() as AddressInfo;
      baseURL = `http://127.0.0.1:${port}`;
    });

    afterEach(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it("answers 204 with no body, matching platform/app's own liveness probe", async () => {
      const response = await fetch(baseURL + apiHealthRoute.path);

      expect(response.status).toBe(204);
      await expect(response.text()).resolves.toBe("");
    });
  });
});
