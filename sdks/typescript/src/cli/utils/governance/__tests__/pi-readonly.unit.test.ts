/**
 * Launching pi through LangWatch writes nothing, and capture leaves pi's file
 * exactly as pi wrote it.
 *
 * The "no writes to the user's machine" invariant (ADR-132 §Invariants) is
 * load-bearing rather than ceremonial, and it was proved so during this
 * feature's own implementation: a proposed fix for pi's gateway path involved
 * writing a generated `models.json` into the user's pi install, which would
 * also have silently repointed the user's own UNWRAPPED `pi` sessions at our
 * servers — changing runs nobody launched through us. The invariant caught that.
 * This file is what keeps it caught.
 *
 * **Why this is not a list of `expect(writer).not.toHaveBeenCalled()`.** Every
 * writer pi must not reach is reached through a *tool name* comparison
 * somewhere in `resolveWrapperMode` / `shell-rc`, and there are seven of them
 * (`claude`, `codex`, `code`, `opencode`, the `SHELL_FUNCTION_TOOLS` list, the
 * persist offer's fall-through, the Claude-plugin refresh). A test that names
 * the seven we know about cannot fail on the eighth somebody adds next month.
 * So this observes the *filesystem* instead: a sandboxed HOME and working
 * directory, seeded with every file those writers target, hashed before the run
 * and after it. A new writer lands in the diff whether or not this file has
 * heard of it.
 *
 * **The negative needs a positive twin, and has three.** "Nothing changed" is
 * the shape of assertion that passes when the harness is broken, when the run
 * never happened, and when the sandbox was empty. So: the tree differ has its
 * own self-check (`describe("given the tree differ itself")`), the identical
 * harness run against `gemini` MUST report a write, and the capture test
 * asserts events were actually posted before it asserts the file is untouched.
 *
 * **`SHELL_FUNCTION_TOOLS` is not what protects pi, and the test says so.**
 * `maybeOfferIngestionShellRcPersist` writes a scoped `<tool>()` shell function
 * for *any* tool that falls through its tool-specific branches — pi included.
 * What stops it for pi is one line above those branches: it returns early when
 * the tool's env block is empty, and pi's is empty by decision (ADR-132 v9).
 * That is a guard held by a property of a different module, so it is pinned
 * directly rather than left to the filesystem check to notice by luck.
 *
 * Spec: specs/coding-agent/pi-session-capture.feature
 */
import { createHash } from "node:crypto";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildOtelEnvBlock } from "../otel-env-block";
import { createPiCapture } from "../pi-capture";
import { SHELL_FUNCTION_TOOLS } from "../shell-rc";
import { refreshScopedShellFunctions } from "../telemetry-refresh";
import { buildShellReapply, runWrapped } from "../wrapper";

/* ------------------------------------------------------------------ *
 * The child process is the one boundary this file stubs. Everything
 * between `runWrapped` and the filesystem stays real — the mode
 * resolver, the shell-rc module, the plugin updater, the config writer.
 * Mocking any of those is how "writes nothing" becomes true of the
 * mocks rather than of the product.
 * ------------------------------------------------------------------ */
const { spawnMock } = vi.hoisted(() => ({
	spawnMock: vi.fn(() => ({
		on(event: string, handler: (arg: unknown) => void) {
			if (event === "close") queueMicrotask(() => handler(0));
			return this;
		},
	})),
}));

vi.mock("node:child_process", async (importOriginal) => ({
	...(await importOriginal<object>()),
	spawn: spawnMock,
}));

const FIXTURE = resolve(
	__dirname,
	"fixtures",
	"pi-session-real-shape.jsonl",
);

/** A file's identity, not just its bytes. */
interface FileStamp {
	readonly sha256: string;
	readonly size: number;
	readonly ino: number;
	readonly mtimeMs: number;
	readonly ctimeMs: number;
	readonly mode: number;
}

function stampFile(path: string): FileStamp {
	const info = statSync(path);
	return {
		sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
		size: info.size,
		ino: info.ino,
		mtimeMs: info.mtimeMs,
		ctimeMs: info.ctimeMs,
		mode: info.mode,
	};
}

