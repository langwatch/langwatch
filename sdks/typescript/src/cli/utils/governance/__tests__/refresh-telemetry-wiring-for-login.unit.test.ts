/**
 * refreshTelemetryWiringForLogin — the login-time half of latest-login-wins
 * (#6202). Walks every tool's persisted wiring and re-points any
 * langwatch-authored block whose endpoint differs from the login that just
 * completed, minting (or reusing) a live ingest key on the new instance.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	codexGatewayBlockBaseUrl,
	codexOtelBlockEndpoint,
	writeCodexGatewayBlock,
	writeCodexOtelBlock,
} from "../../codex-config-toml";
import { appSettingsTargetFor, installAppEnv } from "../app-settings";
import * as cliApi from "../cli-api";
import { buildOtelEnvBlock } from "../otel-env-block";
import {
	buildScopedToolFunction,
	persistBlockToRc,
	rcPath,
	toolMarkers,
} from "../shell-rc";
import {
	keptWiringLines,
	refreshTelemetryWiringForLogin,
} from "../telemetry-refresh";
import { runningCodeRestartNotice } from "../running-code";

vi.mock("../running-code", () => ({ runningCodeRestartNotice: vi.fn() }));
import {
	baseCfg,
	CURRENT_ENDPOINT,
	CURRENT_TOKEN,
	currentClaudeVars,
	installTempHomeAndCwd,
	STALE_ENDPOINT,
	STALE_TOKEN,
} from "./telemetry-refresh-test-helpers";

vi.mock("../cli-api", async () => {
	const actual = await vi.importActual<typeof cliApi>("../cli-api");
	return {
		...actual,
		mintIngestionKey: vi.fn(),
		listIngestionKeys: vi.fn(),
	};
});

const temp = installTempHomeAndCwd();

describe("refreshTelemetryWiringForLogin", () => {
	describe("when login changes the instance used by an active langwatch code launcher", () => {
		/** @scenario "Login refresh reports the same restart advice" */
		it("returns restart advice with the successful wiring refresh", async () => {
			const notice =
				"Restart `langwatch code` to apply the updated telemetry settings.";
			vi.mocked(runningCodeRestartNotice).mockReturnValue(notice);
			persistBlockToRc(
				"zsh",
				buildScopedToolFunction(
					"code",
					buildOtelEnvBlock("code", STALE_ENDPOINT, STALE_TOKEN),
					"zsh",
				),
				toolMarkers("code"),
			);
			vi.mocked(cliApi.mintIngestionKey).mockResolvedValue({
				token: CURRENT_TOKEN,
				prefix: "ik-lw-test",
				endpoint: CURRENT_ENDPOINT,
			});

			const result = await refreshTelemetryWiringForLogin(baseCfg());

			expect(result).toMatchObject({ warnings: [notice] });
		});
	});
	describe("given persisted wiring pointing at a previous instance", () => {
		beforeEach(() => {
			// claude → user-level settings env at the stale instance
			installAppEnv(
				appSettingsTargetFor("claude")!,
				buildOtelEnvBlock("claude", STALE_ENDPOINT, STALE_TOKEN),
			);
			// codex → [otel] marker block at the stale instance
			writeCodexOtelBlock(
				{
					baseEndpoint: STALE_ENDPOINT,
					ingestionToken: STALE_TOKEN,
				},
				{ persistAuthHeader: true },
			);
			// gemini → scoped zsh function at the stale instance
			persistBlockToRc(
				"zsh",
				buildScopedToolFunction(
					"gemini",
					buildOtelEnvBlock("gemini", STALE_ENDPOINT, STALE_TOKEN),
					"zsh",
				),
				toolMarkers("gemini"),
			);

			(cliApi.listIngestionKeys as ReturnType<typeof vi.fn>).mockResolvedValue(
				[],
			);
			// vi.mocked keeps mintIngestionKey's real (async) signature, so the
			// Promise-returning implementation typechecks and lints cleanly.
			vi.mocked(cliApi.mintIngestionKey).mockImplementation(
				async (_cfg, sourceType) => ({
					token: `ik-lw-${sourceType.slice(0, 4)}000000000000_minted`,
					prefix: `ik-lw-${sourceType.slice(0, 4)}`,
					endpoint: CURRENT_ENDPOINT,
				}),
			);
		});

		describe("when the user logs into a different instance", () => {
			it("re-points every langwatch-authored block at the new instance", async () => {
				const cfg = baseCfg();
				const result = await refreshTelemetryWiringForLogin(cfg);

				expect(result.labels.length).toBeGreaterThanOrEqual(3);

				const claudeEnv = JSON.parse(
					fs.readFileSync(appSettingsTargetFor("claude")!.path, "utf8"),
				).env;
				expect(claudeEnv.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(CURRENT_ENDPOINT);
				expect(claudeEnv.OTEL_EXPORTER_OTLP_HEADERS).not.toContain(STALE_TOKEN);

				expect(codexOtelBlockEndpoint()).toBe(`${CURRENT_ENDPOINT}/v1/traces`);
				const codexToml = fs.readFileSync(
					path.join(temp.home, ".codex", "config.toml"),
					"utf8",
				);
				expect(codexToml).not.toContain(STALE_TOKEN);
				// The refresh heals the harvest wiring beside the exporters: a
				// device whose block predates the notify seam gains it here.
				expect(codexToml).toContain("langwatch codex notify begin");

				const zshrc = fs.readFileSync(rcPath("zsh"), "utf8");
				expect(zshrc).toContain(CURRENT_ENDPOINT);
				expect(zshrc).not.toContain(STALE_ENDPOINT);
			});

			it("mints one key per stale tool and stores them on the config", async () => {
				const cfg = baseCfg();
				const result = await refreshTelemetryWiringForLogin(cfg);

				expect(result.mintedAny).toBe(true);
				const minted = (
					cliApi.mintIngestionKey as ReturnType<typeof vi.fn>
				).mock.calls.map((c: unknown[]) => c[1]);
				expect(minted).toEqual(
					expect.arrayContaining(["claude_code", "codex", "gemini"]),
				);
				expect(minted).not.toContain("opencode");
				expect(cfg.default_personal_ingest_keys?.claude_code?.secret).toContain(
					"minted",
				);
			});

			it("keeps the persisted codex Authorization header, rotated to the new key", async () => {
				await refreshTelemetryWiringForLogin(baseCfg());
				const codexToml = fs.readFileSync(
					path.join(temp.home, ".codex", "config.toml"),
					"utf8",
				);
				expect(codexToml).toMatch(/headers = .*Bearer ik-lw-code/);
			});
		});

		describe("when a tool is pinned to a project", () => {
			/** @scenario "A project-pinned tool is not re-pointed by a new login" */
			it("leaves that tool's wiring alone and re-points the rest", async () => {
				const cfg = baseCfg({
					tool_project_keys: { codex: { secret: "sk-lw-project-pin" } },
				});

				const result = await refreshTelemetryWiringForLogin(cfg);

				// codex keeps its wiring: the pin is deliberate scope, not stale
				// personal wiring, so the stale endpoint stays and no codex key
				// is minted.
				expect(codexOtelBlockEndpoint()).toBe(`${STALE_ENDPOINT}/v1/traces`);
				expect(
					vi.mocked(cliApi.mintIngestionKey).mock.calls.map((c) => c[1]),
				).not.toContain("codex");
				// The unpinned tools are still refreshed.
				expect(result.labels.some((l) => l.includes("claude"))).toBe(true);
				expect(result.labels.some((l) => l.includes("gemini"))).toBe(true);
				expect(result.labels.some((l) => l.includes("codex"))).toBe(false);
			});

			/** @scenario "A codex pinned to a project still gets the guidance on login" */
			it("still writes the declare guidance for a pinned codex", async () => {
				const cfg = baseCfg({
					tool_project_keys: { codex: { secret: "sk-lw-project-pin" } },
				});
				const agentsMd = path.join(temp.home, ".codex", "AGENTS.md");
				expect(fs.existsSync(agentsMd)).toBe(false);

				await refreshTelemetryWiringForLogin(cfg);

				// The guidance names no endpoint and no key, so the pin has no
				// reason to withhold it; the wiring the pin does own is untouched.
				expect(fs.readFileSync(agentsMd, "utf8")).toContain(
					"langwatch ingest context",
				);
				expect(codexOtelBlockEndpoint()).toBe(`${STALE_ENDPOINT}/v1/traces`);
			});
		});

		describe("when the org policy forbids direct OTLP for a tool", () => {
			it("leaves that tool's wiring alone and mints nothing for it", async () => {
				const cfg = baseCfg({
					tool_policies: {
						claude: { allowVk: true, allowOtelDirect: false },
					},
				});

				await refreshTelemetryWiringForLogin(cfg);

				const claudeEnv = JSON.parse(
					fs.readFileSync(appSettingsTargetFor("claude")!.path, "utf8"),
				).env;
				expect(claudeEnv.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(STALE_ENDPOINT);
				const minted = (
					cliApi.mintIngestionKey as ReturnType<typeof vi.fn>
				).mock.calls.map((c: unknown[]) => c[1]);
				expect(minted).not.toContain("claude_code");
			});
		});

		describe("when the mint fails for one tool", () => {
			it("skips that tool and still refreshes the others", async () => {
				vi.mocked(cliApi.mintIngestionKey).mockImplementation(
					async (_cfg, sourceType) => {
						if (sourceType === "claude_code") {
							throw new Error("no personal workspace yet");
						}
						return {
							token: `ik-lw-${sourceType.slice(0, 4)}000000000000_minted`,
							prefix: `ik-lw-${sourceType.slice(0, 4)}`,
							endpoint: CURRENT_ENDPOINT,
						};
					},
				);

				const result = await refreshTelemetryWiringForLogin(baseCfg());

				const claudeEnv = JSON.parse(
					fs.readFileSync(appSettingsTargetFor("claude")!.path, "utf8"),
				).env;
				expect(claudeEnv.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(STALE_ENDPOINT);
				expect(codexOtelBlockEndpoint()).toBe(`${CURRENT_ENDPOINT}/v1/traces`);
				expect(result.labels.some((l) => l.includes("codex"))).toBe(true);
			});
		});
	});

	describe("given a cached ingest key minted on a previous instance (#6202 regression)", () => {
		describe("when listIngestionKeys rejects during the login-time refresh", () => {
			it("mints a fresh key rather than reusing the cached one on the new endpoint", async () => {
				// A cache-liveness check that can't reach the server must NEVER
				// fall back to reusing this secret here: it was minted on the
				// OLD instance, and pairing it with the NEW endpoint would
				// silently corrupt working wiring into a broken combination
				// (new endpoint, token that was never valid there) -
				// reintroducing the exact hijack this PR fixes. The per-run
				// wrapper path (resolveWrapperMode) intentionally keeps the
				// opposite, offline-first behavior for a disconnected device
				// that already has a working key for ITS current instance;
				// only this login-refresh caller must refuse the fallback.
				const cfg = baseCfg({
					default_personal_ingest_keys: {
						claude_code: { secret: STALE_TOKEN, prefix: "ik-lw-stal" },
					},
				});
				installAppEnv(
					appSettingsTargetFor("claude")!,
					buildOtelEnvBlock("claude", STALE_ENDPOINT, STALE_TOKEN),
				);

				vi.mocked(cliApi.listIngestionKeys).mockRejectedValue(
					new Error("network unreachable"),
				);
				vi.mocked(cliApi.mintIngestionKey).mockResolvedValue({
					token: CURRENT_TOKEN,
					prefix: "ik-lw-newl",
					endpoint: CURRENT_ENDPOINT,
				});

				await refreshTelemetryWiringForLogin(cfg);

				expect(cliApi.mintIngestionKey).toHaveBeenCalledWith(
					expect.any(Object),
					"claude_code",
				);
				const claudeEnv = JSON.parse(
					fs.readFileSync(appSettingsTargetFor("claude")!.path, "utf8"),
				).env;
				expect(claudeEnv.OTEL_EXPORTER_OTLP_HEADERS).toContain(CURRENT_TOKEN);
				expect(claudeEnv.OTEL_EXPORTER_OTLP_HEADERS).not.toContain(STALE_TOKEN);
			});
		});
	});

	describe("given wiring already pointing at the login's instance", () => {
		it("neither mints nor rewrites anything", async () => {
			const target = appSettingsTargetFor("claude")!;
			installAppEnv(target, currentClaudeVars());
			const before = fs.readFileSync(target.path, "utf8");

			const result = await refreshTelemetryWiringForLogin(baseCfg());

			expect(result.labels).toEqual([]);
			expect(result.mintedAny).toBe(false);
			expect(cliApi.mintIngestionKey).not.toHaveBeenCalled();
			expect(cliApi.listIngestionKeys).not.toHaveBeenCalled();
			expect(fs.readFileSync(target.path, "utf8")).toBe(before);
		});
	});

	describe("given no persisted wiring at all", () => {
		it("does nothing and never talks to the control plane", async () => {
			const result = await refreshTelemetryWiringForLogin(baseCfg());

			expect(result.labels).toEqual([]);
			expect(cliApi.mintIngestionKey).not.toHaveBeenCalled();
			expect(cliApi.listIngestionKeys).not.toHaveBeenCalled();
		});
	});

	describe("given the user's own OTLP wiring in claude settings", () => {
		it("never touches a non-langwatch-shaped block", async () => {
			const target = appSettingsTargetFor("claude")!;
			installAppEnv(target, {
				OTEL_EXPORTER_OTLP_ENDPOINT: "https://api.honeycomb.io",
				OTEL_EXPORTER_OTLP_HEADERS: "x-honeycomb-team=abc",
			});
			const before = fs.readFileSync(target.path, "utf8");

			const result = await refreshTelemetryWiringForLogin(baseCfg());

			expect(result.labels).toEqual([]);
			expect(fs.readFileSync(target.path, "utf8")).toBe(before);
		});
	});

	describe("given claude and codex wiring that reports to another instance", () => {
		const codexConfig = () => path.join(temp.home, ".codex", "config.toml");
		const wireAt = (endpoint: string) => {
			installAppEnv(
				appSettingsTargetFor("claude")!,
				buildOtelEnvBlock("claude", endpoint, STALE_TOKEN),
			);
			writeCodexOtelBlock(
				{ baseEndpoint: endpoint, ingestionToken: STALE_TOKEN },
				{ persistAuthHeader: true },
			);
		};
		const wiringBytes = () => ({
			claude: fs.readFileSync(appSettingsTargetFor("claude")!.path, "utf8"),
			codex: fs.readFileSync(codexConfig(), "utf8"),
		});

		beforeEach(() => {
			vi.mocked(cliApi.listIngestionKeys).mockResolvedValue([]);
			vi.mocked(cliApi.mintIngestionKey).mockResolvedValue({
				token: CURRENT_TOKEN,
				prefix: "ik-lw-test",
				endpoint: CURRENT_ENDPOINT,
			});
		});

		describe("when the login lives in a config file of its own", () => {
			/** @scenario "A login kept in its own config file never touches the home's wiring" */
			it("mints nothing, writes nothing and reports the tools it left alone", async () => {
				wireAt(STALE_ENDPOINT);
				const before = wiringBytes();
				process.env.LANGWATCH_CLI_CONFIG = path.join(
					temp.cwd,
					"throwaway",
					"config.json",
				);

				const result = await refreshTelemetryWiringForLogin(baseCfg());

				expect(cliApi.mintIngestionKey).not.toHaveBeenCalled();
				expect(cliApi.listIngestionKeys).not.toHaveBeenCalled();
				expect(wiringBytes()).toEqual(before);
				expect(result.labels).toEqual([]);
				expect(result.kept).toEqual({
					tools: ["claude", "codex"],
					reason: "isolated_config",
				});
			});
		});

		describe("when LANGWATCH_CLI_CONFIG names the home's default config file", () => {
			/** @scenario "LANGWATCH_CLI_CONFIG naming the home's default file is the machine's login" */
			it("refreshes the wiring as the machine's login", async () => {
				wireAt(STALE_ENDPOINT);
				process.env.LANGWATCH_CLI_CONFIG = path.join(
					temp.home,
					".langwatch",
					"config.json",
				);

				const result = await refreshTelemetryWiringForLogin(baseCfg());

				const claudeEnv = JSON.parse(wiringBytes().claude).env;
				expect(claudeEnv.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(CURRENT_ENDPOINT);
				expect(result.kept).toBeUndefined();
			});
		});

		describe("when the login is on this machine", () => {
			const localCfg = () =>
				baseCfg({
					control_plane_url: "http://localhost:5620",
					gateway_url: "http://localhost:5563",
				});

			/** @scenario "A login on this machine does not take over wiring that reports elsewhere" */
			it("leaves wiring that reports to a deployment elsewhere", async () => {
				wireAt(STALE_ENDPOINT);
				const before = wiringBytes();

				const result = await refreshTelemetryWiringForLogin(localCfg());

				expect(cliApi.mintIngestionKey).not.toHaveBeenCalled();
				expect(wiringBytes()).toEqual(before);
				expect(result.labels).toEqual([]);
				expect(result.kept).toEqual({
					tools: ["claude", "codex"],
					reason: "loopback_login",
				});
			});

			/** @scenario "A login on this machine still refreshes wiring that already reports to this machine" */
			it("refreshes wiring that reports to another port of this machine", async () => {
				wireAt("http://127.0.0.1:5580/api/otel");
				vi.mocked(cliApi.mintIngestionKey).mockResolvedValue({
					token: CURRENT_TOKEN,
					prefix: "ik-lw-test",
					endpoint: "http://localhost:5620/api/otel",
				});

				const result = await refreshTelemetryWiringForLogin(localCfg());

				const claudeEnv = JSON.parse(wiringBytes().claude).env;
				expect(claudeEnv.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(
					"http://localhost:5620/api/otel",
				);
				expect(claudeEnv.OTEL_EXPORTER_OTLP_HEADERS).toContain(CURRENT_TOKEN);
				expect(codexOtelBlockEndpoint()).toBe(
					"http://localhost:5620/api/otel/v1/traces",
				);
				expect(result.kept).toBeUndefined();
			});

			describe("given a tool wired through a shell function", () => {
				const wireGeminiAt = (endpoint: string) =>
					persistBlockToRc(
						"zsh",
						buildScopedToolFunction(
							"gemini",
							buildOtelEnvBlock("gemini", endpoint, STALE_TOKEN),
							"zsh",
						),
						toolMarkers("gemini"),
					);

				/** @scenario "A host that only starts with localhost is not this machine" */
				it("leaves a function that reports to localhost.acme.test", async () => {
					wireGeminiAt("https://localhost.acme.test/api/otel");
					const before = fs.readFileSync(rcPath("zsh"), "utf8");

					const result = await refreshTelemetryWiringForLogin(localCfg());

					expect(cliApi.mintIngestionKey).not.toHaveBeenCalled();
					expect(fs.readFileSync(rcPath("zsh"), "utf8")).toBe(before);
					expect(result.kept).toEqual({
						tools: ["gemini"],
						reason: "loopback_login",
					});
				});

				/** @scenario "A shell function that reports to this machine is refreshed by a login on this machine" */
				it("refreshes a function that reports to another port of this machine", async () => {
					wireGeminiAt("http://[::1]:5580/api/otel");
					vi.mocked(cliApi.mintIngestionKey).mockResolvedValue({
						token: CURRENT_TOKEN,
						prefix: "ik-lw-test",
						endpoint: "http://localhost:5620/api/otel",
					});

					const result = await refreshTelemetryWiringForLogin(localCfg());

					const zshrc = fs.readFileSync(rcPath("zsh"), "utf8");
					expect(zshrc).toContain("http://localhost:5620/api/otel");
					expect(zshrc).not.toContain("[::1]:5580");
					expect(result.kept).toBeUndefined();
				});
			});

			/** @scenario "A login on this machine leaves a codex gateway block that routes elsewhere" */
			it("leaves a codex gateway block whose base_url is elsewhere", async () => {
				writeCodexGatewayBlock({ gatewayUrl: "https://gateway.acme.test" });
				const before = fs.readFileSync(codexConfig(), "utf8");

				const result = await refreshTelemetryWiringForLogin(localCfg());

				expect(fs.readFileSync(codexConfig(), "utf8")).toBe(before);
				expect(codexGatewayBlockBaseUrl()).toContain("gateway.acme.test");
				expect(result.kept).toEqual({
					tools: ["codex"],
					reason: "loopback_login",
				});
			});
		});
	});

	describe("when the login words the wiring it left alone", () => {
		/** @scenario "The login says which wiring it left alone and how to move it" */
		it("names the tools, the reason and the command that moves one over", () => {
			const lines = keptWiringLines({
				tools: ["claude", "codex"],
				reason: "loopback_login",
			});

			expect(lines[0]).toContain("claude, codex");
			expect(lines[0]).toContain("reports to another LangWatch");
			expect(lines[1]).toContain("langwatch claude");
		});

		it("names LANGWATCH_CLI_CONFIG for a login in its own config file", () => {
			const lines = keptWiringLines({
				tools: ["codex"],
				reason: "isolated_config",
			});

			expect(lines).toHaveLength(1);
			expect(lines[0]).toContain("LANGWATCH_CLI_CONFIG");
		});
	});
});
