/**
 * Mode-resolution tests for the wrapper. Exercises the in-memory
 * decision tree (gateway vs ingestion) without touching the real
 * cli-api: the ingestion-key mint call is mocked at module
 * boundary, the codex-config-toml writer is overridden via test
 * harness redirect to a tmpdir.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as cliApi from "../cli-api";
import * as configMod from "../config";
import type { GovernanceConfig } from "../config";
import { runningCodeRestartNotice } from "../running-code";
import { buildOtelEnvBlock } from "../otel-env-block";
import { buildScopedToolFunction, persistBlockToRc, toolMarkers } from "../shell-rc";

vi.mock("../running-code", () => ({ runningCodeRestartNotice: vi.fn() }));

vi.mock("../cli-api", async () => {
	const actual = await vi.importActual<typeof cliApi>("../cli-api");
	return {
		...actual,
		mintIngestionKey: vi.fn(),
		listIngestionKeys: vi.fn(),
		issuePersonalVirtualKey: vi.fn(),
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
let tmpCwd: string;
let cwdSpy: ReturnType<typeof vi.spyOn>;
let originalHome: string | undefined;
let originalUserprofile: string | undefined;
let originalCodexHome: string | undefined;

beforeEach(() => {
	vi.mocked(runningCodeRestartNotice).mockReset();
	tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "lw-wrapper-mode-"));
	originalHome = process.env.HOME;
	originalUserprofile = process.env.USERPROFILE;
	originalCodexHome = process.env.CODEX_HOME;
	process.env.HOME = tmpHome;
	process.env.USERPROFILE = tmpHome;
	process.env.CODEX_HOME = path.join(tmpHome, ".codex");
	// Ingestion-mode claude resolution maintains a project pin at
	// $CWD/.claude/settings.local.json - sandbox the cwd so tests never
	// write into the repo checkout.
	tmpCwd = path.join(tmpHome, "project");
	fs.mkdirSync(tmpCwd, { recursive: true });
	cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tmpCwd) as ReturnType<
		typeof vi.spyOn
	>;
});

afterEach(() => {
	cwdSpy.mockRestore();
	if (originalHome === undefined) {
		delete process.env.HOME;
	} else {
		process.env.HOME = originalHome;
	}
	if (originalUserprofile === undefined) {
		delete process.env.USERPROFILE;
	} else {
		process.env.USERPROFILE = originalUserprofile;
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
	describe("when a project switch changes code telemetry while another launcher is running", () => {
		const restartNotice =
			"Restart `langwatch code` to apply the updated telemetry settings.";
		const endpoint = "http://app.example.com/api/otel";
		const replacementKey = "ik-lw-projectb_secret";
		const persistCode = (token: string) =>
			persistBlockToRc(
				"zsh",
				buildScopedToolFunction("code", buildOtelEnvBlock("code", endpoint, token), "zsh"),
				toolMarkers("code"),
			);
		const pinnedConfig = () =>
			baseCfg({
				tool_project_keys: {
					code: { secret: replacementKey, project_slug: "project-b" },
				},
			});

		beforeEach(() => {
			vi.mocked(runningCodeRestartNotice).mockReturnValue(restartNotice);
		});

		/** @scenario "Switching projects through the wrapper reports restart advice" */
		it("returns restart advice alongside the refreshed wiring", async () => {
			const { resolveWrapperMode } = await import("../wrapper-mode.js");
			persistCode("ik-lw-projecta_secret");
			const result = await resolveWrapperMode(pinnedConfig(), "code", {});
			expect(result.refreshedWiring).toContain("code shell function (~/.zshrc)");
			expect(result.notice).toContain(restartNotice);
		});

		it("does not inspect processes when the wiring already matches", async () => {
			const { resolveWrapperMode } = await import("../wrapper-mode.js");
			persistCode(replacementKey);
			const result = await resolveWrapperMode(pinnedConfig(), "code", {});
			expect(result.notice ?? "").not.toContain(restartNotice);
			expect(runningCodeRestartNotice).not.toHaveBeenCalled();
		});
	});
	describe("when a personal VK is configured", () => {
		it("returns gateway mode with the gateway env vars unchanged", async () => {
			const { resolveWrapperMode } = await import("../wrapper-mode.js");
			const cfg = baseCfg({
				default_personal_vk: {
					id: "vk1",
					secret: "lw_vk_secret",
					prefix: "lw_vk_",
				},
			});
			const gw = {
				ANTHROPIC_BASE_URL: "http://gw.example.com",
				ANTHROPIC_AUTH_TOKEN: "lw_vk_secret",
			};
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
		it("falls through to ingestion mode and mints a new key", async () => {
			const { resolveWrapperMode } = await import("../wrapper-mode.js");
			(cliApi.mintIngestionKey as ReturnType<typeof vi.fn>).mockResolvedValue({
				token: "sk-lw-test-token",
				prefix: "sk-lw-test",
				endpoint: "http://app.example.com/api/otel",
			});

			const out = await resolveWrapperMode(baseCfg(), "codex", {});

			expect(out.mode).toBe("ingestion");
			expect(out.newKeyMinted).toBe(true);
			expect(cliApi.mintIngestionKey).toHaveBeenCalledWith(
				expect.any(Object),
				"codex",
			);
			expect(out.vars.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(
				"http://app.example.com/api/otel",
			);
			expect(out.vars.OTEL_EXPORTER_OTLP_HEADERS).toBe(
				"Authorization=Bearer sk-lw-test-token",
			);
			expect(out.vars.OTEL_RESOURCE_ATTRIBUTES).toBe("service.name=codex");
		});

		/** @scenario "codex wiring persists the Authorization header inline" */
		it("writes the [otel] block with the Authorization header to the codex config.toml", async () => {
			const { resolveWrapperMode } = await import("../wrapper-mode.js");
			(cliApi.mintIngestionKey as ReturnType<typeof vi.fn>).mockResolvedValue({
				token: "sk-lw-test-token",
				prefix: "sk-lw-test",
				endpoint: "http://app.example.com/api/otel",
			});

			const out = await resolveWrapperMode(baseCfg(), "codex", {});

			expect(out.codexConfigPath).toBeDefined();
			const contents = fs.readFileSync(out.codexConfigPath!, "utf8");
			expect(contents).toContain("[otel]");
			// codex 0.137+ separates trace_exporter from exporter (logs).
			// Wrapper writes [otel.trace_exporter.otlp-http] so traces emit.
			expect(contents).toContain("[otel.trace_exporter.otlp-http]");
			// The Authorization header persists inline (0600 file), so a
			// plain `codex` run captures without the wrapper's env.
			expect(contents).toContain(
				`headers = { "Authorization" = "Bearer sk-lw-test-token" }`,
			);
		});

		/** @scenario "Every seam that persists the codex exporters wires the turn harvest" */
		it("wires the turn harvest beside the exporters it persisted", async () => {
			const { resolveWrapperMode } = await import("../wrapper-mode.js");
			(cliApi.mintIngestionKey as ReturnType<typeof vi.fn>).mockResolvedValue({
				token: "sk-lw-test-token",
				prefix: "sk-lw-test",
				endpoint: "http://app.example.com/api/otel",
			});

			const out = await resolveWrapperMode(baseCfg(), "codex", {});

			// The exporters carry tokens and timing but no conversation; the
			// notify harvest is what recovers it, so persisting one without the
			// other leaves plain codex runs with nothing to read.
			const contents = fs.readFileSync(out.codexConfigPath!, "utf8");
			expect(contents).toContain("langwatch codex notify begin");
			expect(contents).toContain('"ingest", "codex"');
		});

		it("reuses the cached key rather than minting again when one is already stored", async () => {
			const { resolveWrapperMode } = await import("../wrapper-mode.js");

			// resolveLiveIngestionKey calls listIngestionKeys whenever a cached
			// key is present; leaving it unmocked would make a REAL outbound
			// request to http://app.example.com. Simulate an unreachable /
			// older-server control plane so the offline-fallback branch
			// (reuse the cache) fires deterministically, with no network I/O.
			(cliApi.listIngestionKeys as ReturnType<typeof vi.fn>).mockRejectedValue(
				new Error("offline (test)"),
			);

			const cfg = baseCfg({
				default_personal_ingest_keys: {
					codex: { secret: "sk-lw-cached", prefix: "sk-lw-cach" },
				},
			});
			const out = await resolveWrapperMode(cfg, "codex", {});

			expect(out.mode).toBe("ingestion");
			expect(out.newKeyMinted).toBe(false);
			expect(out.vars.OTEL_EXPORTER_OTLP_HEADERS).toContain("sk-lw-cached");
			expect(out.vars.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(
				"http://app.example.com/api/otel",
			);
			expect(cliApi.mintIngestionKey).not.toHaveBeenCalled();
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
			(cliApi.mintIngestionKey as ReturnType<typeof vi.fn>).mockResolvedValue({
				token: "sk-lw-pinned",
				prefix: "sk-lw-pinn",
				endpoint: "http://app.example.com/api/otel",
			});

			const cfg = baseCfg({
				default_personal_vk: { id: "vk1", secret: "lw_vk_secret" },
				tool_mode: { codex: "ingestion" },
			});
			const out = await resolveWrapperMode(cfg, "codex", {
				OPENAI_BASE_URL: "http://gw",
				OPENAI_API_KEY: "lw_vk_secret",
			});

			expect(out.mode).toBe("ingestion");
			expect(out.vars.OPENAI_BASE_URL).toBeUndefined();
			expect(out.vars.OTEL_EXPORTER_OTLP_HEADERS).toContain("sk-lw-pinned");
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
				default_personal_vk: {
					id: "vk1",
					secret: "lw_vk_secret",
					prefix: "lw_vk_",
				},
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
			// No VK stored: the gateway path now issues one lazily.
			(
				cliApi.issuePersonalVirtualKey as ReturnType<typeof vi.fn>
			).mockResolvedValue({
				id: "vk1",
				secret: "vk-lw-issued",
				prefix: "vk-lw-iss",
			});
			const out = await resolveWrapperMode(baseCfg(), "cursor", {
				OPENAI_BASE_URL: "http://gw",
			});
			expect(out.mode).toBe("gateway");
			// The vars are recomputed from the freshly issued key.
			expect(out.vars.OPENAI_API_KEY).toBe("vk-lw-issued");
			expect(out.vars.OPENAI_BASE_URL).toContain("http://gw.example.com");
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
		 *   OTEL_LOG_TOOL_CONTENT=1   lifts tool input/output content
		 *                             onto the tool.output span event;
		 *                             active now that we set the
		 *                             ENHANCED_TELEMETRY_BETA flag
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
			(cliApi.mintIngestionKey as ReturnType<typeof vi.fn>).mockResolvedValue({
				token: "sk-lw-claude-test-token",
				prefix: "sk-lw-clau",
				endpoint: "http://app.example.com/api/otel",
			});

			const cfg = baseCfg({ tool_mode: { claude: "ingestion" } });
			const out = await resolveWrapperMode(cfg, "claude", {});

			expect(out.mode).toBe("ingestion");
			expect(cliApi.mintIngestionKey).toHaveBeenCalledWith(
				expect.any(Object),
				"claude_code",
			);
			expect(out.vars.CLAUDE_CODE_ENABLE_TELEMETRY).toBe("1");
			// Enhanced-telemetry beta: unlocks the real claude_code.tracing spans
			// (agent_id + parent_agent_id) that make sub-agent attribution
			// possible; without it OTEL_TRACES_EXPORTER is a no-op. Pinned so a
			// refactor can't silently drop it and regress back to logs-only.
			expect(out.vars.CLAUDE_CODE_ENHANCED_TELEMETRY_BETA).toBe("1");
			expect(out.vars.OTEL_LOG_USER_PROMPTS).toBe("1");
			expect(out.vars.OTEL_LOG_TOOL_DETAILS).toBe("1");
			expect(out.vars.OTEL_LOG_TOOL_CONTENT).toBe("1");
			expect(out.vars.OTEL_LOG_RAW_API_BODIES).toBe("1");
			expect(out.vars.OTEL_TRACES_EXPORTER).toBe("otlp");
			expect(out.vars.OTEL_LOGS_EXPORTER).toBe("otlp");
			expect(out.vars.OTEL_METRICS_EXPORTER).toBe("otlp");
			expect(out.vars.OTEL_EXPORTER_OTLP_HEADERS).toContain(
				"Authorization=Bearer sk-lw-claude-test-token",
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
			(cliApi.mintIngestionKey as ReturnType<typeof vi.fn>).mockResolvedValue({
				token: "sk-lw-gemini-test-token",
				prefix: "sk-lw-gemi",
				endpoint: "http://app.example.com/api/otel",
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
				"Authorization=Bearer sk-lw-gemini-test-token",
			);
		});
	});

	describe("when copilot resolves to ingestion mode", () => {
		const mintCopilot = () => {
			(cliApi.mintIngestionKey as ReturnType<typeof vi.fn>).mockResolvedValue({
				token: "sk-lw-copilot-test-token",
				prefix: "sk-lw-copi",
				endpoint: "http://app.example.com/api/otel",
			});
		};

		/** @scenario Ingestion mode mints a copilot_cli ingest key and enables native OTel */
		it("mints a copilot_cli key and enables copilot's native OTel export", async () => {
			const { resolveWrapperMode } = await import("../wrapper-mode.js");
			mintCopilot();

			const cfg = baseCfg({ tool_mode: { copilot: "ingestion" } });
			const out = await resolveWrapperMode(cfg, "copilot", {});

			expect(out.mode).toBe("ingestion");
			expect(cliApi.mintIngestionKey).toHaveBeenCalledWith(cfg, "copilot_cli");
			expect(out.vars.COPILOT_OTEL_ENABLED).toBe("true");
			expect(out.vars.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(
				"http://app.example.com/api/otel",
			);
			expect(out.vars.OTEL_EXPORTER_OTLP_HEADERS).toContain(
				"Authorization=Bearer sk-lw-copilot-test-token",
			);
			expect(out.vars.OTEL_EXPORTER_OTLP_PROTOCOL).toBe("http/json");
			expect(out.vars.OTEL_RESOURCE_ATTRIBUTES).toBe("service.name=copilot-cli");
		});

		it("clears inherited Copilot BYOK provider vars so ingestion preserves the seat", async () => {
			const { resolveWrapperMode } = await import("../wrapper-mode.js");
			mintCopilot();

			const out = await resolveWrapperMode(baseCfg(), "copilot", {});

			expect(out.mode).toBe("ingestion");
			// an inherited COPILOT_PROVIDER_BASE_URL would keep BYOK active and
			// route traffic off the seat — ingestion must scrub it from the child
			expect(out.clears).toContain("COPILOT_PROVIDER_BASE_URL");
			expect(out.clears).toContain("COPILOT_PROVIDER_TYPE");
			expect(out.clears).toContain("COPILOT_PROVIDER_API_KEY");
		});

		/** @scenario Ingestion mode pins the OTLP exporter type against an inherited file exporter */
		it("pins COPILOT_OTEL_EXPORTER_TYPE=otlp-http so an inherited file exporter can't swallow telemetry", async () => {
			const { resolveWrapperMode } = await import("../wrapper-mode.js");
			mintCopilot();

			const cfg = baseCfg({ tool_mode: { copilot: "ingestion" } });
			const out = await resolveWrapperMode(cfg, "copilot", {});

			expect(out.vars.COPILOT_OTEL_EXPORTER_TYPE).toBe("otlp-http");
		});

		/** @scenario Content capture is enabled by default in ingestion mode */
		it("enables content capture via the standard GenAI env var (capture-everything default)", async () => {
			const { resolveWrapperMode } = await import("../wrapper-mode.js");
			mintCopilot();

			const cfg = baseCfg({ tool_mode: { copilot: "ingestion" } });
			const out = await resolveWrapperMode(cfg, "copilot", {});

			expect(out.vars.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT).toBe(
				"true",
			);
		});

		/** @scenario An explicit user opt-out of content capture is never overwritten */
		it("respects an explicit user opt-out of content capture and warns tokens-only", async () => {
			const { resolveWrapperMode } = await import("../wrapper-mode.js");
			mintCopilot();
			process.env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT = "false";
			try {
				const cfg = baseCfg({ tool_mode: { copilot: "ingestion" } });
				const out = await resolveWrapperMode(cfg, "copilot", {});

				expect(
					out.vars.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT,
				).toBeUndefined();
				expect(out.notice).toContain("tokens only");
			} finally {
				delete process.env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT;
			}
		});

		/** @scenario An explicit user opt-out of content capture is never overwritten */
		it.each(["FALSE", "False", "0", "no", "off", "  false  "])(
			"treats the case-insensitive/falsey opt-out %j as off (never silently forces capture on)",
			async (value) => {
				const { resolveWrapperMode } = await import("../wrapper-mode.js");
				mintCopilot();
				process.env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT = value;
				try {
					const cfg = baseCfg({ tool_mode: { copilot: "ingestion" } });
					const out = await resolveWrapperMode(cfg, "copilot", {});

					expect(
						out.vars.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT,
					).toBeUndefined();
					expect(out.notice).toContain("tokens only");
				} finally {
					delete process.env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT;
				}
			},
		);

		/** @scenario A cached copilot_cli ingest key is reused instead of re-minting */
		it("reuses a live cached copilot_cli key instead of minting again", async () => {
			const { resolveWrapperMode } = await import("../wrapper-mode.js");
			(
				cliApi.listIngestionKeys as ReturnType<typeof vi.fn>
			).mockResolvedValueOnce([
				{ sourceType: "copilot_cli", lookupId: "cachedlookupid123" },
			]);

			const cfg = baseCfg({
				tool_mode: { copilot: "ingestion" },
				default_personal_ingest_keys: {
					copilot_cli: {
						id: "ik_cp",
						secret: "ik-lw-cachedlookupid123_secretpart",
						prefix: "ik-lw-",
					},
				},
			});
			const out = await resolveWrapperMode(cfg, "copilot", {});

			expect(cliApi.mintIngestionKey).not.toHaveBeenCalled();
			expect(out.vars.OTEL_EXPORTER_OTLP_HEADERS).toContain(
				"ik-lw-cachedlookupid123_secretpart",
			);
		});
	});

	describe("when code (VS Code Copilot Chat) resolves to ingestion mode", () => {
		const mintVscode = () => {
			(cliApi.mintIngestionKey as ReturnType<typeof vi.fn>).mockResolvedValue({
				token: "sk-lw-vscode-test-token",
				prefix: "sk-lw-vsco",
				endpoint: "http://app.example.com/api/otel",
			});
		};

		/** @scenario VS Code has no gateway path */
		it("resolves to ingestion even when a personal VK is present (no gateway path)", async () => {
			const { resolveWrapperMode } = await import("../wrapper-mode.js");
			mintVscode();

			const cfg = baseCfg({
				default_personal_vk: { id: "vk1", secret: "lw_vk_secret", prefix: "lw_vk_" },
			});
			const out = await resolveWrapperMode(cfg, "code", {});

			expect(out.mode).toBe("ingestion");
			// no BYOK / gateway env is injected
			expect(out.vars.OPENAI_BASE_URL).toBeUndefined();
			expect(out.vars.ANTHROPIC_BASE_URL).toBeUndefined();
		});

		/** @scenario `langwatch code` mints a copilot_vscode ingest key */
		it("mints a copilot_vscode ingest key", async () => {
			const { resolveWrapperMode } = await import("../wrapper-mode.js");
			mintVscode();

			await resolveWrapperMode(baseCfg(), "code", {});

			expect(cliApi.mintIngestionKey).toHaveBeenCalledWith(
				expect.any(Object),
				"copilot_vscode",
			);
		});

		/** @scenario The code env enables the extension's OTel and points it at LangWatch */
		it("enables copilot OTel, points the OTLP endpoint at LangWatch, and carries the Bearer", async () => {
			const { resolveWrapperMode } = await import("../wrapper-mode.js");
			mintVscode();

			const out = await resolveWrapperMode(baseCfg(), "code", {});

			expect(out.vars.COPILOT_OTEL_ENABLED).toBe("true");
			expect(out.vars.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(
				"http://app.example.com/api/otel",
			);
			expect(out.vars.OTEL_EXPORTER_OTLP_HEADERS).toBe(
				"Authorization=Bearer sk-lw-vscode-test-token",
			);
		});

		/** @scenario The surface is labelled copilot-chat */
		it("labels the surface copilot-chat", async () => {
			const { resolveWrapperMode } = await import("../wrapper-mode.js");
			mintVscode();

			const out = await resolveWrapperMode(baseCfg(), "code", {});

			expect(out.vars.OTEL_RESOURCE_ATTRIBUTES).toBe("service.name=copilot-chat");
		});

		/** @scenario Content capture is on by default */
		it("enables message-content capture by default", async () => {
			const { resolveWrapperMode } = await import("../wrapper-mode.js");
			mintVscode();

			const out = await resolveWrapperMode(baseCfg(), "code", {});

			expect(
				out.vars.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT,
			).toBe("true");
		});

		/** @scenario An explicit opt-out yields a loud tokens-only notice, never silent */
		it("respects an explicit content-capture opt-out with a loud tokens-only notice", async () => {
			const prev = process.env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT;
			process.env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT = "false";
			try {
				const { resolveWrapperMode } = await import("../wrapper-mode.js");
				mintVscode();

				const out = await resolveWrapperMode(baseCfg(), "code", {});

				expect(
					out.vars.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT,
				).toBeUndefined();
				expect(out.notice ?? "").toContain("tokens only");
				// the notice names the actual tool, not a hardcoded "copilot"
				expect(out.notice ?? "").toContain("code traces");
			} finally {
				if (prev === undefined)
					delete process.env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT;
				else process.env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT = prev;
			}
		});
	});

	describe("when the cached policy disables direct OTLP for a tool", () => {
		/**
		 * An org admin turned direct OTLP off for claude. A member with no
		 * VK would normally auto-resolve to ingestion (Path B). The policy
		 * gate sits ABOVE the mint: the wrapper must route through the
		 * gateway instead and never mint an ingestion key.
		 */
		/** @scenario "The personal virtual key is issued on first gateway use, not at login" */
		it("routes through the gateway, issuing the VK lazily, and does NOT mint an ingestion key", async () => {
			const { resolveWrapperMode } = await import("../wrapper-mode.js");
			(
				cliApi.issuePersonalVirtualKey as ReturnType<typeof vi.fn>
			).mockResolvedValue({
				id: "vk1",
				secret: "vk-lw-issued",
				prefix: "vk-lw-iss",
			});

			const cfg = baseCfg({
				tool_policies: { claude: { allowVk: true, allowOtelDirect: false } },
			});
			const out = await resolveWrapperMode(cfg, "claude", {
				ANTHROPIC_BASE_URL: "http://gw.example.com",
			});

			expect(out.mode).toBe("gateway");
			expect(out.newKeyMinted).toBeUndefined();
			expect(out.notice).toContain("direct OTLP ingestion is disabled");
			expect(cliApi.issuePersonalVirtualKey).toHaveBeenCalledTimes(1);
			expect(out.vars.ANTHROPIC_AUTH_TOKEN).toBe("vk-lw-issued");
			expect(cliApi.mintIngestionKey).not.toHaveBeenCalled();
		});

		it("still mints for a tool the cache leaves on direct OTLP", async () => {
			const { resolveWrapperMode } = await import("../wrapper-mode.js");
			(cliApi.mintIngestionKey as ReturnType<typeof vi.fn>).mockResolvedValue({
				token: "sk-lw-codex-token",
				prefix: "sk-lw-code",
				endpoint: "http://app.example.com/api/otel",
			});

			// claude is forced off, codex is untouched (defaults to both-on).
			const cfg = baseCfg({
				tool_policies: { claude: { allowVk: true, allowOtelDirect: false } },
			});
			const out = await resolveWrapperMode(cfg, "codex", {});

			expect(out.mode).toBe("ingestion");
			expect(out.newKeyMinted).toBe(true);
			expect(cliApi.mintIngestionKey).toHaveBeenCalledWith(
				expect.any(Object),
				"codex",
			);
		});
	});

	describe("when the cached policy disables the gateway path for a tool", () => {
		/**
		 * The admin forced claude onto direct OTLP (allowVk false). A
		 * member WITH a VK would normally auto-resolve to gateway; the gate
		 * downgrades to ingestion and surfaces why.
		 */
		it("downgrades to ingestion and surfaces the policy notice", async () => {
			const { resolveWrapperMode } = await import("../wrapper-mode.js");
			(cliApi.mintIngestionKey as ReturnType<typeof vi.fn>).mockResolvedValue({
				token: "sk-lw-claude-token",
				prefix: "sk-lw-clau",
				endpoint: "http://app.example.com/api/otel",
			});

			const cfg = baseCfg({
				default_personal_vk: { id: "vk1", secret: "lw_vk_secret" },
				tool_policies: { claude: { allowVk: false, allowOtelDirect: true } },
			});
			const out = await resolveWrapperMode(cfg, "claude", {
				ANTHROPIC_BASE_URL: "http://gw.example.com",
				ANTHROPIC_AUTH_TOKEN: "lw_vk_secret",
			});

			expect(out.mode).toBe("ingestion");
			expect(out.notice).toContain("gateway path is disabled");
			expect(out.vars.OTEL_EXPORTER_OTLP_HEADERS).toContain(
				"Authorization=Bearer sk-lw-claude-token",
			);
		});
	});

	describe("when the cached policy disables direct OTLP for copilot", () => {
		/** @scenario Policy-forced gateway routing for copilot names the seat bypass */
		it("routes through the gateway with a notice naming the Copilot seat bypass", async () => {
			const { resolveWrapperMode } = await import("../wrapper-mode.js");

			const cfg = baseCfg({
				default_personal_vk: { id: "vk1", secret: "lw_vk", prefix: "lw_" },
				tool_policies: { copilot: { allowVk: true, allowOtelDirect: false } },
			});
			const gw = { COPILOT_PROVIDER_BASE_URL: "http://gw/v1" };
			const out = await resolveWrapperMode(cfg, "copilot", gw, [], "ingestion");

			expect(out.mode).toBe("gateway");
			expect(out.notice).toContain("Copilot seat");
			expect(cliApi.mintIngestionKey).not.toHaveBeenCalled();
		});
	});

	describe("when the mode was forced by the path-selection UX (silent default)", () => {
		// Regression: resolveWrapperMode used to pin tool_mode="ingestion"
		// unconditionally — one aborted prompt / CI run silently pinned
		// copilot forever and the path prompt never appeared again. When a
		// forcedMode is passed, persistence belongs to the upstream UX
		// (explicit prompt answers persist there; silent defaults don't).
		it("does not pin tool_mode when a forcedMode was passed", async () => {
			const { resolveWrapperMode } = await import("../wrapper-mode.js");
			(cliApi.mintIngestionKey as ReturnType<typeof vi.fn>).mockResolvedValue({
				token: "sk-lw-copilot-tok",
				prefix: "sk-lw-copi",
				endpoint: "http://app.example.com/api/otel",
			});

			const cfg = baseCfg();
			await resolveWrapperMode(cfg, "copilot", {}, [], "ingestion");

			const saved = (configMod.saveConfig as ReturnType<typeof vi.fn>).mock
				.calls;
			for (const call of saved) {
				const persisted = call[0] as GovernanceConfig;
				expect(persisted.tool_mode?.copilot).toBeUndefined();
			}
		});

		// The `forcedMode === undefined` gate changed behavior for ALL tools,
		// and production `runWrapped` always supplies a concrete forcedMode —
		// so cover a non-copilot tool too, not just copilot.
		it.each(["claude", "codex"])(
			"does not pin tool_mode for %s either when a forcedMode was passed (cross-tool regression)",
			async (tool) => {
				const { resolveWrapperMode } = await import("../wrapper-mode.js");
				(cliApi.mintIngestionKey as ReturnType<typeof vi.fn>).mockResolvedValue(
					{
						token: "sk-lw-tok",
						prefix: "sk-lw-tok",
						endpoint: "http://app.example.com/api/otel",
					},
				);

				const cfg = baseCfg();
				await resolveWrapperMode(cfg, tool, {}, [], "ingestion");

				const saved = (configMod.saveConfig as ReturnType<typeof vi.fn>).mock
					.calls;
				for (const call of saved) {
					const persisted = call[0] as GovernanceConfig;
					expect(persisted.tool_mode?.[tool]).toBeUndefined();
				}
			},
		);

		it("still caches the freshly minted ingest key", async () => {
			const { resolveWrapperMode } = await import("../wrapper-mode.js");
			(cliApi.mintIngestionKey as ReturnType<typeof vi.fn>).mockResolvedValue({
				token: "sk-lw-copilot-tok2",
				prefix: "sk-lw-copi",
				endpoint: "http://app.example.com/api/otel",
			});

			const cfg = baseCfg();
			await resolveWrapperMode(cfg, "copilot", {}, [], "ingestion");

			const persisted = (configMod.saveConfig as ReturnType<typeof vi.fn>).mock
				.calls[
				(configMod.saveConfig as ReturnType<typeof vi.fn>).mock.calls.length - 1
			]?.[0] as GovernanceConfig;
			expect(persisted.default_personal_ingest_keys?.copilot_cli?.secret).toBe(
				"sk-lw-copilot-tok2",
			);
		});
	});

	describe("when evaluating the Copilot seat-bypass suffix", () => {
		// The policy-forced gateway notices (wrapper-mode's downgrade branch
		// and wrapper-path-choice's single-allowed-path branch) append this
		// suffix; asserting the helper here keeps the who-pays wording pinned
		// without simulating a full spawn.
		/** @scenario Policy-forced gateway routing for copilot names the seat bypass */
		it("names the seat bypass for copilot and stays silent for other tools", async () => {
			const { copilotSeatBypassSuffix } = await import("../wrapper-mode.js");
			expect(copilotSeatBypassSuffix("copilot")).toContain("Copilot seat");
			expect(copilotSeatBypassSuffix("claude")).toBe("");
		});
	});

	describe("when the cached policy disables both paths for a tool", () => {
		it("throws a tool-disabled error with an admin hint", async () => {
			const { resolveWrapperMode } = await import("../wrapper-mode.js");

			const cfg = baseCfg({
				tool_policies: { claude: { allowVk: false, allowOtelDirect: false } },
			});

			await expect(resolveWrapperMode(cfg, "claude", {})).rejects.toThrow(
				/disabled in the platform policy/,
			);
			expect(cliApi.mintIngestionKey).not.toHaveBeenCalled();
		});
	});

	describe("given a stale claude env block persisted by a previous login (#6202)", () => {
		/**
		 * Claude Code applies ~/.claude/settings.json's `env` block ON TOP
		 * of the child process env, so a block persisted by a previous
		 * install (previous instance's endpoint + key) silently overrides
		 * the correct env this run computes - telemetry lands on the wrong
		 * instance. Latest login wins: the resolver re-syncs the persisted
		 * block before the spawn.
		 */
		it("refreshes the settings.json block to this run's endpoint and key", async () => {
			const { resolveWrapperMode } = await import("../wrapper-mode.js");
			const { appSettingsTargetFor, installAppEnv } = await import(
				"../app-settings.js"
			);
			const { buildOtelEnvBlock } = await import("../otel-env-block.js");

			installAppEnv(
				appSettingsTargetFor("claude")!,
				buildOtelEnvBlock(
					"claude",
					"https://app.langwatch.ai/api/otel",
					"sk-lw-stale-token",
				),
			);

			(cliApi.mintIngestionKey as ReturnType<typeof vi.fn>).mockResolvedValue({
				token: "sk-lw-fresh-token",
				prefix: "sk-lw-fres",
				endpoint: "http://app.example.com/api/otel",
			});

			const out = await resolveWrapperMode(
				baseCfg({ tool_mode: { claude: "ingestion" } }),
				"claude",
				{},
			);

			expect(out.refreshedWiring).toEqual([
				"claude telemetry env (~/.claude/settings.json)",
			]);
			const written = JSON.parse(
				fs.readFileSync(path.join(tmpHome, ".claude", "settings.json"), "utf8"),
			);
			expect(written.env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(
				"http://app.example.com/api/otel",
			);
			expect(written.env.OTEL_EXPORTER_OTLP_HEADERS).toBe(
				"Authorization=Bearer sk-lw-fresh-token",
			);
		});
	});

	describe("when claude resolves to ingestion mode in a working directory", () => {
		it("pins the run's telemetry env in $CWD/.claude/settings.local.json", async () => {
			const { resolveWrapperMode } = await import("../wrapper-mode.js");
			(cliApi.mintIngestionKey as ReturnType<typeof vi.fn>).mockResolvedValue({
				token: "sk-lw-pin-token",
				prefix: "sk-lw-pin0",
				endpoint: "http://app.example.com/api/otel",
			});

			const out = await resolveWrapperMode(
				baseCfg({ tool_mode: { claude: "ingestion" } }),
				"claude",
				{},
			);

			expect(out.claudeProjectPin?.action).toBe("created");
			const pin = JSON.parse(
				fs.readFileSync(
					path.join(tmpCwd, ".claude", "settings.local.json"),
					"utf8",
				),
			);
			expect(pin.env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(
				"http://app.example.com/api/otel",
			);
			expect(pin.env.OTEL_EXPORTER_OTLP_HEADERS).toBe(
				"Authorization=Bearer sk-lw-pin-token",
			);
		});
	});

	describe("when claude resolves to gateway mode with a pin left behind", () => {
		it("removes the langwatch env from the project pin (no double-trace)", async () => {
			const { resolveWrapperMode } = await import("../wrapper-mode.js");
			const { claudeProjectSettingsTarget, installAppEnv } = await import(
				"../app-settings.js"
			);
			const { buildOtelEnvBlock } = await import("../otel-env-block.js");

			installAppEnv(
				claudeProjectSettingsTarget(tmpCwd),
				buildOtelEnvBlock(
					"claude",
					"https://app.langwatch.ai/api/otel",
					"sk-lw-stale-token",
				),
			);

			const cfg = baseCfg({
				default_personal_vk: { id: "vk1", secret: "lw_vk_secret" },
			});
			const out = await resolveWrapperMode(cfg, "claude", {
				ANTHROPIC_BASE_URL: "http://gw.example.com",
				ANTHROPIC_AUTH_TOKEN: "lw_vk_secret",
			});

			expect(out.mode).toBe("gateway");
			expect(out.claudeProjectPin?.action).toBe("removed");
			expect(
				fs.existsSync(path.join(tmpCwd, ".claude", "settings.local.json")),
			).toBe(false);
		});
	});
});

describe("resolveWrapperMode with a project pin", () => {
	describe("given the tool is pinned to a team project", () => {
		/** @scenario "The wrapper keeps a pinned tool on the pinned project" */
		it("forces ingestion with the pinned secret, over a remembered gateway preference", async () => {
			const { resolveWrapperMode } = await import("../wrapper-mode.js");
			const cfg = baseCfg({
				// Both a VK and a remembered gateway preference are present; the
				// pin is the later, more specific choice and must win.
				default_personal_vk: { id: "vk1", secret: "vk-lw-secret" },
				tool_mode: { codex: "gateway" },
				tool_project_keys: {
					codex: {
						secret: "ik-lw-pinnedproj000000_secret",
						project_id: "proj_1",
						project_slug: "acme-app",
					},
				},
			});

			const out = await resolveWrapperMode(cfg, "codex", {
				OPENAI_API_KEY: "vk-lw-secret",
			});

			expect(out.mode).toBe("ingestion");
			expect(out.vars.OTEL_EXPORTER_OTLP_HEADERS).toBe(
				"Authorization=Bearer ik-lw-pinnedproj000000_secret",
			);
			expect(out.projectScope).toEqual({ label: "acme-app" });
			expect(out.newKeyMinted).toBe(false);
			// The pinned credential is used verbatim: no probe, no mint.
			expect(cliApi.listIngestionKeys).not.toHaveBeenCalled();
			expect(cliApi.mintIngestionKey).not.toHaveBeenCalled();
		});

		it("routes to the pin's endpoint override when one is stored", async () => {
			const { resolveWrapperMode } = await import("../wrapper-mode.js");
			const cfg = baseCfg({
				tool_project_keys: {
					codex: { secret: "sk-lw-pasted", endpoint: "https://lw.acme.dev" },
				},
			});

			const out = await resolveWrapperMode(cfg, "codex", {});

			expect(out.vars.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(
				"https://lw.acme.dev/api/otel",
			);
			expect(out.endpoint).toBe("https://lw.acme.dev/api/otel");
			expect(out.ingestionToken).toBe("sk-lw-pasted");
		});

		describe("when the org policy disables direct OTLP for the tool", () => {
			/** @scenario "A pinned tool fails rather than rerouting onto the gateway" */
			it("throws otel_direct_disabled instead of silently rerouting to the gateway", async () => {
				const { resolveWrapperMode } = await import("../wrapper-mode.js");
				const cfg = baseCfg({
					default_personal_vk: { id: "vk1", secret: "vk-lw-secret" },
					tool_policies: {
						codex: { allowVk: true, allowOtelDirect: false },
					},
					tool_project_keys: {
						codex: { secret: "sk-lw-pinned" },
					},
				});

				// Rerouting silently would move telemetry (and billing) off the
				// pinned team project onto the personal gateway path.
				await expect(
					resolveWrapperMode(cfg, "codex", { OPENAI_API_KEY: "vk-lw-secret" }),
				).rejects.toMatchObject({ code: "otel_direct_disabled" });
				expect(cliApi.mintIngestionKey).not.toHaveBeenCalled();
			});
		});
	});
});

describe("resolveWrapperMode for pi", () => {
	describe("when pi is the launched tool", () => {
		/** @scenario "pi is accepted as a tool that can be launched" */
		it("resolves both launch modes instead of refusing pi as unsupported", async () => {
			const { resolveWrapperMode } = await import("../wrapper-mode.js");

			// With a virtual key: accepted, and resolved to ingestion rather
			// than the gateway — pi's platform policy sets allowVk false
			// because pi ignores the base-URL env the gateway path relies on.
			// The scenario this binds asserts ACCEPTANCE, not a particular
			// path; which path a VK lands on is asserted below.
			(cliApi.mintIngestionKey as ReturnType<typeof vi.fn>).mockResolvedValue({
				token: "sk-lw-pi-test-token",
				prefix: "sk-lw-pi",
				endpoint: "http://app.example.com/api/otel",
			});
			const withVk = baseCfg({
				default_personal_vk: { id: "vk1", secret: "vk-lw-secret" },
			});
			const gateway = await resolveWrapperMode(withVk, "pi", {
				OPENAI_BASE_URL: "http://gw.example.com/v1",
				OPENAI_API_KEY: "vk-lw-secret",
			});
			expect(gateway.mode).toBe("ingestion");

			// Without a virtual key: the ingestion path. SOURCE_TYPE_BY_TOOL now
			// has a pi slug, so the 501 `otel_direct_unsupported` refusal is gone
			// and the mint is keyed by the literal `pi` source type.
			(cliApi.mintIngestionKey as ReturnType<typeof vi.fn>).mockResolvedValue({
				token: "sk-lw-pi-test-token",
				prefix: "sk-lw-pi",
				endpoint: "http://app.example.com/api/otel",
			});
			const noVk = baseCfg();
			const ingestion = await resolveWrapperMode(noVk, "pi", {});
			expect(ingestion.mode).toBe("ingestion");
			expect(cliApi.mintIngestionKey).toHaveBeenCalledWith(noVk, "pi");
			// pi emits no telemetry of its own, so it gets NO env block at all —
			// not even the generic endpoint + headers fallback.
			//
			// An earlier revision of this test asserted the fallback WAS handed
			// over, reasoning that pi would simply ignore vars it does not read.
			// That was wrong, and the reasoning stopped one step short: the child
			// does not run alone. wrapper.ts:707 merges these into the child env
			// and buildShellReapply (wrapper.ts:296-312) re-exports them into the
			// interactive shell, so every process started inside `langwatch pi`
			// would inherit a live ingest token. See the `case "pi"` comment in
			// otel-env-block.ts and ADR-132 Revision v9.
			expect(ingestion.vars).toEqual({});
			expect(JSON.stringify(ingestion.vars)).not.toContain(
				"sk-lw-pi-test-token",
			);
		});
	});

	/**
	 * Left unbound deliberately, not by omission. The scenario that describes
	 * this — "A virtual key does not switch pi to server-side capture" in
	 * specs/coding-agent/pi-session-capture.feature — has two Thens, and only
	 * the second ("the launcher explains that pi supports direct ingestion
	 * only") is built. The first, "reading the file is started", is not: the
	 * session reader exists as modules (pi-session-stream.ts and friends) but
	 * nothing in the wrapper starts one yet. Binding here and dropping the
	 * scenario's @unimplemented tag would report that half as done on a
	 * promise, which is the exact failure the spec's own comment about
	 * claiming a read warns against. It binds when the reader is wired.
	 *
	 * What this test does guard is the routing decision that makes the read
	 * possible at all, and it is a credential-exposure guard before it is a
	 * capture one. pi hardcodes each catalog model's base URL and ignores
	 * OPENAI_BASE_URL / ANTHROPIC_BASE_URL, so gateway mode did not merely fail
	 * to capture: the paired OPENAI_API_KEY carried the user's LangWatch
	 * virtual key, and pi dialled api.openai.com with it, which rejected it and
	 * echoed it back in the 401 body. Our own credential, handed to a third
	 * party, once per run. The capture loss rode along on top — the two modes
	 * are mutually exclusive, so resolving a VK holder to gateway ALSO skipped
	 * the session-file path: zero capture, no error, a reassuring notice.
	 * Routing pi to ingestion is what stops both, because the VK is then never
	 * placed in the child env at all. ADR-132 §7.
	 */
	describe("when a personal virtual key is present and nothing is pinned", () => {
		it("keeps the virtual key out of pi's env by routing it to ingestion, while a control tool on the same config stays on the gateway", async () => {
			const { resolveWrapperMode } = await import("../wrapper-mode.js");
			(cliApi.mintIngestionKey as ReturnType<typeof vi.fn>).mockResolvedValue({
				token: "sk-lw-pi-token",
				prefix: "sk-lw-pi",
				endpoint: "http://app.example.com/api/otel",
			});

			// Same config for both tools: a VK, no persisted tool_mode, no
			// project pin, no cached org policy. The ONLY thing that differs is
			// the tool's hardcoded platform policy, so the control rules out a
			// pass caused by anything else in the resolution.
			const cfgForPi = baseCfg({
				default_personal_vk: { id: "vk1", secret: "vk-lw-secret" },
			});
			const pi = await resolveWrapperMode(cfgForPi, "pi", {
				OPENAI_BASE_URL: "http://gw.example.com/v1",
				OPENAI_API_KEY: "vk-lw-secret",
			});

			const cfgForClaude = baseCfg({
				default_personal_vk: { id: "vk1", secret: "vk-lw-secret" },
			});
			const control = await resolveWrapperMode(cfgForClaude, "claude", {
				ANTHROPIC_BASE_URL: "http://gw.example.com",
				ANTHROPIC_AUTH_TOKEN: "vk-lw-secret",
			});

			expect(control.mode).toBe("gateway");
			expect(pi.mode).toBe("ingestion");

			// The member is told why the path differs from the VK default, and
			// it is blamed on the product rather than on their admin: allowVk
			// false for pi is forced by us, so "your org admin disabled it" is
			// a lie that sends them hunting for a switch nobody flipped.
			expect(pi.notice).toContain(
				"pi is captured from its session file rather than through the gateway",
			);
			expect(pi.notice).not.toContain("org admin");

			// The gateway env the caller offered is not handed to the child.
			// The base URL matters because pi would ignore it and dial the
			// vendor directly, making the swap look like it took; the key
			// matters more, because pi WOULD send it — to api.openai.com,
			// which is not us. Neither reaches the child.
			expect(pi.vars.OPENAI_BASE_URL).toBeUndefined();
			expect(JSON.stringify(pi.vars)).not.toContain("vk-lw-secret");

			// The control proves the assertion above has teeth: on the tool
			// that really does honour the swap, the key is present and pointed
			// at the gateway, which is where a virtual key is safe.
			expect(control.vars.ANTHROPIC_AUTH_TOKEN).toBe("vk-lw-secret");
		});
	});
});

/**
 * Three holes found by refuters after the policy change landed, each verified
 * at the line before it was fixed. All three are consequences of forcing
 * allowVk false for pi, so they belong to that change, not to a later one.
 */
describe("pi's forced ingestion is honest about itself", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		(cliApi.mintIngestionKey as ReturnType<typeof vi.fn>).mockResolvedValue({
			token: "sk-lw-pi-token",
			prefix: "sk-lw-pi",
			endpoint: "http://app.example.com/api/otel",
		});
	});

	// The wording branch flips on whether cfg.tool_policies carries a row for
	// the tool, and a logged-in user's map DOES carry one for pi — so pinning
	// only the empty case would leave the blame-the-admin wording live on the
	// path almost every real user takes.
	it("never blames the org admin for pi, with or without a cached policy row", async () => {
		const { resolveWrapperMode } = await import("../wrapper-mode.js");

		const withRow = await resolveWrapperMode(
			baseCfg({
				default_personal_vk: { id: "vk1", secret: "vk-lw-secret" },
				tool_policies: { pi: { allowVk: false, allowOtelDirect: true } },
			}),
			"pi",
			{},
			[],
			"gateway",
		);
		const withoutRow = await resolveWrapperMode(
			baseCfg({ default_personal_vk: { id: "vk1", secret: "vk-lw-secret" } }),
			"pi",
			{},
			[],
			"gateway",
		);

		expect(withRow.mode).toBe("ingestion");
		expect(withoutRow.mode).toBe("ingestion");
		expect(withRow.notice).not.toContain("org admin");
		expect(withoutRow.notice).not.toContain("org admin");
		// One sentence at both seams: identical regardless of the row.
		expect(withRow.notice).toBe(withoutRow.notice);

		// The control: for a tool whose gateway path is real, an org row IS
		// the reason, and the wording still says so.
		const claude = await resolveWrapperMode(
			baseCfg({
				default_personal_vk: { id: "vk1", secret: "vk-lw-secret" },
				tool_policies: { claude: { allowVk: false, allowOtelDirect: true } },
			}),
			"claude",
			{},
			[],
			"gateway",
		);
		expect(claude.notice).toContain("by your org admin");
	});

	// Reachable only because allowVk is now forced false: an admin who turns
	// direct ingestion off lands on both-paths-disabled. The generic message
	// tells them to enable allow_vk, which for pi does nothing.
	it("tells an admin to enable the one lever that works when both paths are off", async () => {
		const { resolveWrapperMode } = await import("../wrapper-mode.js");
		const cfg = baseCfg({
			tool_policies: { pi: { allowVk: false, allowOtelDirect: false } },
		});

		await expect(
			resolveWrapperMode(cfg, "pi", {}, [], undefined),
		).rejects.toThrow(/enable allow_otel_direct/);
		await expect(
			resolveWrapperMode(cfg, "pi", {}, [], undefined),
		).rejects.toThrow(/enabling allow_vk would change nothing/);
		await expect(
			resolveWrapperMode(cfg, "pi", {}, [], undefined),
		).rejects.not.toThrow(/enable allow_vk or allow_otel_direct/);

		// The control: for every other tool both levers are real, so the
		// generic either-or advice is still what gets printed.
		const claudeCfg = baseCfg({
			tool_policies: { claude: { allowVk: false, allowOtelDirect: false } },
		});
		await expect(
			resolveWrapperMode(claudeCfg, "claude", {}, [], undefined),
		).rejects.toThrow(/enable allow_vk or allow_otel_direct/);
	});

	// The cached map at cfg.tool_policies is read unconditionally, and it is a
	// file on the user's disk. A row written before this change — or edited by
	// hand — must not put pi back on the gateway, because the vars that ride
	// that path carry the user's virtual key to a vendor that is not us.
	it("ignores a cached policy row that re-enables pi's gateway path", async () => {
		const { resolveWrapperMode } = await import("../wrapper-mode.js");
		const stale = {
			pi: { allowVk: true, allowOtelDirect: true },
			claude: { allowVk: true, allowOtelDirect: true },
		};

		const pi = await resolveWrapperMode(
			baseCfg({
				default_personal_vk: { id: "vk1", secret: "vk-lw-secret" },
				tool_policies: stale,
			}),
			"pi",
			{ OPENAI_BASE_URL: "http://gw.example.com/v1", OPENAI_API_KEY: "vk-lw-secret" },
			[],
		);
		expect(pi.mode).toBe("ingestion");
		expect(JSON.stringify(pi.vars)).not.toContain("vk-lw-secret");

		// The control proves the clamp is pi-shaped, not a blanket refusal to
		// read the cache: the same map still routes claude to the gateway.
		const claude = await resolveWrapperMode(
			baseCfg({
				default_personal_vk: { id: "vk1", secret: "vk-lw-secret" },
				tool_policies: stale,
			}),
			"claude",
			{
				ANTHROPIC_BASE_URL: "http://gw.example.com",
				ANTHROPIC_AUTH_TOKEN: "vk-lw-secret",
			},
			[],
		);
		expect(claude.mode).toBe("gateway");
		expect(claude.vars.ANTHROPIC_AUTH_TOKEN).toBe("vk-lw-secret");
	});
});
