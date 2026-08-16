/**
 * `langwatch instrument <tool>` - scope selection and wiring dispatch.
 * The wiring writers and the credential resolver carry their own suites
 * (instrument-wiring, resolve-ingestion-credential); here they are
 * mocked so each scope rule is pinned at the command level.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as configMod from "../../utils/governance/config";
import type { GovernanceConfig } from "../../utils/governance/config";
import { installTelemetryWiring } from "../../utils/governance/instrument-wiring";
import {
  clearToolProjectPin,
  pinToolToKey,
  pinToolToProject,
} from "../../utils/governance/project-scope";
import * as telemetryRefreshMod from "../../utils/governance/telemetry-refresh";
import { instrumentCommand } from "../instrument";

vi.mock("../../utils/governance/config", async () => {
  const actual = await vi.importActual<typeof configMod>(
    "../../utils/governance/config",
  );
  return { ...actual, loadConfig: vi.fn(), saveConfig: vi.fn(), isLoggedIn: vi.fn() };
});

vi.mock("../../utils/governance/instrument-wiring", () => ({
  installTelemetryWiring: vi.fn(),
}));

vi.mock("../../utils/governance/project-scope", () => ({
  clearToolProjectPin: vi.fn(),
  pinToolToKey: vi.fn(),
  pinToolToProject: vi.fn(),
}));

vi.mock("../../utils/governance/telemetry-refresh", async () => {
  const actual = await vi.importActual<typeof telemetryRefreshMod>(
    "../../utils/governance/telemetry-refresh",
  );
  return { ...actual, resolveIngestionCredential: vi.fn() };
});

class ExitError extends Error {
  constructor(public readonly code: number) {
    super(`exit ${code}`);
  }
}

const asMock = (fn: unknown): ReturnType<typeof vi.fn> =>
  fn as ReturnType<typeof vi.fn>;

const personalCredential = {
  token: "ik-lw-personal00000000_secret",
  prefix: undefined,
  endpoint: "http://app.example.com/api/otel",
  minted: false,
  scope: "personal" as const,
};

let cfg: GovernanceConfig;
let stderrSpy: ReturnType<typeof vi.spyOn>;
let stdoutSpy: ReturnType<typeof vi.spyOn>;
let prevKeyEnv: string | undefined;

const writtenTo = (spy: ReturnType<typeof vi.spyOn>): string =>
  spy.mock.calls.map((c: unknown[]) => String(c[0])).join("");

beforeEach(() => {
  vi.clearAllMocks();
  prevKeyEnv = process.env.LANGWATCH_INGEST_KEY;
  delete process.env.LANGWATCH_INGEST_KEY;
  cfg = {
    gateway_url: "http://gw.example.com",
    control_plane_url: "http://app.example.com",
    access_token: "tok",
  };
  asMock(configMod.loadConfig).mockReturnValue(cfg);
  asMock(configMod.isLoggedIn).mockReturnValue(true);
  asMock(telemetryRefreshMod.resolveIngestionCredential).mockResolvedValue(personalCredential);
  asMock(installTelemetryWiring).mockReturnValue({
    labels: ["~/.codex/config.toml"],
    warnings: [],
  });
  stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new ExitError(code ?? 0);
  }) as never);
});

afterEach(() => {
  if (prevKeyEnv === undefined) delete process.env.LANGWATCH_INGEST_KEY;
  else process.env.LANGWATCH_INGEST_KEY = prevKeyEnv;
  vi.restoreAllMocks();
});

describe("instrumentCommand", () => {
  describe("given a tool with no ingestion path", () => {
    it("fails with the supported list", async () => {
      await expect(instrumentCommand("cursor", {})).rejects.toThrow(ExitError);
      expect(writtenTo(stderrSpy)).toContain("not an instrumentable tool");
      expect(installTelemetryWiring).not.toHaveBeenCalled();
    });
  });

  describe("given more than one scope flag", () => {
    it("refuses --project together with --key", async () => {
      await expect(
        instrumentCommand("codex", { project: "acme-app", key: "sk-lw-x" }),
      ).rejects.toThrow(ExitError);
      expect(writtenTo(stderrSpy)).toContain("only one of");
    });
  });

  describe("given --endpoint without --key", () => {
    it("refuses: logged-in scopes use the login's endpoint", async () => {
      await expect(
        instrumentCommand("codex", { endpoint: "https://lw.acme.dev" }),
      ).rejects.toThrow(ExitError);
      expect(writtenTo(stderrSpy)).toContain("--endpoint only applies");
    });
  });

  describe("given --key on a machine that never logged in", () => {
    /** @scenario "A pasted key instruments a machine that never logs in" */
    it("pins the tool to the key and installs the wiring without login", async () => {
      asMock(configMod.isLoggedIn).mockReturnValue(false);
      asMock(telemetryRefreshMod.resolveIngestionCredential).mockResolvedValue({
        token: "sk-lw-pasted",
        endpoint: "https://lw.acme.dev/api/otel",
        minted: false,
        scope: "project" as const,
        projectLabel: undefined,
      });

      await instrumentCommand("codex", {
        key: "sk-lw-pasted",
        endpoint: "https://lw.acme.dev",
      });

      expect(pinToolToKey).toHaveBeenCalledWith({
        cfg,
        tool: "codex",
        key: "sk-lw-pasted",
        endpoint: "https://lw.acme.dev",
      });
      expect(installTelemetryWiring).toHaveBeenCalledWith({
        cfg,
        tool: "codex",
        endpoint: "https://lw.acme.dev/api/otel",
        token: "sk-lw-pasted",
      });
      const out = writtenTo(stdoutSpy);
      expect(out).toContain("wrote telemetry wiring to ~/.codex/config.toml");
      expect(out).toContain("plain `codex` runs now send telemetry to");
    });

    it("reads the key from LANGWATCH_INGEST_KEY when no flag is passed", async () => {
      asMock(configMod.isLoggedIn).mockReturnValue(false);
      process.env.LANGWATCH_INGEST_KEY = "sk-lw-from-env";

      await instrumentCommand("codex", {});

      expect(pinToolToKey).toHaveBeenCalledWith({
        cfg,
        tool: "codex",
        key: "sk-lw-from-env",
        endpoint: undefined,
      });
    });
  });

  describe("given --project", () => {
    describe("when not logged in", () => {
      it("fails and points at login or --key", async () => {
        asMock(configMod.isLoggedIn).mockReturnValue(false);

        await expect(
          instrumentCommand("codex", { project: "acme-app" }),
        ).rejects.toThrow(ExitError);
        expect(writtenTo(stderrSpy)).toContain(
          "--project needs a signed-in session",
        );
        expect(pinToolToProject).not.toHaveBeenCalled();
      });
    });

    describe("when logged in", () => {
      /** @scenario "--project mints a device-scoped project key and pins the tool" */
      it("pins the tool via a fresh project key and reports the destination", async () => {
        asMock(pinToolToProject).mockResolvedValue({ label: "acme-app" });
        asMock(telemetryRefreshMod.resolveIngestionCredential).mockResolvedValue({
          token: "ik-lw-proj00000000000_secret",
          endpoint: "http://app.example.com/api/otel",
          minted: false,
          scope: "project" as const,
          projectLabel: "acme-app",
        });

        await instrumentCommand("codex", { project: "acme-app" });

        expect(pinToolToProject).toHaveBeenCalledWith({
          cfg,
          tool: "codex",
          project: "acme-app",
        });
        const out = writtenTo(stdoutSpy);
        expect(out).toContain("minted a project ingest key for codex");
        expect(out).toContain("project acme-app");
      });
    });
  });

  describe("given no scope flag and no login", () => {
    /** @scenario "Instrumenting without login and without a key fails with guidance" */
    it("fails and names both ways forward", async () => {
      asMock(configMod.isLoggedIn).mockReturnValue(false);

      await expect(instrumentCommand("codex", {})).rejects.toThrow(ExitError);
      const err = writtenTo(stderrSpy);
      expect(err).toContain("langwatch login --device");
      expect(err).toContain("--key");
    });
  });

  describe("given a bare re-run on a tool that is already pinned", () => {
    it("refreshes the pinned wiring without touching the pin or the login", async () => {
      asMock(configMod.isLoggedIn).mockReturnValue(false);
      cfg.tool_project_keys = { codex: { secret: "sk-lw-pinned" } };
      asMock(telemetryRefreshMod.resolveIngestionCredential).mockResolvedValue({
        token: "sk-lw-pinned",
        endpoint: "http://app.example.com/api/otel",
        minted: false,
        scope: "project" as const,
        projectLabel: undefined,
      });

      await instrumentCommand("codex", {});

      expect(pinToolToKey).not.toHaveBeenCalled();
      expect(pinToolToProject).not.toHaveBeenCalled();
      expect(installTelemetryWiring).toHaveBeenCalled();
    });
  });

  describe("given --personal on a pinned tool", () => {
    /** @scenario "--personal returns the tool to the personal workspace" */
    it("clears the pin and rewires the personal path", async () => {
      asMock(clearToolProjectPin).mockReturnValue(true);

      await instrumentCommand("codex", { personal: true });

      expect(clearToolProjectPin).toHaveBeenCalledWith({ cfg, tool: "codex" });
      expect(writtenTo(stdoutSpy)).toContain("cleared the project pin");
      expect(installTelemetryWiring).toHaveBeenCalledWith(
        expect.objectContaining({ token: personalCredential.token }),
      );
    });
  });

  describe("given the personal path minted a fresh key", () => {
    it("persists it to the per-source cache like the wrapper does", async () => {
      asMock(telemetryRefreshMod.resolveIngestionCredential).mockResolvedValue({
        ...personalCredential,
        token: "ik-lw-fresh00000000000_secret",
        minted: true,
      });

      await instrumentCommand("codex", {});

      expect(configMod.saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          default_personal_ingest_keys: expect.objectContaining({
            codex: { secret: "ik-lw-fresh00000000000_secret" },
          }),
        }),
      );
    });
  });

  describe("given the installer wrote nothing", () => {
    it("fails instead of claiming success", async () => {
      asMock(installTelemetryWiring).mockReturnValue({
        labels: [],
        warnings: ["could not write ~/.zshrc: EACCES"],
      });

      await expect(instrumentCommand("codex", {})).rejects.toThrow(ExitError);
      const err = writtenTo(stderrSpy);
      expect(err).toContain("could not write ~/.zshrc");
      expect(err).toContain("no wiring target was written");
    });
  });
});
