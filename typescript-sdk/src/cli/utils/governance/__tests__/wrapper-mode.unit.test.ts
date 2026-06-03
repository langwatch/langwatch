/**
 * Mode-resolution tests for the wrapper. Exercises the in-memory
 * decision tree (gateway vs ingestion) without touching the real
 * cli-api: the install/list/rotate calls are mocked at module
 * boundary, the codex-config-toml writer is overridden via test
 * harness redirect to a tmpdir.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import * as cliApi from "../cli-api";
import * as configMod from "../config";
import type { GovernanceConfig } from "../config";

vi.mock("../cli-api", async () => {
  const actual = await vi.importActual<typeof cliApi>("../cli-api");
  return {
    ...actual,
    listIngestionTemplates: vi.fn(),
    listUserIngestionBindings: vi.fn(),
    installUserIngestionBinding: vi.fn(),
    rotateUserIngestionBindingToken: vi.fn(),
  };
});

vi.mock("../config", async () => {
  const actual = await vi.importActual<typeof configMod>("../config");
  return {
    ...actual,
    saveConfig: vi.fn(),
  };
});

let tmpHome: string;
let originalHome: string | undefined;
let originalCodexHome: string | undefined;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "lw-wrapper-mode-"));
  originalHome = process.env.HOME;
  originalCodexHome = process.env.CODEX_HOME;
  process.env.HOME = tmpHome;
  process.env.CODEX_HOME = path.join(tmpHome, ".codex");
});

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  if (originalCodexHome === undefined) {
    delete process.env.CODEX_HOME;
  } else {
    process.env.CODEX_HOME = originalCodexHome;
  }
  fs.rmSync(tmpHome, { recursive: true, force: true });
  vi.clearAllMocks();
});

function baseCfg(overrides: Partial<GovernanceConfig> = {}): GovernanceConfig {
  return {
    gateway_url: "http://gw.example.com",
    control_plane_url: "http://app.example.com",
    access_token: "tok",
    user: { id: "u1", email: "u@example.com" },
    organization: { id: "o1", slug: "acme" },
    ...overrides,
  };
}

describe("resolveWrapperMode", () => {
  describe("when a personal VK is configured", () => {
    it("returns gateway mode with the gateway env vars unchanged", async () => {
      const { resolveWrapperMode } = await import("../wrapper-mode.js");
      const cfg = baseCfg({
        default_personal_vk: { id: "vk1", secret: "lw_vk_secret", prefix: "lw_vk_" },
      });
      const gw = { ANTHROPIC_BASE_URL: "http://gw.example.com", ANTHROPIC_AUTH_TOKEN: "lw_vk_secret" };
      const out = await resolveWrapperMode(cfg, "claude", gw);
      expect(out.mode).toBe("gateway");
      expect(out.vars).toEqual(gw);
    });
  });

  describe("when no VK is present (the no-surprise auto-Path-B path)", () => {
    /**
     * The "$5 VPS running claude code" scenario rchaves called
     * out: a user with no VK should be able to run `langwatch
     * codex` and have it Just Work via Path B without first
     * remembering to invoke a separate install command.
     */
    it("falls through to ingestion mode and mints a new binding", async () => {
      const { resolveWrapperMode } = await import("../wrapper-mode.js");
      (cliApi.listIngestionTemplates as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: "tpl_codex",
          slug: "codex",
          source_type: "codex",
          display_name: "Codex",
          description: null,
          icon_asset: null,
          credential_schema: null,
          ottl_rules: "",
          platform_published: true,
          enabled: true,
          organization_id: null,
        },
      ]);
      (cliApi.listUserIngestionBindings as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (cliApi.installUserIngestionBinding as ReturnType<typeof vi.fn>).mockResolvedValue({
        user_ingestion_binding: { id: "b1", template_id: "tpl_codex" },
        binding_access_token: "ik-lw-test-token",
      });

      const out = await resolveWrapperMode(baseCfg(), "codex", {});

      expect(out.mode).toBe("ingestion");
      expect(out.newBindingMinted).toBe(true);
      expect(out.vars.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(
        "http://app.example.com/api/otel",
      );
      expect(out.vars.OTEL_EXPORTER_OTLP_HEADERS).toBe(
        "Authorization=Bearer ik-lw-test-token",
      );
      expect(out.vars.OTEL_RESOURCE_ATTRIBUTES).toBe("service.name=codex");
    });

    it("writes the [otel] block to the codex config.toml as a side effect", async () => {
      const { resolveWrapperMode } = await import("../wrapper-mode.js");
      (cliApi.listIngestionTemplates as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: "tpl_codex",
          slug: "codex",
          source_type: "codex",
          display_name: "Codex",
          description: null,
          icon_asset: null,
          credential_schema: null,
          ottl_rules: "",
          platform_published: true,
          enabled: true,
          organization_id: null,
        },
      ]);
      (cliApi.listUserIngestionBindings as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (cliApi.installUserIngestionBinding as ReturnType<typeof vi.fn>).mockResolvedValue({
        user_ingestion_binding: { id: "b1", template_id: "tpl_codex" },
        binding_access_token: "ik-lw-test-token",
      });

      const out = await resolveWrapperMode(baseCfg(), "codex", {});

      expect(out.codexConfigPath).toBeDefined();
      const contents = fs.readFileSync(out.codexConfigPath!, "utf8");
      expect(contents).toContain("[otel]");
      expect(contents).toContain("[otel.exporter.otlp-http]");
      // Authorization header must NOT land on disk.
      expect(contents).not.toContain("ik-lw-test-token");
    });

    it("rotates the binding when one already exists rather than minting again", async () => {
      const { resolveWrapperMode } = await import("../wrapper-mode.js");
      (cliApi.listIngestionTemplates as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: "tpl_codex",
          slug: "codex",
          source_type: "codex",
          display_name: "Codex",
          description: null,
          icon_asset: null,
          credential_schema: null,
          ottl_rules: "",
          platform_published: true,
          enabled: true,
          organization_id: null,
        },
      ]);
      (cliApi.listUserIngestionBindings as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: "b_prior", template_id: "tpl_codex" },
      ]);
      (cliApi.rotateUserIngestionBindingToken as ReturnType<typeof vi.fn>).mockResolvedValue({
        user_ingestion_binding: { id: "b_prior", template_id: "tpl_codex" },
        binding_access_token: "ik-lw-rotated",
      });

      const out = await resolveWrapperMode(baseCfg(), "codex", {});

      expect(out.mode).toBe("ingestion");
      expect(out.newBindingMinted).toBe(false);
      expect(out.vars.OTEL_EXPORTER_OTLP_HEADERS).toContain("ik-lw-rotated");
      expect(cliApi.installUserIngestionBinding).not.toHaveBeenCalled();
      expect(cliApi.rotateUserIngestionBindingToken).toHaveBeenCalledWith(
        expect.any(Object),
        "b_prior",
      );
    });
  });

  describe("when cfg.tool_mode pins ingestion despite VK presence", () => {
    /**
     * User explicitly opted into Path B for a tool (e.g. their VK
     * routes to a budget they don't want this tool to charge to).
     * Wrapper honours the persisted preference even when a VK
     * would normally win the auto-pick.
     */
    it("uses ingestion mode and skips the gateway envs", async () => {
      const { resolveWrapperMode } = await import("../wrapper-mode.js");
      (cliApi.listIngestionTemplates as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: "tpl_codex",
          slug: "codex",
          source_type: "codex",
          display_name: "Codex",
          description: null,
          icon_asset: null,
          credential_schema: null,
          ottl_rules: "",
          platform_published: true,
          enabled: true,
          organization_id: null,
        },
      ]);
      (cliApi.listUserIngestionBindings as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (cliApi.installUserIngestionBinding as ReturnType<typeof vi.fn>).mockResolvedValue({
        user_ingestion_binding: { id: "b1", template_id: "tpl_codex" },
        binding_access_token: "ik-lw-pinned",
      });

      const cfg = baseCfg({
        default_personal_vk: { id: "vk1", secret: "lw_vk_secret" },
        tool_mode: { codex: "ingestion" },
      });
      const out = await resolveWrapperMode(cfg, "codex", { OPENAI_BASE_URL: "http://gw", OPENAI_API_KEY: "lw_vk_secret" });

      expect(out.mode).toBe("ingestion");
      expect(out.vars.OPENAI_BASE_URL).toBeUndefined();
      expect(out.vars.OTEL_EXPORTER_OTLP_HEADERS).toContain("ik-lw-pinned");
    });
  });

  describe("when codex resolves to gateway mode", () => {
    /**
     * codex 0.134+ rejects --profile <X> when [profiles.X] lives
     * inside config.toml; the profile body must be in a sibling
     * <X>.config.toml file. Andre's dogfood at 4f37ed27a HEAD
     * surfaced this rejection — guard against regression.
     */
    it("returns codexProfilePath + writes profile body to the sibling file", async () => {
      const { resolveWrapperMode } = await import("../wrapper-mode.js");
      const cfg = baseCfg({
        default_personal_vk: { id: "vk1", secret: "lw_vk_secret", prefix: "lw_vk_" },
      });
      const gw = { OPENAI_API_KEY: "lw_vk_secret" };
      const out = await resolveWrapperMode(cfg, "codex", gw);

      expect(out.mode).toBe("gateway");
      expect(out.codexConfigPath).toBeDefined();
      expect(out.codexProfilePath).toBeDefined();
      expect(out.codexProfilePath).toMatch(/langwatch-gateway\.config\.toml$/);

      const configContents = fs.readFileSync(out.codexConfigPath!, "utf8");
      expect(configContents).toContain("[model_providers.langwatch]");
      expect(configContents).not.toContain("[profiles.langwatch-gateway]");
      expect(configContents).not.toContain("[profiles.");

      const profileContents = fs.readFileSync(out.codexProfilePath!, "utf8");
      expect(profileContents).toContain(`model_provider = "langwatch"`);

      expect(out.extraArgs).toEqual(["--profile", "langwatch-gateway"]);
    });
  });

  describe("when the tool has no ingestion template (e.g. cursor)", () => {
    it("falls back to gateway mode without erroring", async () => {
      const { resolveWrapperMode } = await import("../wrapper-mode.js");
      const out = await resolveWrapperMode(baseCfg(), "cursor", {
        OPENAI_BASE_URL: "http://gw",
      });
      expect(out.mode).toBe("gateway");
      expect(out.vars.OPENAI_BASE_URL).toBe("http://gw");
    });
  });
});