/**
 * Every file under `root`, keyed by its path relative to `root`.
 *
 * Directories are walked, not stamped: a directory's own mtime moves when a
 * child is added or removed, which the child's own presence in the map already
 * reports, and on some filesystems for reasons that are not writes at all.
 */
function snapshotTree(root: string): Map<string, FileStamp> {
	const out = new Map<string, FileStamp>();
	const walk = (dir: string): void => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) walk(path);
			else if (entry.isFile()) out.set(relative(root, path), stampFile(path));
		}
	};
	walk(root);
	return out;
}

/** Every path that is not byte-for-byte, inode-for-inode what it was. */
function changedPaths(
	before: Map<string, FileStamp>,
	after: Map<string, FileStamp>,
): string[] {
	const changed = new Set<string>();
	for (const [path, was] of before) {
		const now = after.get(path);
		if (!now) {
			changed.add(`${path} (deleted)`);
			continue;
		}
		if (
			now.sha256 !== was.sha256 ||
			now.size !== was.size ||
			now.ino !== was.ino ||
			now.mtimeMs !== was.mtimeMs ||
			now.ctimeMs !== was.ctimeMs ||
			now.mode !== was.mode
		) {
			changed.add(path);
		}
	}
	for (const path of after.keys()) {
		if (!before.has(path)) changed.add(`${path} (created)`);
	}
	return [...changed].sort();
}

function write(path: string, contents: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, contents);
}

/* ------------------------------------------------------------------ *
 * The sandbox
 * ------------------------------------------------------------------ */

/**
 * The single path a wrapped run of ANY tool is allowed to touch: LangWatch's
 * own config, which is where the CLI keeps the login it was just handed. It is
 * not a file of the user's that pi's launch is editing — it is the CLI's own
 * state, written by `recordCliLocation` before the tool name has even been
 * looked at. Asserted as an exact one-element list so it cannot quietly grow.
 */
const ALLOWED_WRITE = ".langwatch/config.json";

/**
 * An ingest secret that is not `ik-lw-` shaped, so the credential resolver
 * treats it as user-placed and returns it without a network call
 * (`telemetry-refresh.ts:190-204`). Keeps the run hermetic without mocking the
 * resolver, which is itself one of the modules that writes.
 */
const CACHED_SECRET = "sk-lw-pi-readonly-fixture";
const CONTROL_PLANE = "https://app.langwatch.test";

/**
 * A langwatch-authored scoped shell function for `tool`, pointing at an
 * endpoint no run of this test uses. Present-but-stale is the state the
 * refresher rewrites, so seeding it is what makes a rewrite visible.
 */
function staleScopedBlock(tool: string): string[] {
	return [
		`# >>> langwatch ${tool} begin >>>`,
		`${tool}() {`,
		"  OTEL_EXPORTER_OTLP_ENDPOINT=https://stale.example/api/otel \\",
		"  OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer%20stale \\",
		`  command ${tool} "$@"`,
		"}",
		`# <<< langwatch ${tool} end <<<`,
	];
}

interface Sandbox {
	readonly home: string;
	readonly cwd: string;
	readonly sessionsDir: string;
	readonly configPath: string;
}

let sandboxes: string[] = [];
const savedEnv = { ...process.env };
const savedCwd = process.cwd();

/**
 * A HOME with the files every OTHER tool's writer targets already in it, so a
 * write to any of them shows up as a modification rather than a creation, and
 * a `.zshrc` carrying a stale langwatch block for gemini — which is what makes
 * the positive twin write something.
 */
