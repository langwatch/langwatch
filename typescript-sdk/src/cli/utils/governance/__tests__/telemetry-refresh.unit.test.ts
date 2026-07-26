/**
 * Latest-login-wins tests (#6202): langwatch-authored telemetry wiring
 * persisted by a previous install must be re-synced to the current
 * login, never left to silently reroute telemetry to a stale instance.
 * Everything runs against a temp HOME / temp cwd; the control-plane API
 * is mocked at the cli-api module boundary.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	codexOtelBlockEndpoint,
	writeCodexOtelBlock,
} from "../../codex-config-toml";
import {
	appSettingsTargetFor,
	claudeProjectSettingsTarget,
	installAppEnv,
} from "../app-settings";
import * as cliApi from "../cli-api";
import type { GovernanceConfig } from "../config";
import { buildOtelEnvBlock } from "../otel-env-block";
import {
	buildScopedToolFunction,
	persistBlockToRc,
	rcPath,
	toolMarkers,
} from "../shell-rc";
import {
	ensureClaudeProjectTelemetryPin,
	otelWiringLooksLangwatchAuthored,
	refreshClaudeUserTelemetryEnv,
	refreshScopedShellFunctions,
	refreshTelemetryWiringForLogin,
	removeClaudeProjectTelemetryPin,
} from "../telemetry-refresh";

vi.mock("../cli-api", async () => {
	const actual = await vi.importActual<typeof cliApi>("../cli-api");
	return {
		...actual,
		mintIngestionKey: vi.fn(),
		listIngestionKeys: vi.fn(),
	};
});

let tmpHome: string;
let tmpCwd: string;
const origHome = process.env.HOME;
const origUserprofile = process.env.USERPROFILE;
const origCodexHome = process.env.CODEX_HOME;

const CURRENT_ENDPOINT = "http://localhost:5580/api/otel";
const CURRENT_TOKEN = "ik-lw-newlogin00000000_freshsecret";
const STALE_ENDPOINT = "https://app.langwatch.ai/api/otel";
const STALE_TOKEN = "ik-lw-stalelogin000000_oldsecret";

const currentClaudeVars = (): Record<string, string> =>
	buildOtelEnvBlock("claude", CURRENT_ENDPOINT, CURRENT_TOKEN);

function baseCfg(overrides: Partial<GovernanceConfig> = {}): GovernanceConfig {
	return {
		gateway_url: "http://localhost:5563",
		control_plane_url: "http://localhost:5580",
		access_token: "tok",
		organization: { id: "o1", slug: "acme" },
		...overrides,
	};
}

beforeEach(() => {
	tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "lw-telemetry-refresh-"));
	tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), "lw-refresh-cwd-"));
	process.env.HOME = tmpHome;
	process.env.USERPROFILE = tmpHome;
	delete process.env.CODEX_HOME;
});

afterEach(() => {
	process.env.HOME = origHome;
	process.env.USERPROFILE = origUserprofile;
	if (origCodexHome === undefined) delete process.env.CODEX_HOME;
	else process.env.CODEX_HOME = origCodexHome;
	fs.rmSync(tmpHome, { recursive: true, force: true });
	fs.rmSync(tmpCwd, { recursive: true, force: true });
	vi.clearAllMocks();
});

describe("otelWiringLooksLangwatchAuthored", () => {
	describe("when the env carries a langwatch ingest-key bearer", () => {
		it("treats ik-lw- and sk-lw- bearers as langwatch-authored", () => {
			expect(
				otelWiringLooksLangwatchAuthored({
					OTEL_EXPORTER_OTLP_HEADERS: `Authorization=Bearer ${STALE_TOKEN}`,
				}),
			).toBe(true);
			expect(
				otelWiringLooksLangwatchAuthored({
					OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer sk-lw-legacy",
				}),
			).toBe(true);
		});
	});

	describe("when the env carries a langwatch OTLP endpoint", () => {
		it("treats an /api/otel endpoint as langwatch-authored", () => {
			expect(
				otelWiringLooksLangwatchAuthored({
					OTEL_EXPORTER_OTLP_ENDPOINT: STALE_ENDPOINT,
				}),
			).toBe(true);
		});
	});

	describe("when the env points at a third-party collector", () => {
		it("refuses both a foreign endpoint and a foreign bearer", () => {
			expect(
				otelWiringLooksLangwatchAuthored({
					OTEL_EXPORTER_OTLP_ENDPOINT: "https://api.honeycomb.io",
					OTEL_EXPORTER_OTLP_HEADERS: "x-honeycomb-team=abc",
				}),
			).toBe(false);
		});
	});

	describe("when no identity-bearing key is present", () => {
		it("treats the env as refreshable", () => {
			expect(
				otelWiringLooksLangwatchAuthored({ CLAUDE_CODE_ENABLE_TELEMETRY: "1" }),
			).toBe(true);
		});
	});
});

describe("refreshClaudeUserTelemetryEnv", () => {
	describe("given a stale langwatch block in ~/.claude/settings.json", () => {
		beforeEach(() => {
			installAppEnv(appSettingsTargetFor("claude")!, {
				...buildOtelEnvBlock("claude", STALE_ENDPOINT, STALE_TOKEN),
			});
		});

		describe("when refreshed with the current run's values", () => {
			it("rewrites the block in place to the current endpoint and key", () => {
				const label = refreshClaudeUserTelemetryEnv({
					vars: currentClaudeVars(),
				});

				expect(label).toContain("~/.claude/settings.json");
				const written = JSON.parse(
					fs.readFileSync(appSettingsTargetFor("claude")!.path, "utf8"),
				);
				expect(written.env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(CURRENT_ENDPOINT);
				expect(written.env.OTEL_EXPORTER_OTLP_HEADERS).toBe(
					`Authorization=Bearer ${CURRENT_TOKEN}`,
				);
			});

			it("preserves user-authored settings around the block verbatim", () => {
				const target = appSettingsTargetFor("claude")!;
				const settings = JSON.parse(fs.readFileSync(target.path, "utf8"));
				settings.env.MY_OWN = "keep";
				settings.model = "claude-sonnet-5";
				fs.writeFileSync(target.path, JSON.stringify(settings, null, 2));

				refreshClaudeUserTelemetryEnv({ vars: currentClaudeVars() });

				const after = JSON.parse(fs.readFileSync(target.path, "utf8"));
				expect(after.env.MY_OWN).toBe("keep");
				expect(after.model).toBe("claude-sonnet-5");
			});
		});
	});

	describe("given the block already matches the current values", () => {
		it("returns null and leaves the file untouched", () => {
			const target = appSettingsTargetFor("claude")!;
			installAppEnv(target, currentClaudeVars());
			const before = fs.readFileSync(target.path, "utf8");

			expect(refreshClaudeUserTelemetryEnv({ vars: currentClaudeVars() })).toBe(
				null,
			);
			expect(fs.readFileSync(target.path, "utf8")).toBe(before);
		});
	});

	describe("given no persisted block at all", () => {
		it("returns null and writes nothing (the persist offer owns installs)", () => {
			expect(refreshClaudeUserTelemetryEnv({ vars: currentClaudeVars() })).toBe(
				null,
			);
			expect(fs.existsSync(appSettingsTargetFor("claude")!.path)).toBe(false);
		});
	});

	describe("given the user's own OTLP wiring in settings.json", () => {
		it("leaves a non-langwatch-shaped env block byte-for-byte unchanged", () => {
			const target = appSettingsTargetFor("claude")!;
			installAppEnv(target, {
				OTEL_EXPORTER_OTLP_ENDPOINT: "https://api.honeycomb.io",
				OTEL_EXPORTER_OTLP_HEADERS: "x-honeycomb-team=abc",
			});
			const before = fs.readFileSync(target.path, "utf8");

			expect(refreshClaudeUserTelemetryEnv({ vars: currentClaudeVars() })).toBe(
				null,
			);
			expect(fs.readFileSync(target.path, "utf8")).toBe(before);
		});
	});
});

describe("refreshScopedShellFunctions", () => {
	const staleGeminiVars = buildOtelEnvBlock(
		"gemini",
		STALE_ENDPOINT,
		STALE_TOKEN,
	);
	const currentGeminiVars = buildOtelEnvBlock(
		"gemini",
		CURRENT_ENDPOINT,
		CURRENT_TOKEN,
	);

	describe("given a stale gemini function in ~/.zshrc and ~/.bashrc", () => {
		beforeEach(() => {
			for (const shell of ["zsh", "bash"] as const) {
				persistBlockToRc(
					shell,
					buildScopedToolFunction("gemini", staleGeminiVars, shell),
					toolMarkers("gemini"),
				);
			}
		});

		describe("when refreshed with the current run's values", () => {
			it("rewrites the marker block in every rc that carries one", () => {
				const labels = refreshScopedShellFunctions({
					tool: "gemini",
					vars: currentGeminiVars,
				});

				expect(labels).toHaveLength(2);
				for (const shell of ["zsh", "bash"] as const) {
					const rc = fs.readFileSync(rcPath(shell), "utf8");
					expect(rc).toContain(CURRENT_ENDPOINT);
					expect(rc).not.toContain(STALE_ENDPOINT);
					expect(rc).not.toContain(STALE_TOKEN);
				}
			});

			it("preserves user-authored rc lines outside the markers", () => {
				const zshrc = rcPath("zsh");
				fs.writeFileSync(
					zshrc,
					`alias ll='ls -la'\n${fs.readFileSync(zshrc, "utf8")}export MY_VAR=1\n`,
				);

				refreshScopedShellFunctions({
					tool: "gemini",
					vars: currentGeminiVars,
				});

				const rc = fs.readFileSync(zshrc, "utf8");
				expect(rc).toContain("alias ll='ls -la'");
				expect(rc).toContain("export MY_VAR=1");
				expect(
					(rc.match(/# >>> langwatch gemini begin >>>/g) ?? []).length,
				).toBe(1);
			});
		});
	});

	describe("given the function already carries the current values", () => {
		it("touches nothing and reports no labels", () => {
			persistBlockToRc(
				"zsh",
				buildScopedToolFunction("gemini", currentGeminiVars, "zsh"),
				toolMarkers("gemini"),
			);
			const before = fs.readFileSync(rcPath("zsh"), "utf8");

			const labels = refreshScopedShellFunctions({
				tool: "gemini",
				vars: currentGeminiVars,
			});

			expect(labels).toEqual([]);
			expect(fs.readFileSync(rcPath("zsh"), "utf8")).toBe(before);
		});
	});

	describe("given no rc carries the tool's marker block", () => {
		it("writes nothing", () => {
			const labels = refreshScopedShellFunctions({
				tool: "opencode",
				vars: buildOtelEnvBlock("opencode", CURRENT_ENDPOINT, CURRENT_TOKEN),
			});
			expect(labels).toEqual([]);
			expect(fs.existsSync(rcPath("zsh"))).toBe(false);
		});
	});
});

describe("ensureClaudeProjectTelemetryPin", () => {
	describe("when no pin exists in the working directory", () => {
		it("creates .claude/settings.local.json with the run's env", () => {
			const result = ensureClaudeProjectTelemetryPin({
				vars: currentClaudeVars(),
				cwd: tmpCwd,
			});

			expect(result.action).toBe("created");
			const written = JSON.parse(fs.readFileSync(result.path, "utf8"));
			expect(written.env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(CURRENT_ENDPOINT);
			expect(written.env.CLAUDE_CODE_ENABLE_TELEMETRY).toBe("1");
		});

		describe("and the directory is a git repository", () => {
			it("adds the pin to .git/info/exclude so the ingest key can't be committed", () => {
				execFileSync("git", ["init", "-q"], { cwd: tmpCwd });

				ensureClaudeProjectTelemetryPin({
					vars: currentClaudeVars(),
					cwd: tmpCwd,
				});

				const exclude = fs.readFileSync(
					path.join(tmpCwd, ".git", "info", "exclude"),
					"utf8",
				);
				expect(exclude).toContain("**/.claude/settings.local.json");
			});
		});

		describe("and the directory is not a git repository", () => {
			it("still creates the pin without erroring", () => {
				const result = ensureClaudeProjectTelemetryPin({
					vars: currentClaudeVars(),
					cwd: tmpCwd,
				});
				expect(result.action).toBe("created");
			});
		});
	});

	describe("when a pin from a previous login exists", () => {
		it("refreshes it to the current login's values", () => {
			installAppEnv(
				claudeProjectSettingsTarget(tmpCwd),
				buildOtelEnvBlock("claude", STALE_ENDPOINT, STALE_TOKEN),
			);

			const result = ensureClaudeProjectTelemetryPin({
				vars: currentClaudeVars(),
				cwd: tmpCwd,
			});

			expect(result.action).toBe("updated");
			const written = JSON.parse(fs.readFileSync(result.path, "utf8"));
			expect(written.env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(CURRENT_ENDPOINT);
			expect(written.env.OTEL_EXPORTER_OTLP_HEADERS).toBe(
				`Authorization=Bearer ${CURRENT_TOKEN}`,
			);
		});
	});

	describe("when the pin already matches the current login", () => {
		it("reports unchanged and does not rewrite the file", () => {
			const target = claudeProjectSettingsTarget(tmpCwd);
			installAppEnv(target, currentClaudeVars());
			const before = fs.statSync(target.path).mtimeMs;

			const result = ensureClaudeProjectTelemetryPin({
				vars: currentClaudeVars(),
				cwd: tmpCwd,
			});

			expect(result.action).toBe("unchanged");
			expect(fs.statSync(target.path).mtimeMs).toBe(before);
		});
	});

	describe("when the project file carries the user's own OTLP wiring", () => {
		it("skips and leaves the file byte-for-byte unchanged", () => {
			const target = claudeProjectSettingsTarget(tmpCwd);
			installAppEnv(target, {
				OTEL_EXPORTER_OTLP_ENDPOINT: "https://api.honeycomb.io",
				OTEL_EXPORTER_OTLP_HEADERS: "x-honeycomb-team=abc",
			});
			const before = fs.readFileSync(target.path, "utf8");

			const result = ensureClaudeProjectTelemetryPin({
				vars: currentClaudeVars(),
				cwd: tmpCwd,
			});

			expect(result.action).toBe("skipped");
			expect(fs.readFileSync(target.path, "utf8")).toBe(before);
		});
	});

	describe("when the project file has unrelated user content", () => {
		it("merges the pin in and preserves the user's keys", () => {
			const target = claudeProjectSettingsTarget(tmpCwd);
			fs.mkdirSync(path.dirname(target.path), { recursive: true });
			fs.writeFileSync(
				target.path,
				JSON.stringify(
					{ permissions: { allow: ["Bash(git status)"] } },
					null,
					2,
				),
			);

			ensureClaudeProjectTelemetryPin({
				vars: currentClaudeVars(),
				cwd: tmpCwd,
			});

			const written = JSON.parse(fs.readFileSync(target.path, "utf8"));
			expect(written.permissions).toEqual({ allow: ["Bash(git status)"] });
			expect(written.env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(CURRENT_ENDPOINT);
		});
	});
});

