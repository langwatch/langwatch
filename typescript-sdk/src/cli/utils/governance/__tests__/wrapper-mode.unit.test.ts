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
      // codex 0.137+ separates trace_exporter from exporter (logs).
      // Wrapper writes [otel.trace_exporter.otlp-http] so traces emit.
      expect(contents).toContain("[otel.trace_exporter.otlp-http]");
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

  describe("when claude resolves to ingestion mode", () => {
    /**
     * claude-code 2.x has four documented OTEL_LOG_* unlock knobs
     * (code.claude.com/docs/en/monitoring-usage). Without them the
     * OTel wire is metadata-only — tokens, cost, durations, tool
     * sizes-in-bytes — and assistant response text + tool I/O text
     * are silently absent (quadruple-proven dead end before we
     * found these). The four knobs:
     *
     *   OTEL_LOG_USER_PROMPTS=1   lifts user prompt text onto
     *                             user_prompt events
     *   OTEL_LOG_TOOL_DETAILS=1   lifts tool_input/tool_parameters
     *                             attrs (Bash command, Edit diff,
     *                             file paths) onto tool_decision +
     *                             tool_result so the trace shows
     *                             WHAT the tool did
     *   OTEL_LOG_TOOL_CONTENT=1   traces-only + beta tracing —
     *                             no-op for claude 2.x logs path
     *                             today, set as forward-compat
     *   OTEL_LOG_RAW_API_BODIES=1 emits api_request_body +
     *                             api_response_body events
     *                             carrying the FULL JSON of every
     *                             API call (system prompts +
     *                             message history + assistant
     *                             text + tool_use blocks). THIS
     *                             is the only OTel surface that
     *                             carries assistant response text.
     *
     * Dropping any of USER_PROMPTS / TOOL_DETAILS / RAW_API_BODIES
     * silently regresses content visibility. Pin all four here so
     * a refactor can't quietly undo the unlock.
     */
    it("sets all 4 claude OTEL_LOG_* unlock knobs (collect-everything)", async () => {
      const { resolveWrapperMode } = await import("../wrapper-mode.js");
      (cliApi.listIngestionTemplates as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: "tpl_claude",
          slug: "claude_code",
          source_type: "claude_code",
          display_name: "Claude Code",
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
        user_ingestion_binding: { id: "b_c", template_id: "tpl_claude" },
        binding_access_token: "ik-lw-claude-test-token",
      });

      const cfg = baseCfg({ tool_mode: { claude: "ingestion" } });
      const out = await resolveWrapperMode(cfg, "claude", {});

      expect(out.mode).toBe("ingestion");
      expect(out.vars.CLAUDE_CODE_ENABLE_TELEMETRY).toBe("1");
      expect(out.vars.OTEL_LOG_USER_PROMPTS).toBe("1");
      expect(out.vars.OTEL_LOG_TOOL_DETAILS).toBe("1");
      expect(out.vars.OTEL_LOG_TOOL_CONTENT).toBe("1");
      expect(out.vars.OTEL_LOG_RAW_API_BODIES).toBe("1");
      expect(out.vars.OTEL_TRACES_EXPORTER).toBe("otlp");
      expect(out.vars.OTEL_LOGS_EXPORTER).toBe("otlp");
      expect(out.vars.OTEL_METRICS_EXPORTER).toBe("otlp");
      expect(out.vars.OTEL_EXPORTER_OTLP_HEADERS).toContain(
        "Authorization=Bearer ik-lw-claude-test-token",
      );
    });
  });

  describe("when gemini resolves to ingestion mode", () => {
    /**
     * gemini-cli 0.46-preview only emits OTLP traces + log records when
     * a specific combination of env knobs is set. Each one is load-bearing:
     *
     *   GEMINI_TELEMETRY_ENABLED=true        — master switch
     *   GEMINI_TELEMETRY_TARGET=local        — `otlp` is rejected at runtime
     *                                          (the schema docstring is a lie,
     *                                          parseTelemetryTargetValue accepts
     *                                          only local|gcp)
     *   GEMINI_TELEMETRY_USE_COLLECTOR=true  — pairs with target=local to route
     *                                          through OTLP HTTP exporters
     *                                          instead of the SDK default
     *                                          (console/no-op) exporters
     *   GEMINI_TELEMETRY_TRACES_ENABLED=true — captures detailed attribute
     *                                          spans (without it the api_request
     *                                          span has no attrs, no model lift)
     *   GEMINI_TELEMETRY_OTLP_ENDPOINT       — explicit endpoint; the env-fallback
     *                                          to OTEL_EXPORTER_OTLP_ENDPOINT
     *                                          worked in some bundle revisions
     *                                          and not others, so set it explicitly
     *   GEMINI_TELEMETRY_LOG_PROMPTS=true    — embeds the user prompt text in
     *                                          the user_prompt event so the
     *                                          receiver lifts it to langwatch.input
     *
     * Dropping ANY of these silently kills the OTLP path. This test locks the
     * 6-knob requirement so a refactor can't quietly regress to "metrics only".
     */
    it("sets all 6 gemini telemetry knobs required for OTLP traces + log records", async () => {
      const { resolveWrapperMode } = await import("../wrapper-mode.js");
      (cliApi.listIngestionTemplates as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: "tpl_gemini",
          slug: "gemini",
          source_type: "gemini",
          display_name: "Gemini",
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
        user_ingestion_binding: { id: "b_g", template_id: "tpl_gemini" },
        binding_access_token: "ik-lw-gemini-test-token",
      });

      const cfg = baseCfg({ tool_mode: { gemini: "ingestion" } });
      const out = await resolveWrapperMode(cfg, "gemini", {});

      expect(out.mode).toBe("ingestion");
      expect(out.vars.GEMINI_TELEMETRY_ENABLED).toBe("true");
      expect(out.vars.GEMINI_TELEMETRY_TARGET).toBe("local");
      expect(out.vars.GEMINI_TELEMETRY_USE_COLLECTOR).toBe("true");
      expect(out.vars.GEMINI_TELEMETRY_TRACES_ENABLED).toBe("true");
      expect(out.vars.GEMINI_TELEMETRY_OTLP_PROTOCOL).toBe("http");
      expect(out.vars.GEMINI_TELEMETRY_OTLP_ENDPOINT).toMatch(/\/api\/otel$/);
      expect(out.vars.GEMINI_TELEMETRY_LOG_PROMPTS).toBe("true");
      expect(out.vars.OTEL_EXPORTER_OTLP_HEADERS).toContain(
        "Authorization=Bearer ik-lw-gemini-test-token",
      );
    });
  });
});