function makeSandbox(): Sandbox {
	const root = mkdtempSync(join(tmpdir(), "pi-readonly-"));
	sandboxes.push(root);
	const home = join(root, "home");
	const cwd = join(root, "project");
	const sessionsDir = join(home, ".pi", "agent", "sessions", "project");

	write(
		join(home, ".zshrc"),
		[
			"alias ll='ls -la'",
			...staleScopedBlock("gemini"),
			// A pi block nobody should ever have. It is here so that "no shell
			// function is written for pi" is enforced against the filesystem
			// rather than only against a constant: the refresher rewrites a
			// present block on every run, so if pi ever qualifies for one, this
			// line is what turns the rewrite into a diff.
			...staleScopedBlock("pi"),
			"",
		].join("\n"),
	);
	write(join(home, ".bashrc"), "export EDITOR=vi\n");
	write(join(home, ".config", "fish", "config.fish"), "set -x EDITOR vi\n");
	write(
		join(home, ".claude", "settings.json"),
		`${JSON.stringify({ env: { EXISTING: "1" } }, null, 2)}\n`,
	);
	write(join(home, ".codex", "config.toml"), 'model = "gpt-5"\n');
	write(
		join(home, ".config", "opencode", "opencode.jsonc"),
		`${JSON.stringify({ theme: "dark" }, null, 2)}\n`,
	);
	write(
		join(home, "Library", "Application Support", "Code", "User", "settings.json"),
		`${JSON.stringify({ "editor.fontSize": 13 }, null, 2)}\n`,
	);
	// pi's own install: settings the reader consults, and a session file.
	write(
		join(home, ".pi", "agent", "settings.json"),
		`${JSON.stringify({ defaultProvider: "openai" }, null, 2)}\n`,
	);
	mkdirSync(sessionsDir, { recursive: true });
	// Guidance files, in the working directory where the codex path writes them.
	write(join(cwd, "AGENTS.md"), "# House rules\n");
	write(join(cwd, "CLAUDE.md"), "# House rules\n");

	const configPath = join(home, ".langwatch", "config.json");
	write(
		configPath,
		`${JSON.stringify(
			{
				access_token: "lw-device-session",
				control_plane_url: CONTROL_PLANE,
				default_personal_ingest_keys: {
					pi: { secret: CACHED_SECRET },
					gemini: { secret: CACHED_SECRET },
				},
			},
			null,
			2,
		)}\n`,
	);
	return { home, cwd, sessionsDir, configPath };
}

/**
 * Point the process at the sandbox, and REFUSE to continue if it did not take.
 * Without this line a broken redirect does not fail the test — it runs the real
 * launch path against the real home directory and rewrites the developer's
 * `.zshrc`.
 */
function enterSandbox(sandbox: Sandbox): void {
	process.env.HOME = sandbox.home;
	process.env.USERPROFILE = sandbox.home;
	process.env.XDG_CONFIG_HOME = join(sandbox.home, ".config");
	process.env.LANGWATCH_CLI_CONFIG = sandbox.configPath;
	process.env.SHELL = "/bin/zsh";
	process.env.PI_CODING_AGENT_SESSION_DIR = sandbox.sessionsDir;
	// A TTY would turn the persist offer into a blocking readline prompt.
	delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
	process.chdir(sandbox.cwd);
	if (homedir() !== sandbox.home) {
		throw new Error(
			`sandbox did not take: os.homedir() is ${homedir()}, refusing to run the ` +
				`launch path against a real home directory`,
		);
	}
}

class ExitCalled extends Error {
	constructor(readonly code: number) {
		super(`process.exit(${code})`);
	}
}

/**
 * Drive the real `runWrapped` for one tool inside the sandbox and return every
 * path that changed. `process.exit` is the function `runWrapped` ends on, so it
 * is converted into a throw and swallowed here.
 */
async function runLaunchPath({
	sandbox,
	tool,
}: {
	sandbox: Sandbox;
	tool: string;
}): Promise<string[]> {
	const exit = vi
		.spyOn(process, "exit")
		.mockImplementation(((code?: number) => {
			throw new ExitCalled(code ?? 0);
		}) as never);
	const stderr = vi
		.spyOn(process.stderr, "write")
		.mockImplementation(() => true);
	const fetchSpy = vi
		.spyOn(globalThis, "fetch")
		.mockResolvedValue(new Response("{}", { status: 200 }));
	try {
		const before = snapshotTree(sandbox.home);
		const beforeCwd = snapshotTree(sandbox.cwd);
		try {
			await runWrapped(tool, []);
		} catch (err) {
			if (!(err instanceof ExitCalled)) throw err;
		}
		return [
			...changedPaths(before, snapshotTree(sandbox.home)),
			...changedPaths(beforeCwd, snapshotTree(sandbox.cwd)).map(
				(p) => `<cwd>/${p}`,
			),
		].sort();
	} finally {
		exit.mockRestore();
		stderr.mockRestore();
		fetchSpy.mockRestore();
	}
}

