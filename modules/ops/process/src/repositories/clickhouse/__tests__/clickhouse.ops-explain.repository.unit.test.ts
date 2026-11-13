/**
 * The lazily-built client for the dedicated read-only ops ClickHouse account.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clickHouseMocks = vi.hoisted(() => ({
  close: vi.fn(async () => undefined),
  createClient: vi.fn(),
}));

vi.mock("@clickhouse/client", () => ({
  createClient: clickHouseMocks.createClient,
}));

import { OpsClickHouseRuntime } from "../clickhouse.ops-explain.repository.ts";

describe("OpsClickHouseRuntime", () => {
  beforeEach(() => {
    clickHouseMocks.close.mockReset();
    clickHouseMocks.createClient.mockReset();
    clickHouseMocks.createClient.mockReturnValue({ close: clickHouseMocks.close });
  });

  it("returns null when no typed ops endpoint was composed", () => {
    const runtime = OpsClickHouseRuntime.create({ buildTime: false });
    expect(runtime.findClient()).toBeNull();
  });

  it("lazily builds, caches, and closes a typed endpoint client", async () => {
    const runtime = OpsClickHouseRuntime.create({
      url: "http://langwatch_ops:secret@ch.example:8123/langwatch",
      buildTime: false,
    });
    const a = runtime.findClient();
    const b = runtime.findClient();
    expect(a).toEqual({ client: expect.anything(), usingFallback: false });
    expect(b?.client).toBe(a?.client);
    await runtime.close();
    expect(clickHouseMocks.close).toHaveBeenCalledOnce();
    expect(runtime.findClient()).toBeNull();
  });

  it("does not materialize a client during BUILD_TIME", async () => {
    const runtime = OpsClickHouseRuntime.create({
      url: "http://langwatch_ops:secret@ch.example:8123/langwatch",
      buildTime: true,
    });
    expect(runtime.findClient()).toBeNull();
    await runtime.close();
  });

  describe("given CLICKHOUSE_OPS_PASSWORD_FILE names a file that gives no password", () => {
    let root: string;
    let path: string;

    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), "clickhouse-ops-password-file-"));
      path = join(root, "password");
    });

    afterEach(() => {
      rmSync(root, { recursive: true, force: true });
    });

    const cases: [string, () => void][] = [
      ["is missing", () => undefined],
      ["is empty", () => writeFileSync(path, "  \n")],
      ["is a directory", () => mkdirSync(path)],
    ];

    for (const [label, arrange] of cases) {
      describe(`when the file ${label}`, () => {
        /** @scenario "An ops password file that cannot be read at boot stops the process" */
        it("fails the build naming the ops variable and the path", () => {
          arrange();

          const build = () =>
            OpsClickHouseRuntime.create({
              url: "http://langwatch_ops:url-password@ch.example:8123/langwatch",
              passwordFile: path,
              buildTime: false,
            });

          expect(build).toThrow(
            expect.objectContaining({
              code: "clickhouse_password_file_unreadable",
              variable: "CLICKHOUSE_OPS_PASSWORD_FILE",
              path,
            }),
          );
          expect(build).not.toThrow(/url-password/);
        });
      });
    }
  });
});
