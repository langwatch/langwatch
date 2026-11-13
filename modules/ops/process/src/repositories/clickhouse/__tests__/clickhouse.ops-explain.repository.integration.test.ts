/**
 * @vitest-environment node
 * A local HTTP server stands in for ClickHouse and records who each EXPLAIN logs in as,
 * from the Basic credentials the driver sends.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PASSWORD_FILE_REFRESH_MS } from "@langwatch/process-stores/clickhouse-password-file";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  OpsClickHouseRuntime,
  OpsExplainClickHouseRepository,
} from "../clickhouse.ops-explain.repository.ts";

function loginOf(authorization: string | undefined): string {
  if (!authorization?.startsWith("Basic ")) return "";
  return Buffer.from(authorization.slice("Basic ".length), "base64").toString("utf8");
}

describe("given the ops ClickHouse client in front of a server that records logins", () => {
  let server: Server;
  let host: string;
  let logins: string[];
  let root: string;
  let passwordPath: string;

  beforeEach(async () => {
    logins = [];
    root = mkdtempSync(join(tmpdir(), "clickhouse-ops-password-file-"));
    passwordPath = join(root, "password");
    server = createServer((request, response) => {
      logins.push(loginOf(request.headers.authorization));
      request.resume();
      request.on("end", () => {
        response.setHeader("Content-Type", "application/x-ndjson");
        response.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("No port was bound.");
    host = `127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(root, { recursive: true, force: true });
  });

  const explainingThrough = async ({
    url,
    passwordFile,
    use,
  }: {
    url: string;
    passwordFile?: string;
    use: (explain: () => Promise<unknown>) => Promise<void>;
  }) => {
    const runtime = OpsClickHouseRuntime.create({ url, passwordFile, buildTime: false });
    const repository = OpsExplainClickHouseRepository.create({ resolver: runtime });
    try {
      await use(() => {
        const resolution = repository.findClient();
        if (!resolution) throw new Error("the ops client was not configured");
        return repository.runExplain({
          client: resolution.client,
          wrappedQuery: "EXPLAIN SELECT 1",
        });
      });
    } finally {
      await runtime.close();
    }
  };

  describe("when CLICKHOUSE_OPS_PASSWORD_FILE is not set", () => {
    /** @scenario "Without an ops password file the ops client logs in with the URL's credentials" */
    it("logs in with the URL's user and password", async () => {
      await explainingThrough({
        url: `http://langwatch_ops:url-password@${host}/langwatch`,
        use: async (explain) => {
          await explain();
        },
      });

      expect(logins).toEqual(["langwatch_ops:url-password"]);
    });
  });

  describe("when CLICKHOUSE_OPS_PASSWORD_FILE names a file", () => {
    /** @scenario "With an ops password file the ops client logs in with the file's password" */
    it("logs in with the URL's user and the file's password", async () => {
      writeFileSync(passwordPath, "file-password\n");

      await explainingThrough({
        url: `http://langwatch_ops:stale-password@${host}/langwatch`,
        passwordFile: passwordPath,
        use: async (explain) => {
          await explain();
        },
      });

      expect(logins).toEqual(["langwatch_ops:file-password"]);
    });

    /** @scenario "A rotated ops password reaches the next EXPLAIN without a restart" */
    it("logs in with a rotated password once the refresh window has passed", async () => {
      writeFileSync(passwordPath, "first-password");

      await explainingThrough({
        url: `http://langwatch_ops@${host}/langwatch`,
        passwordFile: passwordPath,
        use: async (explain) => {
          await explain();
          writeFileSync(passwordPath, "second-password");
          await new Promise((resolve) => setTimeout(resolve, PASSWORD_FILE_REFRESH_MS + 100));
          await explain();
        },
      });

      expect(logins).toEqual(["langwatch_ops:first-password", "langwatch_ops:second-password"]);
    });
  });
});
