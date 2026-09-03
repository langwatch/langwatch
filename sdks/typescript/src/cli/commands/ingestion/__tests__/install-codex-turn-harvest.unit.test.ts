/**
 * `langwatch ingest install codex` wires the turn harvest, not just telemetry.
 *
 * Codex exports tokens, model and timing and no conversation, so activating
 * capture without asking codex to run the harvest after a turn leaves a
 * scripted setup with traces nobody can read. Running this command explicitly
 * IS the consent, so nothing here asks a question: that is what makes it the
 * path a CI job or a setup script can take.
 *
 * The mint is the only thing faked. The config is a real file behind
 * LANGWATCH_CLI_CONFIG and the codex config.toml the command merges into is a
 * real file in a temp directory.
 *
 * Feature: specs/coding-agent/codex-content-capture.feature
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as CliApiModule from "@/cli/utils/governance/cli-api";

const { mintIngestionKeyMock } = vi.hoisted(() => ({
  mintIngestionKeyMock: vi.fn(),
}));

vi.mock("@/cli/utils/governance/cli-api", async () => {
  const actual = await vi.importActual<typeof CliApiModule>(
    "@/cli/utils/governance/cli-api",
  );
  return { ...actual, mintIngestionKey: mintIngestionKeyMock };
});

/**
 * Every question the command could have asked. A scripted install runs with no
 * terminal, so the honest assertion is that nothing ever reached for one.
 */
const questions: string[] = [];
vi.mock("node:readline", () => ({
  createInterface: () => ({
    question: (q: string, cb: (a: string) => void) => {
      questions.push(q);
      cb("");
    },
    close: () => undefined,
  }),
}));

/** Opening marker of the block asking codex to run the harvest after a turn. */
const NOTIFY_MARKER = "# >>> langwatch codex notify begin >>>";

let tmpDir: string;
let codexConfigPath: string;
let codexHooksPath: string;
let stdoutSpy: ReturnType<typeof vi.spyOn>;
const origConfig = process.env.LANGWATCH_CLI_CONFIG;

const stdout = (): string =>
  stdoutSpy.mock.calls.map((call: unknown[]) => String(call[0])).join("");

const readConfigToml = (): string => fs.readFileSync(codexConfigPath, "utf8");

const runCodexInstall = async (
  overrides: Record<string, unknown> = {},
): Promise<void> => {
  const { installCommand } = await import("../install.js");
  await installCommand("codex", {
    codexConfigPath,
    hooksPath: codexHooksPath,
    ...overrides,
  });
};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-install-harvest-"));
  codexConfigPath = path.join(tmpDir, ".codex", "config.toml");
  codexHooksPath = path.join(tmpDir, ".codex", "hooks.json");

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
  questions.length = 0;
  stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  stdoutSpy.mockRestore();
  if (origConfig === undefined) delete process.env.LANGWATCH_CLI_CONFIG;
  else process.env.LANGWATCH_CLI_CONFIG = origConfig;
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("the codex ingestion install", () => {
  describe("given a machine with no terminal attached", () => {
    describe("when the user runs the install command", () => {
      /** @scenario "Enabling capture from the install command needs no terminal" */
      it("asks codex to run the harvest after every turn, with no question asked", async () => {
        await runCodexInstall();

        expect(readConfigToml()).toContain(NOTIFY_MARKER);
        expect(questions).toHaveLength(0);
      });

      it("reports what it did to the codex configuration", async () => {
        await runCodexInstall();

        expect(stdout()).toContain(
          "Codex will record each turn's conversation as it completes",
        );
      });

      it("carries the harvest action in the json report", async () => {
        await runCodexInstall({ json: true });

        const report = JSON.parse(stdout()) as {
          codex_turn_harvest_action: string;
        };
        expect(report.codex_turn_harvest_action).toBe("installed");
      });
    });

    describe("when the install runs a second time", () => {
      it("leaves exactly one harvest hook behind", async () => {
        await runCodexInstall();
        await runCodexInstall();

        const toml = readConfigToml();
        expect((toml.match(/langwatch codex notify begin/g) ?? []).length).toBe(1);
      });
    });

    describe("when only the exports were asked for", () => {
      it("writes no harvest hook", async () => {
        await runCodexInstall({ envOnly: true });

        expect(fs.existsSync(codexConfigPath)).toBe(false);
      });
    });
  });

  describe("given a configuration binding a turn-completion program that cannot be moved", () => {
    describe("when the user runs the install command", () => {
      it("says the conversation will not be recorded, and still installs the exports", async () => {
        fs.mkdirSync(path.dirname(codexConfigPath), { recursive: true });
        // Two top-level assignments: moving one aside still leaves the other,
        // and a duplicate key stops codex from starting at all.
        fs.writeFileSync(codexConfigPath, 'notify = ["/one"]\nnotify = ["/two"]\n');

        await runCodexInstall();

        expect(stdout()).toContain("will not be recorded");
        expect(readConfigToml()).toContain("[otel]");
        expect(readConfigToml()).not.toContain(NOTIFY_MARKER);
      });

      it("carries the blocked action in the json report", async () => {
        fs.mkdirSync(path.dirname(codexConfigPath), { recursive: true });
        fs.writeFileSync(codexConfigPath, 'notify = ["/one"]\nnotify = ["/two"]\n');

        await runCodexInstall({ json: true });

        const report = JSON.parse(stdout()) as {
          codex_turn_harvest_action: string;
        };
        expect(report.codex_turn_harvest_action).toBe("blocked");
      });
    });
  });
});
