/**
 * @vitest-environment node
 * A local HTTP server stands in for ClickHouse and records who each statement logs in as,
 * from the Basic credentials the driver sends.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildClickHouse } from "../clickhouse-member.ts";
import { PASSWORD_FILE_REFRESH_MS } from "../clickhouse-password-file.ts";
import type { ClickHouseConfig } from "../config.ts";
import { buildClickHouseAdmin } from "../store-targets.ts";

const directory = { organizationForTenant: () => Promise.resolve("organization-1") };

function loginOf(authorization: string | undefined): string {
  if (!authorization?.startsWith("Basic ")) return "";
  return Buffer.from(authorization.slice("Basic ".length), "base64").toString("utf8");
}

describe("given the ClickHouse member in front of a server that records logins", () => {
  let server: Server;
  let host: string;
  let logins: string[];
  let root: string;
  let passwordPath: string;

  beforeEach(async () => {
    logins = [];
    root = mkdtempSync(join(tmpdir(), "clickhouse-password-file-"));
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

  const withMember = async (
    config: ClickHouseConfig,
    use: (send: () => Promise<unknown>) => Promise<void>,
  ) => {
    const member = buildClickHouse({ config, directory });
    try {
      await use(() =>
        member.value.query({
          tenantId: "project-1",
          sql: "SELECT 1",
          // A login probe that reads no table, so it has no tenant rows to scope.
          SKIP_TENANT_CHECK: true,
        }),
      );
    } finally {
      await member.close?.();
    }
  };

  describe("when CLICKHOUSE_PASSWORD_FILE is not set", () => {
    /** @scenario "Without a password file the client logs in with the URL's credentials" */
    it("logs in with the URL's user and password", async () => {
      await withMember({ url: `http://app:url-password@${host}/langwatch` }, async (send) => {
        await send();
      });

      expect(logins).toEqual(["app:url-password"]);
    });
  });

  describe("when CLICKHOUSE_PASSWORD_FILE names a file", () => {
    /** @scenario "With a password file every statement logs in with the file's password" */
    it("logs in with the URL's user and the file's password", async () => {
      writeFileSync(passwordPath, "file-password\n");

      await withMember(
        { url: `http://app:stale-password@${host}/langwatch`, passwordFile: passwordPath },
        async (send) => {
          await send();
        },
      );

      expect(logins).toEqual(["app:file-password"]);
    });

    /** @scenario "A rotated password reaches the next statement without a restart" */
    it("logs in with a rotated password once the refresh window has passed", async () => {
      writeFileSync(passwordPath, "first-password");

      await withMember(
        { url: `http://app@${host}/langwatch`, passwordFile: passwordPath },
        async (send) => {
          await send();
          writeFileSync(passwordPath, "second-password");
          await new Promise((resolve) => setTimeout(resolve, PASSWORD_FILE_REFRESH_MS + 100));
          await send();
        },
      );

      expect(logins).toEqual(["app:first-password", "app:second-password"]);
    });

    it("logs in as default when the URL names no user", async () => {
      writeFileSync(passwordPath, "file-password");

      await withMember({ url: `http://${host}/langwatch`, passwordFile: passwordPath }, (send) =>
        send().then(() => undefined),
      );

      expect(logins).toEqual(["default:file-password"]);
    });

    /** @scenario "A private route keeps its own credentials" */
    it("leaves a private route's own credentials alone", async () => {
      writeFileSync(passwordPath, "file-password");

      await withMember(
        {
          url: `http://app@${host}/langwatch`,
          passwordFile: passwordPath,
          privateRoutes: [
            { organizationId: "organization-1", url: `http://tenant:tenant-password@${host}/db` },
          ],
        },
        async (send) => {
          await send();
        },
      );

      expect(logins).toEqual(["tenant:tenant-password"]);
    });

    it("logs the untenanted admin seam in with the file's password too", async () => {
      writeFileSync(passwordPath, "file-password");
      const admin = buildClickHouseAdmin({
        url: `http://app:stale-password@${host}/langwatch`,
        passwordFile: passwordPath,
      });
      try {
        if (!admin.value.configured) throw new Error("the admin seam was not configured");
        await admin.value.statements.command("SELECT 1");
      } finally {
        await admin.close?.();
      }

      expect(logins).toEqual(["app:file-password"]);
    });
  });
});