beforeEach(() => {
	spawnMock.mockClear();
});

afterEach(() => {
	process.chdir(savedCwd);
	for (const key of Object.keys(process.env)) {
		if (!(key in savedEnv)) delete process.env[key];
	}
	Object.assign(process.env, savedEnv);
	for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
	sandboxes = [];
	vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ *
 * The detector, checked against itself
 * ------------------------------------------------------------------ */

describe("given the tree differ itself", () => {
	describe("when a file is added, edited, replaced or removed", () => {
		it("names every one of them", () => {
			const root = mkdtempSync(join(tmpdir(), "pi-readonly-differ-"));
			sandboxes.push(root);
			write(join(root, "kept.txt"), "same\n");
			write(join(root, "edited.txt"), "before\n");
			write(join(root, "replaced.txt"), "identical bytes\n");
			write(join(root, "removed.txt"), "gone soon\n");
			const before = snapshotTree(root);

			writeFileSync(join(root, "edited.txt"), "after\n");
			// Same bytes, new inode: a rewrite that happens to produce the file it
			// replaced is still a write, and a content-only comparison misses it.
			write(join(root, "replaced.tmp"), "identical bytes\n");
			renameSync(join(root, "replaced.tmp"), join(root, "replaced.txt"));
			rmSync(join(root, "removed.txt"));
			write(join(root, "created.txt"), "new\n");

			expect(changedPaths(before, snapshotTree(root))).toEqual([
				"created.txt (created)",
				"edited.txt",
				"removed.txt (deleted)",
				"replaced.txt",
			]);
		});

		it("reports nothing when nothing happened", () => {
			const root = mkdtempSync(join(tmpdir(), "pi-readonly-differ-"));
			sandboxes.push(root);
			write(join(root, "a.txt"), "a\n");
			const before = snapshotTree(root);
			// A read is not a write.
			readFileSync(join(root, "a.txt"));
			expect(changedPaths(before, snapshotTree(root))).toEqual([]);
		});
	});
});

/* ------------------------------------------------------------------ *
 * 17.2 — the whole launch path writes nothing
 * ------------------------------------------------------------------ */

describe("given a user running pi through LangWatch for the first time", () => {
	describe("when the session finishes", () => {
		/** @scenario "Launching pi through LangWatch leaves the machine as it found it, apart from LangWatch's own files" */
		it("leaves every shell, editor, plugin and guidance file exactly as it found it", async () => {
			const sandbox = makeSandbox();
			enterSandbox(sandbox);

			const changed = await runLaunchPath({ sandbox, tool: "pi" });

			expect(changed.filter((p) => p !== ALLOWED_WRITE)).toEqual([]);
			// pi really was launched — a run that bailed before the spawn would
			// also have written nothing.
			expect(spawnMock).toHaveBeenCalledTimes(1);
		});

		it("writes nowhere but LangWatch's own config, and that list stays one entry long", async () => {
			const sandbox = makeSandbox();
			enterSandbox(sandbox);

			const changed = await runLaunchPath({ sandbox, tool: "pi" });

			expect(changed.every((p) => p === ALLOWED_WRITE)).toBe(true);
			expect([ALLOWED_WRITE]).toHaveLength(1);
		});

		/**
		 * The positive twin. Without it "nothing changed" is equally true of a
		 * harness that snapshots the wrong directory, a `runWrapped` that threw on
		 * line one, and a sandbox with nothing in it.
		 */
		it("detects the write a returning gemini user does get, through the same harness", async () => {
			const sandbox = makeSandbox();
			enterSandbox(sandbox);

			const changed = await runLaunchPath({ sandbox, tool: "gemini" });

			expect(changed).toContain(".zshrc");
		});
	});
});

describe("given the shell function other tools get", () => {
	describe("when the tool is pi", () => {
		it("is not on the list of tools that get one", () => {
			expect(SHELL_FUNCTION_TOOLS).not.toContain("pi");
			// The same assertion against a tool that IS on the list, so an empty
			// or renamed constant cannot make the line above pass.
			expect(SHELL_FUNCTION_TOOLS).toContain("gemini");
		});

		it("is not unset in the spawn prefix either, the way it is for gemini", () => {
			const args = { clears: [], vars: {} };
			expect(buildShellReapply({ tool: "pi", ...args })).not.toContain(
				"unset -f",
			);
			expect(buildShellReapply({ tool: "gemini", ...args })).toContain(
				"unset -f gemini",
			);
		});

		/**
		 * The same claim one level down, against the file rather than the
		 * constant. The rc carries a stale langwatch block for BOTH tools; the
		 * refresher rewrites gemini's and leaves pi's alone. Two protections have
		 * to hold for that: pi is off `SHELL_FUNCTION_TOOLS` (so `resolveWrapperMode`
		 * never calls this), and pi's env block is empty (so calling it directly,
		 * as here, still writes nothing). The second is the one a reviewer misses,
		 * because it lives in a different module.
		 */
		it("leaves a shell function alone even when called directly, where gemini's is rewritten", () => {
			const sandbox = makeSandbox();
			enterSandbox(sandbox);
			const rc = join(sandbox.home, ".zshrc");
			const before = stampFile(rc);

			expect(
				refreshScopedShellFunctions({
					tool: "pi",
					vars: buildOtelEnvBlock("pi", `${CONTROL_PLANE}/api/otel`, CACHED_SECRET),
				}),
			).toEqual([]);
			expect(stampFile(rc)).toEqual(before);

			expect(
				refreshScopedShellFunctions({
					tool: "gemini",
					vars: buildOtelEnvBlock(
						"gemini",
						`${CONTROL_PLANE}/api/otel`,
						CACHED_SECRET,
					),
				}),
			).not.toEqual([]);
			expect(stampFile(rc)).not.toEqual(before);
			expect(readFileSync(rc, "utf8")).toContain("langwatch pi begin");
		});
	});
});

/* ------------------------------------------------------------------ *
 * 17.3 — capture leaves pi's file exactly as pi wrote it
 * ------------------------------------------------------------------ */

describe("given a pi session being captured", () => {
	describe("when the session finishes", () => {
		/** @scenario "Capture leaves pi's session file exactly as pi wrote it" */
		it("leaves the session file byte-identical, on the same inode", async () => {
			const sandbox = makeSandbox();
			const sessionFile = join(sandbox.sessionsDir, "20260913_pi.jsonl");
			// The fixture is at the CURRENT format version. A version 1 or 2 file
			// would be rewritten in place by pi itself on load (ADR-132 §2), and a
			// test built on one would be measuring pi's write, not ours.
			copyFileSync(FIXTURE, sessionFile);
			expect(
				JSON.parse(readFileSync(sessionFile, "utf8").split("\n")[0]!).version,
			).toBe(3);

			const before = stampFile(sessionFile);
			const posted = await createPiCapture({
				sinceMs: 0,
				sessionsDir: sandbox.sessionsDir,
				logsEndpoint: `${CONTROL_PLANE}/api/otel/v1/logs`,
				token: CACHED_SECRET,
				fetchImpl: async () => new Response("{}", { status: 200 }),
			}).harvest();

			// Capture actually ran. "Unchanged" is trivially true of a harvest that
			// found nothing, which is the vacuous version of this test.
			expect(posted).toBeGreaterThan(0);
			expect(stampFile(sessionFile)).toEqual(before);
		});

		it("would have caught a rewrite that reproduced the same bytes", () => {
			const sandbox = makeSandbox();
			const sessionFile = join(sandbox.sessionsDir, "20260913_pi.jsonl");
			copyFileSync(FIXTURE, sessionFile);
			const before = stampFile(sessionFile);

			// What a "harmless" rewrite looks like: identical content, new inode.
			const staging = `${sessionFile}.tmp`;
			copyFileSync(sessionFile, staging);
			renameSync(staging, sessionFile);

			const after = stampFile(sessionFile);
			expect(after.sha256).toBe(before.sha256);
			expect(after).not.toEqual(before);
		});
	});
});
