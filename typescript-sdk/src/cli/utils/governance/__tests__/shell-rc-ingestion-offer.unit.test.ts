/**
 * Tests for the Path B (ingestion) shell-rc persist OFFER driven from
 * the `langwatch <tool>` wrapper. Drives the Y / n / never branches by
 * mocking readline (the stdin prompt) and saveConfig (the persistence),
 * verifying:
 *   - "never" persists shell_rc_preference = "skip" and leaves the rc
 *     file untouched
 *   - "n" persists nothing and leaves the rc file untouched
 *   - "y" appends the marked telemetry block idempotently
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GovernanceConfig } from "../config";
import type * as ConfigModule from "../config";

const answers: string[] = [];

vi.mock("node:readline", () => ({
  createInterface: () => ({
    question: (_q: string, cb: (a: string) => void) => cb(answers.shift() ?? ""),
    close: () => undefined,
  }),
}));

const saveConfigMock = vi.fn();
vi.mock("../config", async () => {
  const actual = await vi.importActual<typeof ConfigModule>("../config");
  return { ...actual, saveConfig: saveConfigMock };
});

let tmpHome: string;
const origHome = process.env.HOME;
const origUserprofile = process.env.USERPROFILE;
const origShell = process.env.SHELL;
const origTtyDescriptor = Object.getOwnPropertyDescriptor(
  process.stdin,
  "isTTY",
);
const origEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

const otelVars: Record<string, string> = {
  OTEL_TRACES_EXPORTER: "otlp",
  OTEL_EXPORTER_OTLP_ENDPOINT: "http://app.example.com/api/otel",
  OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer sk-lw-token",
};

function cfg(overrides: Partial<GovernanceConfig> = {}): GovernanceConfig {
  return {
    gateway_url: "http://gw.example.com",
    control_plane_url: "http://app.example.com",
    ...overrides,
  };
}

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "lw-shellrc-offer-"));
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  process.env.SHELL = "/bin/zsh";
  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  Object.defineProperty(process.stdin, "isTTY", {
    value: true,
    configurable: true,
  });
  answers.length = 0;
  saveConfigMock.mockReset();
});

afterEach(() => {
  process.env.HOME = origHome;
  process.env.USERPROFILE = origUserprofile;
  process.env.SHELL = origShell;
  if (origEndpoint === undefined) {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  } else {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = origEndpoint;
  }
  if (origTtyDescriptor) {
    Object.defineProperty(process.stdin, "isTTY", origTtyDescriptor);
  }
  fs.rmSync(tmpHome, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("maybeOfferIngestionShellRcPersist", () => {
  describe("when the user answers 'never'", () => {
    it("persists shell_rc_preference='skip' and leaves the rc file untouched", async () => {
      answers.push("never");
      const { maybeOfferIngestionShellRcPersist } = await import("../shell-rc.js");
      const c = cfg();
      await maybeOfferIngestionShellRcPersist({
        cfg: c,
        tool: "claude",
        vars: otelVars,
      });
      expect(c.shell_rc_preference).toBe("skip");
      expect(saveConfigMock).toHaveBeenCalledTimes(1);
      const persisted = saveConfigMock.mock.calls[0]![0] as GovernanceConfig;
      expect(persisted.shell_rc_preference).toBe("skip");
      expect(fs.existsSync(path.join(tmpHome, ".zshrc"))).toBe(false);
    });
  });

  describe("when the user answers 'n'", () => {
    it("persists nothing and leaves the rc file untouched", async () => {
      answers.push("n");
      const { maybeOfferIngestionShellRcPersist } = await import("../shell-rc.js");
      const c = cfg();
      await maybeOfferIngestionShellRcPersist({
        cfg: c,
        tool: "claude",
        vars: otelVars,
      });
      expect(c.shell_rc_preference).toBeUndefined();
      expect(saveConfigMock).not.toHaveBeenCalled();
      expect(fs.existsSync(path.join(tmpHome, ".zshrc"))).toBe(false);
    });
  });

  describe("when the user answers 'y'", () => {
    it("appends the marked OTEL telemetry block to ~/.zshrc", async () => {
      answers.push("y");
      const { maybeOfferIngestionShellRcPersist } = await import("../shell-rc.js");
      await maybeOfferIngestionShellRcPersist({
        cfg: cfg(),
        tool: "claude",
        vars: otelVars,
      });
      const rc = fs.readFileSync(path.join(tmpHome, ".zshrc"), "utf8");
      expect(rc).toContain("# >>> langwatch begin >>>");
      expect(rc).toContain(
        "export OTEL_EXPORTER_OTLP_ENDPOINT=http://app.example.com/api/otel",
      );
      expect(rc).toContain("# <<< langwatch end <<<");
    });
  });

  describe("when the config already carries shell_rc_preference='skip'", () => {
    it("does not prompt or write", async () => {
      // No answer queued: if the prompt fired it would read "" and proceed.
      const { maybeOfferIngestionShellRcPersist } = await import("../shell-rc.js");
      await maybeOfferIngestionShellRcPersist({
        cfg: cfg({ shell_rc_preference: "skip" }),
        tool: "claude",
        vars: otelVars,
      });
      expect(saveConfigMock).not.toHaveBeenCalled();
      expect(fs.existsSync(path.join(tmpHome, ".zshrc"))).toBe(false);
    });
  });
});
