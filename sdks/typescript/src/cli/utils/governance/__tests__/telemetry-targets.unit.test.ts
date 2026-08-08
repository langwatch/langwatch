/**
 * The logout scan surface: `scanTelemetryTargets()` must find every place
 * `langwatch <tool>` persisted telemetry wiring and remove exactly those
 * regions. Exercised against a real temp HOME with each target seeded the
 * same way the install path writes it.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	writeCodexGatewayBlock,
	writeCodexOtelBlock,
} from "../../codex-config-toml";
import {
	appSettingsTargetFor,
	claudeProjectSettingsTarget,
	installAppEnv,
} from "../app-settings";
import {
	installOpencodeSessionContextPlugin,
	OPENCODE_PLUGIN_FILE_NAME,
	opencodePluginTarget,
} from "../opencode-plugin";
import { telemetryEnvVarNames } from "../otel-env-block";
import {
	installSessionContextHooks,
	sessionContextHookCommand,
} from "../session-context-hooks";
import {
	buildScopedToolFunction,
	persistBlockToRc,
	toolMarkers,
} from "../shell-rc";
import { scanTelemetryTargets } from "../telemetry-targets";

let tmpHome: string;
const origHome = process.env.HOME;
const origUserprofile = process.env.USERPROFILE;
const origCodexHome = process.env.CODEX_HOME;
const origXdgConfigHome = process.env.XDG_CONFIG_HOME;

const presentLabels = (): string[] =>
	scanTelemetryTargets()
		.filter((t) => t.present)
		.map((t) => t.label);

beforeEach(() => {
	tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "lw-telemetry-targets-"));
	process.env.HOME = tmpHome;
	process.env.USERPROFILE = tmpHome;
	// codex resolves its home from CODEX_HOME first; keep it unset so it
	// falls back to ~/.codex under the temp HOME. opencode reads
	// XDG_CONFIG_HOME the same way, for ~/.config/opencode.
	delete process.env.CODEX_HOME;
	delete process.env.XDG_CONFIG_HOME;
});

afterEach(() => {
	process.env.HOME = origHome;
	process.env.USERPROFILE = origUserprofile;
	if (origCodexHome === undefined) delete process.env.CODEX_HOME;
	else process.env.CODEX_HOME = origCodexHome;
	if (origXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
	else process.env.XDG_CONFIG_HOME = origXdgConfigHome;
	fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe("scanTelemetryTargets", () => {
	describe("when nothing is installed", () => {
		it("reports no present targets", () => {
			expect(presentLabels()).toEqual([]);
		});
	});

	describe("when claude, codex, and a shell function are installed", () => {
		beforeEach(() => {
			// claude → settings.json env
			const claude = appSettingsTargetFor("claude")!;
			installAppEnv(claude, {
				OTEL_EXPORTER_OTLP_ENDPOINT: "http://app/api/otel",
				CLAUDE_CODE_ENABLE_TELEMETRY: "1",
			});
			// codex → [otel] block in config.toml
			writeCodexOtelBlock(
				{
					endpoint: "http://app/api/otel/v1/traces",
					ingestionToken: "sk-lw-SECRET",
				},
				{ persistAuthHeader: true },
			);
			// gemini → scoped shell function in ~/.zshrc
			persistBlockToRc(
				"zsh",
				buildScopedToolFunction(
					"gemini",
					{ OTEL_EXPORTER_OTLP_ENDPOINT: "http://app/api/otel" },
					"zsh",
				),
				toolMarkers("gemini"),
			);
		});

		it("reports the claude, codex, and gemini targets as present", () => {
			const labels = presentLabels();
			expect(labels.some((l) => l.startsWith("claude telemetry env"))).toBe(
				true,
			);
			expect(labels.some((l) => l.startsWith("codex [otel] block"))).toBe(true);
			expect(labels.some((l) => l.startsWith("gemini shell function"))).toBe(
				true,
			);
		});

		it("removes every present target, and a re-scan finds nothing", () => {
			for (const t of scanTelemetryTargets().filter((t) => t.present)) {
				expect(t.remove()).toBe(true);
			}
			expect(presentLabels()).toEqual([]);
		});

		it("strips the claude OTEL keys from settings.json but keeps user keys", () => {
			const claude = appSettingsTargetFor("claude")!;
			// seed a user key alongside
			const settings = JSON.parse(fs.readFileSync(claude.path, "utf8"));
			settings.env.MY_OWN = "keep";
			settings.model = "claude-sonnet-5";
			fs.writeFileSync(claude.path, JSON.stringify(settings, null, 2));

			for (const t of scanTelemetryTargets().filter((t) => t.present)) {
				t.remove();
			}

			const after = JSON.parse(fs.readFileSync(claude.path, "utf8"));
			expect(after.env).toEqual({ MY_OWN: "keep" });
			expect(after.model).toBe("claude-sonnet-5");
		});
	});

	describe("when settings.json carries the langwatch hooks and a user's own", () => {
		const userEntry = {
			hooks: [{ type: "command", command: "./scripts/session-log.sh" }],
		};

		/** @scenario "Logout removes exactly the LangWatch hook entries" */
		it("removes the langwatch entries and leaves the user's hook", () => {
			const claude = appSettingsTargetFor("claude")!;
			fs.mkdirSync(path.dirname(claude.path), { recursive: true });
			fs.writeFileSync(
				claude.path,
				JSON.stringify({ hooks: { SessionStart: [userEntry] } }, null, 2),
			);
			installSessionContextHooks({ tool: "claude_code" });

			expect(
				presentLabels().some((l) => l.startsWith("claude session hooks")),
			).toBe(true);

			for (const t of scanTelemetryTargets().filter((t) => t.present)) {
				expect(t.remove()).toBe(true);
			}

			const after = JSON.parse(fs.readFileSync(claude.path, "utf8"));
			expect(after.hooks).toEqual({ SessionStart: [userEntry] });
			expect(JSON.stringify(after)).not.toContain(
				sessionContextHookCommand("claude_code"),
			);
			expect(presentLabels()).toEqual([]);
		});
	});

	describe("when the codex hooks and the opencode plugin are installed", () => {
		/** @scenario "Logout removes the codex hooks and the opencode plugin" */
		it("reports both, then removes both", () => {
			installSessionContextHooks({ tool: "codex" });
			installOpencodeSessionContextPlugin();

			const labels = presentLabels();
			expect(labels.some((l) => l.startsWith("codex session hooks"))).toBe(
				true,
			);
			expect(labels.some((l) => l.startsWith("opencode session plugin"))).toBe(
				true,
			);

			for (const t of scanTelemetryTargets().filter((t) => t.present)) {
				expect(t.remove()).toBe(true);
			}

			expect(presentLabels()).toEqual([]);
			expect(fs.existsSync(opencodePluginTarget().path)).toBe(false);
		});

		/** @scenario "A plugin file LangWatch did not write is never removed" */
		it("leaves a plugin of the same name somebody else wrote", () => {
			const target = opencodePluginTarget();
			fs.mkdirSync(path.dirname(target.path), { recursive: true });
			fs.writeFileSync(target.path, "export const Mine = async () => ({});\n");

			expect(
				presentLabels().some((l) => l.startsWith("opencode session plugin")),
			).toBe(false);

			for (const t of scanTelemetryTargets()) t.remove();

			expect(fs.readFileSync(target.path, "utf8")).toBe(
				"export const Mine = async () => ({});\n",
			);
			expect(path.basename(target.path)).toBe(OPENCODE_PLUGIN_FILE_NAME);
		});
	});

	describe("when the codex gateway (Path A) profile is installed", () => {
		it("reports the gateway block and profile file, then removes both", () => {
			writeCodexGatewayBlock({ gatewayUrl: "https://gateway.langwatch.ai" });
			const labels = presentLabels();
			expect(labels.some((l) => l.startsWith("codex gateway block"))).toBe(
				true,
			);
			expect(
				labels.some((l) => l.startsWith("codex langwatch profile file")),
			).toBe(true);

			for (const t of scanTelemetryTargets().filter((t) => t.present)) {
				t.remove();
			}
			expect(presentLabels()).toEqual([]);
		});
	});

	describe("when the working directory carries a claude project pin", () => {
		let cwdSpy: ReturnType<typeof vi.spyOn>;

		beforeEach(() => {
			const projectDir = path.join(tmpHome, "project");
			fs.mkdirSync(projectDir, { recursive: true });
			cwdSpy = vi
				.spyOn(process, "cwd")
				.mockReturnValue(projectDir) as ReturnType<typeof vi.spyOn>;
			installAppEnv(claudeProjectSettingsTarget(projectDir), {
				OTEL_EXPORTER_OTLP_ENDPOINT: "http://app/api/otel",
				OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer ik-lw-x_y",
				CLAUDE_CODE_ENABLE_TELEMETRY: "1",
			});
		});

		afterEach(() => {
			cwdSpy.mockRestore();
		});

		it("reports the pin as present and removes it on logout", () => {
			expect(
				presentLabels().some((l) =>
					l.startsWith("claude project telemetry pin"),
				),
			).toBe(true);

			for (const t of scanTelemetryTargets().filter((t) => t.present)) {
				expect(t.remove()).toBe(true);
			}

			expect(
				fs.existsSync(
					path.join(tmpHome, "project", ".claude", "settings.local.json"),
				),
			).toBe(false);
			expect(presentLabels()).toEqual([]);
		});
	});

	describe("when settings.json carries the user's own OTLP wiring under the same key names", () => {
		it("does not report the claude target as present, and remove() leaves it untouched", () => {
			// OTEL_EXPORTER_OTLP_ENDPOINT / OTEL_EXPORTER_OTLP_HEADERS are
			// standard OpenTelemetry env var names — a user could plausibly
			// point them at a collector of their own (Honeycomb here) under
			// the exact same keys langwatch writes. Presence of the NAMES is
			// not ownership; the scan must not offer this for removal.
			const claude = appSettingsTargetFor("claude")!;
			installAppEnv(claude, {
				OTEL_EXPORTER_OTLP_ENDPOINT: "https://api.honeycomb.io",
				OTEL_EXPORTER_OTLP_HEADERS: "x-honeycomb-team=abc",
			});
			const before = fs.readFileSync(claude.path, "utf8");

			expect(
				presentLabels().some((l) => l.startsWith("claude telemetry env")),
			).toBe(false);

			const target = scanTelemetryTargets().find((t) =>
				t.label.startsWith("claude telemetry env"),
			)!;
			expect(target.remove()).toBe(false);
			expect(fs.readFileSync(claude.path, "utf8")).toBe(before);
		});
	});

	describe("when the project pin directory carries the user's own OTLP wiring", () => {
		let cwdSpy: ReturnType<typeof vi.spyOn>;

		beforeEach(() => {
			const projectDir = path.join(tmpHome, "project");
			fs.mkdirSync(projectDir, { recursive: true });
			cwdSpy = vi
				.spyOn(process, "cwd")
				.mockReturnValue(projectDir) as ReturnType<typeof vi.spyOn>;
			installAppEnv(claudeProjectSettingsTarget(projectDir), {
				OTEL_EXPORTER_OTLP_ENDPOINT: "https://api.honeycomb.io",
			});
		});

		afterEach(() => {
			cwdSpy.mockRestore();
		});

		it("does not report the project pin as present, and remove() leaves it untouched", () => {
			const pinPath = path.join(
				tmpHome,
				"project",
				".claude",
				"settings.local.json",
			);
			const before = fs.readFileSync(pinPath, "utf8");

			expect(
				presentLabels().some((l) =>
					l.startsWith("claude project telemetry pin"),
				),
			).toBe(false);

			const target = scanTelemetryTargets().find((t) =>
				t.label.startsWith("claude project telemetry pin"),
			)!;
			expect(target.remove()).toBe(false);
			expect(fs.readFileSync(pinPath, "utf8")).toBe(before);
		});
	});

	describe("when an unrelated file happens to live at the codex profile path", () => {
		it("does not report the codex profile target as present, and remove() leaves it untouched", () => {
			// The path name (~/.codex/langwatch-gateway.config.toml) is
			// distinctive but not proof of ownership on its own.
			const profilePath = path.join(
				tmpHome,
				".codex",
				"langwatch-gateway.config.toml",
			);
			fs.mkdirSync(path.dirname(profilePath), { recursive: true });
			fs.writeFileSync(profilePath, "# a file the user put here themselves\n");

			expect(
				presentLabels().some((l) =>
					l.startsWith("codex langwatch profile file"),
				),
			).toBe(false);

			const target = scanTelemetryTargets().find((t) =>
				t.label.startsWith("codex langwatch profile file"),
			)!;
			expect(target.remove()).toBe(false);
			expect(fs.existsSync(profilePath)).toBe(true);
		});
	});

	describe("when a block lives in ~/.zshrc but $SHELL is bash", () => {
		it("still finds it — the scan sweeps all shells", () => {
			const prevShell = process.env.SHELL;
			process.env.SHELL = "/bin/bash";
			try {
				persistBlockToRc(
					"zsh",
					buildScopedToolFunction(
						"opencode",
						{ OTEL_EXPORTER_OTLP_ENDPOINT: "http://app/api/otel" },
						"zsh",
					),
					toolMarkers("opencode"),
				);
				expect(
					presentLabels().some((l) => l.startsWith("opencode shell function")),
				).toBe(true);
			} finally {
				if (prevShell === undefined) delete process.env.SHELL;
				else process.env.SHELL = prevShell;
			}
		});
	});

	it("uses the same key set the install path writes (no drift)", () => {
		// guard the app-settings removal against the claude key list drifting
		// from buildOtelEnvBlock: the removal keys ARE telemetryEnvVarNames.
		const keys = telemetryEnvVarNames("claude");
		expect(keys).toContain("OTEL_EXPORTER_OTLP_ENDPOINT");
		expect(keys).toContain("CLAUDE_CODE_ENABLE_TELEMETRY");
	});
});
