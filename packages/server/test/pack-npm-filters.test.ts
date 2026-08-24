import { execFileSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * What the npm artifact's staging filters keep and drop.
 *
 * dev/scripts/pack-npm.sh copies the `files` list into a staging tree with a
 * set of rsync patterns, and rsync matches a pattern without a slash against
 * EVERY path component. A working-tree artifact named there by its bare name
 * therefore also removes any source file or directory that happens to share
 * the name, anywhere in any shipped tree. That has reached npm twice: once as
 * `--exclude=reports`, which took src/server/app-layer/reports with it and
 * killed the published server at first boot inside the ClickHouse migration.
 *
 * The script is run for real against a small fixture repository rather than
 * having its patterns re-read here, so the assertions are about rsync's own
 * matching and not about a second reading of it.
 */

const scriptPath = join(
	__dirname,
	"..",
	"..",
	"..",
	"dev",
	"scripts",
	"pack-npm.sh",
);

let fixture: string | undefined;

afterEach(() => {
	if (fixture) rmSync(fixture, { recursive: true, force: true });
	fixture = undefined;
});

function write({
	root,
	relPath,
	content = "x\n",
}: {
	root: string;
	relPath: string;
	content?: string;
}): void {
	const full = join(root, relPath);
	mkdirSync(dirname(full), { recursive: true });
	writeFileSync(full, content);
}

/**
 * A repository the pack script can run against: the real script at the path it
 * resolves its root from, a root manifest whose `files` names the trees below,
 * a lockfile, and a git index for the guard to compare against.
 */
function buildFixture(trackedPaths: string[]): string {
	const root = mkdtempSync(join(tmpdir(), "pack-filters-"));
	fixture = root;

	mkdirSync(join(root, "dev", "scripts"), { recursive: true });
	copyFileSync(scriptPath, join(root, "dev", "scripts", "pack-npm.sh"));
	writeFileSync(
		join(root, "package.json"),
		`${JSON.stringify(
			{
				name: "@langwatch/server",
				version: "0.0.0",
				files: [
					".env.example",
					"platform/app/",
					"packages/api/",
					"dev/scripts/",
				],
			},
			null,
			2,
		)}\n`,
	);
	writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
	writeFileSync(join(root, "README.md"), "fixture\n");
	writeFileSync(join(root, "LICENSE.md"), "fixture\n");

	for (const relPath of trackedPaths) write({ root, relPath });

	execFileSync("git", ["init", "-q"], { cwd: root });
	execFileSync("git", ["add", "-A"], { cwd: root });
	return root;
}

function runCheck({
	root,
	extraArgs = [],
}: {
	root: string;
	extraArgs?: string[];
}): { code: number; output: string } {
	const args = [
		join(root, "dev", "scripts", "pack-npm.sh"),
		"--check-filters",
		...extraArgs,
	];
	try {
		const output = execFileSync("bash", args, {
			cwd: root,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		return { code: 0, output };
	} catch (error) {
		const failure = error as {
			status?: number;
			stdout?: string;
			stderr?: string;
		};
		return {
			code: failure.status ?? 1,
			output: `${failure.stdout ?? ""}${failure.stderr ?? ""}`,
		};
	}
}

/** Whether a repo-relative path survived into the staged tree. */
function staged({
	stageDir,
	relPath,
}: {
	stageDir: string;
	relPath: string;
}): boolean {
	return existsSync(join(stageDir, "app", relPath));
}

describe("npm pack staging filters", () => {
	it("keeps source whose name collides with a working-tree artifact", () => {
		// Each of these shares a name with something the script strips from the
		// app root. A bare-name pattern removes all of them; an anchored one
		// reaches only the app root copy.
		const collisions = [
			"platform/app/src/server/licenses.json",
			"platform/app/src/server/quickwit/index.ts",
			"packages/api/src/licenses.json",
			"packages/api/src/quickwit-client.ts",
			"platform/app/src/server/reports/report-chart.service.ts",
		];
		const root = buildFixture(collisions);
		const stageDir = join(root, "_stage");

		const { code } = runCheck({ root, extraArgs: ["--stage-to", stageDir] });

		expect(code).toBe(0);
		for (const relPath of collisions) {
			expect(staged({ stageDir, relPath })).toBe(true);
		}
	});

	it("passes when a shipped tree tracks an ignore file", () => {
		// Ignore files are stripped at every depth on purpose, because one inside
		// the package gets a second say over what npm publishes. The guard has to
		// know that, or a tracked .gitignore anywhere reads as lost source: one
		// added under dev/scripts turned every branch that merged main red.
		const root = buildFixture([
			"dev/scripts/dogfood/multimodal/.gitignore",
			"platform/app/.gitignore",
			"packages/api/.npmignore",
			"platform/app/Dockerfile",
			"platform/app/.dockerignore",
			"packages/api/src/__tests__/unit.test.ts",
			"packages/api/tests/integration.test.ts",
		]);

		const { code, output } = runCheck({ root });
		expect(output).toContain("staging keeps every tracked source file");
		expect(code).toBe(0);
	});

	it("ships .env.example and no other dotenv file", () => {
		// `.env.example` is tracked documentation, and the re-include that keeps
		// it has to be read before the excludes that would take it. The staged
		// tree is what says whether that ordering still holds, because the guard
		// exempts every other dotenv file and so cannot report one.
		const root = buildFixture([
			".env.example",
			".env.staging",
			"platform/app/src/server/config.ts",
		]);
		const stageDir = join(root, "_stage");

		const { code } = runCheck({ root, extraArgs: ["--stage-to", stageDir] });

		expect(code).toBe(0);
		expect(staged({ stageDir, relPath: ".env.example" })).toBe(
			true,
		);
		expect(staged({ stageDir, relPath: ".env.staging" })).toBe(
			false,
		);
	});

	it("still strips the artifacts the app root writes", () => {
		// The inverse probe. These paths are never tracked in the real repository
		// (they are what a working tree accumulates), so tracking them here is
		// what puts them in front of the filters at all.
		const artifacts = [
			"platform/app/licenses.json",
			"platform/app/quickwit",
			"platform/app/.sentryclirc",
			"platform/app/prisma/db.sqlite3",
			"platform/app/e2e/auth.json",
			"platform/app/src/server/stray.log",
		];
		const root = buildFixture(artifacts);
		const stageDir = join(root, "_stage");

		const { code, output } = runCheck({
			root,
			extraArgs: ["--stage-to", stageDir],
		});

		for (const relPath of artifacts) {
			expect(staged({ stageDir, relPath })).toBe(false);
		}
		// Everything but the log is outside the guard's exemptions, so the guard
		// names each one it dropped. That is the failing half of the guard, which
		// nothing else here exercises.
		expect(code).toBe(1);
		expect(output).toContain("staging dropped application source");
		for (const named of artifacts.filter((p) => !p.endsWith(".log"))) {
			expect(output).toContain(named);
		}
	});

	describe("--stage-to", () => {
		it.each([["--stage-to", ""], ["--stage-to="]])(
			"refuses %s with no directory",
			(...extraArgs: string[]) => {
				const root = buildFixture(["platform/app/src/server/config.ts"]);

				const { code, output } = runCheck({ root, extraArgs });

				expect(code).toBe(1);
				expect(output).toContain("--stage-to needs a directory");
			},
		);

		it("refuses a directory that already holds something", () => {
			// rsync adds and overwrites but never deletes, so a stale file left in
			// the directory would read as staged and, on a full pack, ship.
			const root = buildFixture(["platform/app/src/server/config.ts"]);
			const stageDir = join(root, "_stage");
			write({ root: stageDir, relPath: "leftover.txt" });

			const { code, output } = runCheck({
				root,
				extraArgs: ["--stage-to", stageDir],
			});

			expect(code).toBe(1);
			expect(output).toContain("needs an empty directory");
		});
	});
});
