/**
 * `langwatch ingest install pi_cli`: the source type is the argument, the
 * seam is the telemetry extension, and no hook entries land anywhere.
 * Feature: specs/ai-governance/cli-wrappers/pi-extension-install.feature
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as CliApiModule from "@/cli/utils/governance/cli-api";
import { PI_EXTENSION_MARKER } from "@/cli/utils/governance/pi-extension-source";
import { PI_EXTENSION_FILE_NAME } from "@/cli/utils/governance/pi-plugin";

const { mintIngestionKeyMock } = vi.hoisted(() => ({
  mintIngestionKeyMock: vi.fn(),
}));

vi.mock("@/cli/utils/governance/cli-api", async () => {
  const actual = await vi.importActual<typeof CliApiModule>("@/cli/utils/governance/cli-api");
  return { ...actual, mintIngestionKey: mintIngestionKeyMock };
});

let tmpDir: string;
let piExtensionDir: string;
let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;
const saved = {
  config: process.env.LANGWATCH_CLI_CONFIG,
  home: process.env.HOME,
  userprofile: process.env.USERPROFILE,
};

const restore = (name: string, value: string | undefined) => {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
};

/** Every file under the temp home, relative, so a stray hook file shows. */
const filesUnder = (dir: string): string[] =>
  fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
    .sort();

const stdout = (): string =>
  stdoutSpy.mock.calls.map((call: unknown[]) => String(call[0])).join("");

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-install-pi-"));
  process.env.HOME = tmpDir;
  process.env.USERPROFILE = tmpDir;
  piExtensionDir = path.join(tmpDir, ".pi", "agent", "extensions");
  const configPath = path.join(tmpDir, "config.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      access_token: "tok",
      control_plane_url: "http://app.example.com",
      gateway_url: "http://gateway.example.com",
      organization: { id: "o1", slug: "acme" },
    }),
  );
  process.env.LANGWATCH_CLI_CONFIG = configPath;
  mintIngestionKeyMock.mockResolvedValue({
    token: "ik-lw-abc0000000000000_secret",
    prefix: "ik-lw-abc0000000000000",
    endpoint: "http://app.example.com/api/otel",
  });
  stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
});

afterEach(() => {
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
  exitSpy.mockRestore();
  restore("LANGWATCH_CLI_CONFIG", saved.config);
  restore("HOME", saved.home);
  restore("USERPROFILE", saved.userprofile);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("the pi ingestion install", () => {
  describe("when run with the pi_cli source type", () => {
    /** @scenario "Installing for pi takes the plugin arm, never the hook-entries fallback" */
    it("writes the extension and no hook entries anywhere else", async () => {
      const { installCommand } = await import("../install.js");

      await installCommand("pi_cli", { piExtensionDir });

      const extension = fs.readFileSync(path.join(piExtensionDir, PI_EXTENSION_FILE_NAME), "utf8");
      expect(extension.startsWith(PI_EXTENSION_MARKER)).toBe(true);
      expect(filesUnder(tmpDir)).toEqual(
        [path.join(".pi", "agent", "extensions", PI_EXTENSION_FILE_NAME), "config.json"].sort(),
      );
      expect(stdout()).toContain("telemetry extension created");
    });

    it("mints the key under pi_cli and prints pi's ingestion env block", async () => {
      const { installCommand } = await import("../install.js");

      await installCommand("pi_cli", { piExtensionDir });

      expect(mintIngestionKeyMock).toHaveBeenCalledWith(expect.any(Object), "pi_cli");
      expect(stdout()).toContain('export OTEL_EXPORTER_OTLP_PROTOCOL="http/protobuf"');
      expect(stdout()).toContain('export OTEL_RESOURCE_ATTRIBUTES="service.name=pi"');
    });

    it("writes no extension when only the exports were asked for", async () => {
      const { installCommand } = await import("../install.js");

      await installCommand("pi_cli", { piExtensionDir, envOnly: true });

      expect(fs.existsSync(piExtensionDir)).toBe(false);
    });
  });

  describe("when run with the hook spelling `pi`", () => {
    it("refuses it as an unknown tool, as it does `claude` and `copilot`", async () => {
      const { installCommand } = await import("../install.js");

      await installCommand("pi", { piExtensionDir });

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(mintIngestionKeyMock).not.toHaveBeenCalled();
      expect(fs.existsSync(piExtensionDir)).toBe(false);
    });
  });
});
