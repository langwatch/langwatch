import { createServer, type Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RawHttpHost, RawHttpProtocol } from "../raw-http.ts";

type EndpointApp = Readonly<{ name: string }>;

const closed: string[] = [];

const endpointDoor = RawHttpProtocol.create<EndpointApp>({
  paths: ["/mcp", "/sse"],
  prefixes: ["/.well-known/oauth-protected-resource"],
  open: (app) => ({
    handle: ({ request, response }) => {
      if (request.url === "/sse") throw new Error("the stream failed");
      response.writeHead(200, { "Content-Type": "text/plain" }).end(`${app.name} ${request.url}`);
    },
    close: async () => {
      closed.push(app.name);
    },
  }),
});

describe("RawHttpHost", () => {
  const host = RawHttpHost.create();
  let server: Server;
  let origin = "";

  beforeAll(async () => {
    host.mount(endpointDoor, () => ({ name: "endpoint" }));
    server = createServer(
      host.ahead((_request, response) => {
        response.writeHead(404, { "Content-Type": "text/plain" }).end("routes");
      }),
    );
    await new Promise<void>((listening) => server.listen(0, "127.0.0.1", listening));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no port bound");
    origin = `http://127.0.0.1:${address.port}`;
  });

  afterAll(() => new Promise<void>((stopped) => server.close(() => stopped())));

  describe("given a door claiming exact paths and a prefix", () => {
    /** @scenario "A request on a claimed path is answered by the door ahead of the routes" */
    it("answers claimed paths and everything beneath a prefix from the door", async () => {
      const answers = await Promise.all(
        ["/mcp?session=1", "/.well-known/oauth-protected-resource/mcp"].map(async (path) =>
          (await fetch(`${origin}${path}`)).text(),
        ),
      );

      expect(answers).toEqual([
        "endpoint /mcp?session=1",
        "endpoint /.well-known/oauth-protected-resource/mcp",
      ]);
    });

    it("hands every other path to the routes unchanged", async () => {
      const answers = await Promise.all(
        ["/mcp/elsewhere", "/.well-known/oauth-protected-resourcex"].map(async (path) =>
          (await fetch(`${origin}${path}`)).text(),
        ),
      );

      expect(answers).toEqual(["routes", "routes"]);
    });

    it("answers 500 when the door fails before writing", async () => {
      expect((await fetch(`${origin}/sse`)).status).toBe(500);
    });

    it("refuses a second door claiming a path already claimed", () => {
      const other = RawHttpHost.create();
      other.mount(endpointDoor, () => ({ name: "first" }));

      expect(() => other.mount(endpointDoor, () => ({ name: "second" }))).toThrow(
        'Two raw HTTP doors claim "/mcp".',
      );
    });
  });

  describe("when the process shuts down", () => {
    /** @scenario "Shutdown closes what every raw HTTP door holds open" */
    it("closes every mounted door once", async () => {
      await host.close();
      await host.close();

      expect(closed).toEqual(["endpoint"]);
    });
  });
});
