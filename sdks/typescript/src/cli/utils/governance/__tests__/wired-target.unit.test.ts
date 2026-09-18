/**
 * The target an agent's OWN exporter is wired to, read back from the file the
 * agent loads (#7958). The probe re-sends the token it finds here as a bearer,
 * so what counts as a token is decided in this module and nowhere else.
 *
 * Feature: specs/ai-governance/cli-wrappers/session-context-hook.feature
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readWiredExporterTarget } from "../wired-target";

let tmpHome: string;
const origHome = process.env.HOME;
const origUserprofile = process.env.USERPROFILE;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "lw-wired-target-"));
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
});

afterEach(() => {
  process.env.HOME = origHome;
  process.env.USERPROFILE = origUserprofile;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

function writeClaudeEnv(env: Record<string, string>): void {
  const dir = path.join(tmpHome, ".claude");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ env }));
}

describe("readWiredExporterTarget", () => {
  describe("given a Claude settings file wired with a bearer", () => {
    it("returns the logs URL the exporter resolves and the bare token", () => {
      writeClaudeEnv({
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example/api/otel/",
        OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer ik-lw-wired",
      });

      expect(readWiredExporterTarget({ agent: "claude_code" })).toEqual({
        endpoint: "https://collector.example/api/otel/v1/logs",
        token: "ik-lw-wired",
      });
    });
  });

  describe("given a Claude settings file whose authorization is not a bearer", () => {
    /** @scenario "A wiring whose authorization is not a bearer token is not probed" */
    it("reports no wiring rather than a token the agent never sends", () => {
      writeClaudeEnv({
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example/api/otel",
        OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Basic dXNlcjpwYXNz",
      });

      expect(readWiredExporterTarget({ agent: "claude_code" })).toBeNull();
    });
  });

  describe("given a Claude settings file a person wired to another collector", () => {
    /** @scenario "A wiring to another collector is not probed" */
    it("reports no wiring: a bearer this CLI never wrote is not its to probe or heal", () => {
      writeClaudeEnv({
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://otel.other-vendor.example/v1",
        OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer ov_9f8e7d6c5b4a",
      });

      expect(readWiredExporterTarget({ agent: "claude_code" })).toBeNull();
    });
  });

  describe("given a machine with no wiring", () => {
    it("answers null for every agent", () => {
      expect(readWiredExporterTarget({ agent: "claude_code" })).toBeNull();
      expect(readWiredExporterTarget({ agent: "opencode" })).toBeNull();
    });
  });
});
