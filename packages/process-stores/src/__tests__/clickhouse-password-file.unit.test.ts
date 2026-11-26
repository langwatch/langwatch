import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseProcessConfig } from "@langwatch/config";
import { createTestLogger } from "@langwatch/test-harness";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildClickHouse } from "../clickhouse-member.ts";
import {
  ClickHousePasswordFile,
  ClickHousePasswordFileError,
} from "../clickhouse-password-file.ts";
import { storesOwner } from "../config-owner.ts";

const directory = { organizationForTenant: () => Promise.resolve("organization-1") };

describe("ClickHousePasswordFile", () => {
  let root: string;
  let path: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "clickhouse-password-file-"));
    path = join(root, "password");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe("given a file that gives no password at boot", () => {
    const cases: [string, () => void][] = [
      ["is missing", () => undefined],
      ["is empty", () => writeFileSync(path, "  \n")],
      ["is a directory", () => mkdirSync(path)],
    ];

    for (const [label, arrange] of cases) {
      describe(`when the file ${label}`, () => {
        /** @scenario "A password file that cannot be read at boot stops the process" */
        it("fails the build naming the variable and the path", () => {
          arrange();

          const build = () =>
            buildClickHouse({
              config: { url: "http://app@127.0.0.1:1/langwatch", passwordFile: path },
              directory,
            });

          expect(build).toThrow(ClickHousePasswordFileError);
          expect(build).toThrow(
            expect.objectContaining({
              code: "clickhouse_password_file_unreadable",
              variable: "CLICKHOUSE_PASSWORD_FILE",
              path,
            }),
          );
        });
      });
    }
  });

  describe("given a password was read", () => {
    let clock: number;
    const now = () => clock;

    beforeEach(() => {
      clock = 0;
      writeFileSync(path, "first-password\n");
    });

    it("trims the trailing newline a Secret file carries", async () => {
      const file = ClickHousePasswordFile.open({ path, now });
      await expect(file.current()).resolves.toBe("first-password");
    });

    it("keeps the cached password inside the refresh window", async () => {
      const file = ClickHousePasswordFile.open({ path, now, refreshMs: 1_000 });
      writeFileSync(path, "second-password");
      clock = 999;

      await expect(file.current()).resolves.toBe("first-password");
    });

    it("reads a rotated password once the refresh window has passed", async () => {
      const file = ClickHousePasswordFile.open({ path, now, refreshMs: 1_000 });
      writeFileSync(path, "second-password");
      clock = 1_000;

      await expect(file.current()).resolves.toBe("second-password");
    });

    describe("when the file cannot be read at a later refresh", () => {
      /** @scenario "A password file that becomes unreadable keeps the last good password" */
      it("keeps the last good password and warns once, naming the path only", async () => {
        const { logger, lines } = createTestLogger();
        const file = ClickHousePasswordFile.open({ path, now, refreshMs: 1_000, logger });
        rmSync(path);

        clock = 1_000;
        await expect(file.current()).resolves.toBe("first-password");
        clock = 2_000;
        await expect(file.current()).resolves.toBe("first-password");

        const warnings = lines.filter((line) => line.level === 40);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toMatchObject({ path, variable: "CLICKHOUSE_PASSWORD_FILE" });
        expect(JSON.stringify(lines)).not.toContain("first-password");
      });

      it("warns again only after the file was readable in between", async () => {
        const { logger, lines } = createTestLogger();
        const file = ClickHousePasswordFile.open({ path, now, refreshMs: 1_000, logger });

        writeFileSync(path, "");
        clock = 1_000;
        await file.current();
        writeFileSync(path, "second-password");
        clock = 2_000;
        await expect(file.current()).resolves.toBe("second-password");
        rmSync(path);
        clock = 3_000;
        await expect(file.current()).resolves.toBe("second-password");

        expect(lines.filter((line) => line.level === 40)).toHaveLength(2);
      });
    });
  });
});

describe("CLICKHOUSE_PASSWORD_FILE in the stores' configuration", () => {
  const read = (environment: Record<string, string | undefined>) =>
    parseProcessConfig({ owners: [storesOwner], environment }).stores;

  it("reads the path when one is set", () => {
    expect(read({ CLICKHOUSE_PASSWORD_FILE: "/var/run/clickhouse/password" })).toMatchObject({
      clickhousePasswordFile: "/var/run/clickhouse/password",
    });
  });

  /** @scenario "A blank CLICKHOUSE_PASSWORD_FILE is the same as unset" */
  it("treats a blank value as unset", () => {
    expect(read({ CLICKHOUSE_PASSWORD_FILE: " " }).clickhousePasswordFile).toBeUndefined();
  });
});