describe("removeClaudeProjectTelemetryPin", () => {
	describe("when the pin holds only langwatch keys", () => {
		it("removes the file and the empty .claude directory", () => {
			const target = claudeProjectSettingsTarget(tmpCwd);
			installAppEnv(target, currentClaudeVars());

			expect(removeClaudeProjectTelemetryPin({ cwd: tmpCwd })).toBe(true);
			expect(fs.existsSync(target.path)).toBe(false);
			expect(fs.existsSync(path.dirname(target.path))).toBe(false);
		});
	});

	describe("when the pin coexists with user content", () => {
		it("strips only the langwatch keys and keeps the file", () => {
			const target = claudeProjectSettingsTarget(tmpCwd);
			fs.mkdirSync(path.dirname(target.path), { recursive: true });
			fs.writeFileSync(
				target.path,
				JSON.stringify(
					{
						env: { ...currentClaudeVars(), MY_OWN: "keep" },
						permissions: { allow: ["Bash(git status)"] },
					},
					null,
					2,
				),
			);

			expect(removeClaudeProjectTelemetryPin({ cwd: tmpCwd })).toBe(true);
			const after = JSON.parse(fs.readFileSync(target.path, "utf8"));
			expect(after.env).toEqual({ MY_OWN: "keep" });
			expect(after.permissions).toEqual({ allow: ["Bash(git status)"] });
		});
	});

	describe("when the file carries only the user's own OTLP wiring", () => {
		it("returns false and leaves it unchanged", () => {
			const target = claudeProjectSettingsTarget(tmpCwd);
			installAppEnv(target, {
				OTEL_EXPORTER_OTLP_ENDPOINT: "https://api.honeycomb.io",
			});
			const before = fs.readFileSync(target.path, "utf8");

			expect(removeClaudeProjectTelemetryPin({ cwd: tmpCwd })).toBe(false);
			expect(fs.readFileSync(target.path, "utf8")).toBe(before);
		});
	});

	describe("when no pin exists", () => {
		it("returns false (idempotent)", () => {
			expect(removeClaudeProjectTelemetryPin({ cwd: tmpCwd })).toBe(false);
		});
	});
});

describe("refreshTelemetryWiringForLogin", () => {
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
					endpoint: `${STALE_ENDPOINT}/v1/traces`,
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
					path.join(tmpHome, ".codex", "config.toml"),
					"utf8",
				);
				expect(codexToml).not.toContain(STALE_TOKEN);

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
					path.join(tmpHome, ".codex", "config.toml"),
					"utf8",
				);
				expect(codexToml).toMatch(/headers = .*Bearer ik-lw-code/);
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
});
