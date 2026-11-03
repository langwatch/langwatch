import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const SYNC = fileURLToPath(new URL("../sync.ts", import.meta.url));
let server: Server | undefined;

afterEach(() => new Promise((done) => (server ? server.close(done) : done(undefined))));

describe("sync --dry-run", () => {
  it("only reads: an empty project would get creates, and none is sent", async () => {
    const methods: string[] = [];
    server = createServer((request, response) => {
      methods.push(request.method ?? "");
      const url = request.url ?? "";
      const body = url.startsWith("/api/v1/agents")
        ? {
            data: [{ id: "agent_1", name: "langy", type: "connected" }],
            pagination: { totalPages: 1 },
          }
        : [];
      response.setHeader("content-type", "application/json").end(JSON.stringify(body));
    });
    await new Promise<void>((ready) => server!.listen(0, "127.0.0.1", ready));
    const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const { stdout } = await promisify(execFile)(process.execPath, [SYNC, "--dry-run"], {
      env: {
        PATH: process.env.PATH,
        LANGWATCH_ENDPOINT: endpoint,
        LANGWATCH_API_KEY: "key",
        LANGWATCH_PROJECT_ID: "project",
      },
    });

    expect(stdout).toContain("+ scenario");
    expect(methods.length).toBeGreaterThan(0);
    expect(new Set(methods)).toEqual(new Set(["GET"]));
  });
});
