import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

import type * as PredepRunner from "../src/predeps/runner.ts";
import type { RuntimeContext } from "../src/shared/runtime-contract.ts";

// `install` once threw away what the predeps resolved, so every service step after it found no
// uv, no app and no binaries ("uv predep not resolved — run install first").

const resolved = vi.hoisted(() => ({
  predeps: {
    uv: { version: "0.9.0", resolvedPath: "/opt/uv", preInstalled: true },
    app: { version: "3.21.0", resolvedPath: "/home/u/.langwatch/app/3.21.0", preInstalled: false },
  },
  home: "",
}));
const installServices = vi.hoisted(() => vi.fn(async (_ctx: RuntimeContext) => {}));

vi.mock("../src/predeps/runner.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof PredepRunner>()),
  runPredeps: vi.fn(async () => resolved.predeps),
}));
vi.mock("../src/services/runtime.ts", () => ({
  runtime: {
    scaffoldEnv: vi.fn(async () => ({ written: false, path: "", reconciledKeys: [] })),
    installServices,
    events: async function* () {},
  },
}));
vi.mock("../src/animation/banner.ts", () => ({ printBanner: () => {} }));
vi.mock("../src/shared/platform.ts", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  assertSupportedHost: () => "darwin-arm64",
}));

const originalArgv = process.argv;
resolved.home = mkdtempSync(join(tmpdir(), "langwatch-cli-install-"));
vi.stubEnv("LANGWATCH_HOME", resolved.home);

afterAll(() => {
  process.argv = originalArgv;
  vi.unstubAllEnvs();
  rmSync(resolved.home, { recursive: true, force: true });
});

describe("the install command", () => {
  describe("when the predeps resolve", () => {
    it("hands what they resolved to the service install", async () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      process.argv = ["node", "langwatch-server", "install", "--yes"];

      // cli.ts is the entry point: importing it parses process.argv and runs the command.
      await import("../src/cli.ts");
      await vi.waitFor(() => expect(installServices).toHaveBeenCalledTimes(1));

      expect(installServices.mock.calls[0]?.[0].predeps).toEqual(resolved.predeps);
    });
  });
});
