import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  copilotGatewayModelPreflight,
  copilotManagedSettingsPaths,
  copilotPrespawnWarnings,
  detectManagedOtelPin,
  parseCopilotVersion,
} from "../copilot-prespawn";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-copilot-prespawn-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const versionOk = () => "1.0.69";

describe("copilotPrespawnWarnings()", () => {
  describe("when a managed-settings file pins an OTel collector", () => {
    /** @scenario A managed OTel pin produces a one-line warning and the run continues */
    it("warns that enterprise policy routes telemetry elsewhere", () => {
      const managed = path.join(tmpDir, "managed-settings.json");
      fs.writeFileSync(
        managed,
        JSON.stringify({ otel: { endpoint: "https://corp-collector" } }),
      );
      const warnings = copilotPrespawnWarnings({
        managedPaths: [managed],
        readVersionImpl: versionOk,
      });
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("enterprise policy");
    });

    /** @scenario The managed-settings warning also fires on the gateway path */
    it("computes warnings with no mode input, so both paths surface them", () => {
      // copilotPrespawnWarnings takes no path/mode parameter by design —
      // runWrapped calls it before the gateway/ingestion branch, so the
      // same warnings print on either path.
      const managed = path.join(tmpDir, "managed-settings.json");
      fs.writeFileSync(managed, `{"otel":{"enabled":true}}`);
      const warnings = copilotPrespawnWarnings({
        managedPaths: [managed],
        readVersionImpl: versionOk,
      });
      expect(warnings[0]).toContain("telemetry elsewhere");
    });

    it("scans a policy.d directory for otel-bearing json documents", () => {
      const policyDir = path.join(tmpDir, "policy.d");
      fs.mkdirSync(policyDir);
      fs.writeFileSync(
        path.join(policyDir, "corp.json"),
        `{"otel":{"endpoint":"https://corp"}}`,
      );
      expect(detectManagedOtelPin([policyDir])).toContain("corp.json");
    });
  });

  describe("when no managed-settings file exists", () => {
    /** @scenario No managed-settings file produces no warning */
    it("produces no managed-settings warning", () => {
      const warnings = copilotPrespawnWarnings({
        managedPaths: [path.join(tmpDir, "does-not-exist.json")],
        readVersionImpl: versionOk,
      });
      expect(warnings).toEqual([]);
    });

    it("ignores a managed file that does not touch otel config", () => {
      const managed = path.join(tmpDir, "managed-settings.json");
      fs.writeFileSync(
        managed,
        `{"permissions":{"disableBypassPermissionsMode":true}}`,
      );
      const warnings = copilotPrespawnWarnings({
        managedPaths: [managed],
        readVersionImpl: versionOk,
      });
      expect(warnings).toEqual([]);
    });
  });

  describe("when the installed copilot is older than 1.0.41", () => {
    /** @scenario A copilot older than 1.0.41 gets an upgrade warning and still runs */
    it("warns to upgrade with the minimum version named", () => {
      const warnings = copilotPrespawnWarnings({
        managedPaths: [],
        readVersionImpl: () => "1.0.30",
      });
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("1.0.41");
      expect(warnings[0]).toContain("upgrade");
    });
  });

  describe("when the installed copilot meets the minimum", () => {
    /** @scenario A copilot at or above 1.0.41 produces no version warning */
    it("produces no version warning at exactly 1.0.41", () => {
      const warnings = copilotPrespawnWarnings({
        managedPaths: [],
        readVersionImpl: () => "1.0.41",
      });
      expect(warnings).toEqual([]);
    });
  });

  describe("when the version is unreadable", () => {
    /** @scenario An unparseable copilot version does not block the run */
    it("produces no warning (never blocks on the version probe)", () => {
      const warnings = copilotPrespawnWarnings({
        managedPaths: [],
        readVersionImpl: () => null,
      });
      expect(warnings).toEqual([]);
    });
  });
});

describe("parseCopilotVersion()", () => {
  it("extracts the triple from the CLI banner", () => {
    expect(parseCopilotVersion("GitHub Copilot CLI 1.0.69.")).toBe("1.0.69");
  });

  it("returns null for unparseable output", () => {
    expect(parseCopilotVersion("command not found")).toBeNull();
    expect(parseCopilotVersion(null)).toBeNull();
  });
});

describe("copilotManagedSettingsPaths()", () => {
  it("targets the managed-settings.json on macOS", () => {
    expect(copilotManagedSettingsPaths("darwin")).toEqual([
      "/Library/Application Support/GitHubCopilot/managed-settings.json",
    ]);
  });

  it("targets the policy.d directory on linux", () => {
    expect(copilotManagedSettingsPaths("linux")).toEqual([
      "/etc/github-copilot/policy.d",
    ]);
  });
});

describe("copilotGatewayModelPreflight", () => {
  describe("when no model is resolvable", () => {
    it("returns an actionable message", () => {
      const msg = copilotGatewayModelPreflight({ args: [], env: {} });

      expect(msg).toContain("--model");
      expect(msg).toContain("COPILOT_MODEL");
    });
  });

  describe("when a model is provided", () => {
    it("accepts --model in the args", () => {
      expect(
        copilotGatewayModelPreflight({ args: ["--model", "gpt-5"], env: {} }),
      ).toBeNull();
    });

    it("accepts --model=<id> in the args", () => {
      expect(
        copilotGatewayModelPreflight({ args: ["--model=gpt-5"], env: {} }),
      ).toBeNull();
    });

    it("accepts COPILOT_MODEL in the environment", () => {
      expect(
        copilotGatewayModelPreflight({
          args: [],
          env: { COPILOT_MODEL: "gpt-5" },
        }),
      ).toBeNull();
    });

    it("accepts COPILOT_PROVIDER_MODEL_ID in the environment", () => {
      expect(
        copilotGatewayModelPreflight({
          args: [],
          env: { COPILOT_PROVIDER_MODEL_ID: "gpt-5" },
        }),
      ).toBeNull();
    });
  });
});
