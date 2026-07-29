import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The invariants ADR-076 established, asserted against the repo itself.
 *
 * These are cheap to state and expensive to lose: every one of them held at
 * some point during the merge and then quietly broke — a second lockfile
 * reappearing, a member keeping its own overrides (which pnpm ignores, so it
 * reads as an active security pin while doing nothing), the app and the SDK
 * colliding on a package name again. None of that surfaces as a test failure
 * anywhere else; it surfaces as a drifted dependency months later.
 */

const repoRoot = join(__dirname, "..", "..", "..");

function readJson(relPath: string): Record<string, unknown> {
	return JSON.parse(readFileSync(join(repoRoot, relPath), "utf8"));
}

/**
 * The `packages:` list from pnpm-workspace.yaml. Read with a line scan rather
 * than a YAML parser: it is a flat list of quoted strings, and this package
 * ships as the published CLI, so a parser dependency added for one test would
 * travel into the npm artifact with it.
 */
function workspaceMembers(): string[] {
	const lines = readFileSync(
		join(repoRoot, "pnpm-workspace.yaml"),
		"utf8",
	).split("\n");
	const start = lines.findIndex((l) => l.trimEnd() === "packages:");
	if (start === -1) return [];

	const members: string[] = [];
	for (const line of lines.slice(start + 1)) {
		const entry = /^\s+-\s+"?([^"#]+?)"?\s*$/.exec(line);
		if (entry?.[1]) {
			members.push(entry[1]);
			continue;
		}
		if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
		break; // the next top-level key ends the list
	}
	return members;
}

/** Every package.json the repo tracks, excluding installed dependencies. */
function trackedManifests(): string[] {
	return execFileSync("git", ["ls-files", "*package.json"], {
		cwd: repoRoot,
		encoding: "utf8",
	})
		.split("\n")
		.filter(Boolean)
		.filter((p) => !p.includes("node_modules"));
}

describe("the repo is a single pnpm workspace", () => {
	describe("when the lockfiles are counted", () => {
		/** @scenario The repo holds one lockfile */
		it("finds exactly one, at the repo root", () => {
			const lockfiles = execFileSync("git", ["ls-files", "*pnpm-lock.yaml"], {
				cwd: repoRoot,
				encoding: "utf8",
			})
				.split("\n")
				.filter(Boolean);

			expect(lockfiles).toEqual(["pnpm-lock.yaml"]);
		});
	});

	describe("when the workspace definition is read", () => {
		/** @scenario Projects that used to opt out of the workspace no longer do */
		it("lists every JavaScript project the repo used to install separately", () => {
			const members = workspaceMembers();

			for (const project of [
				"langwatch",
				"typescript-sdk",
				"mcp-server",
				"skills",
				"agentic-e2e-tests",
			]) {
				expect(members).toContain(project);
			}
		});

		/** @scenario A fresh clone needs one install */
		it("keeps the workspace definition at the repo root and nowhere else", () => {
			const definitions = execFileSync(
				"git",
				["ls-files", "*pnpm-workspace.yaml"],
				{ cwd: repoRoot, encoding: "utf8" },
			)
				.split("\n")
				.filter(Boolean);

			expect(definitions).toEqual(["pnpm-workspace.yaml"]);
		});
	});

	describe("when the package names are compared", () => {
		/** @scenario The application and the SDK no longer share a package name */
		it("gives the app and the SDK different names", () => {
			const app = readJson("langwatch/package.json").name;
			const sdk = readJson("typescript-sdk/package.json").name;

			expect(app).toBe("@langwatch/web");
			expect(sdk).toBe("langwatch");
			expect(app).not.toBe(sdk);
		});

		/** @scenario The application still gets the published SDK */
		it("keeps the app on the published SDK rather than the working copy", () => {
			const app = readJson("langwatch/package.json") as {
				dependencies?: Record<string, string>;
			};

			// A `workspace:` specifier here would switch the app — and the
			// production image built from it — onto the SDK working copy. That is
			// a deliberate change, not one to acquire by accident.
			expect(app.dependencies?.langwatch).toBeDefined();
			expect(app.dependencies?.langwatch).not.toMatch(/^workspace:/);
		});
	});

	describe("when a member declares dependency overrides", () => {
		/** @scenario Security overrides are declared once */
		it("finds none, because pnpm would ignore them", () => {
			const offenders = trackedManifests()
				.filter((p) => p !== "package.json")
				.filter((p) => {
					const pkg = readJson(p) as { pnpm?: { overrides?: unknown } };
					return pkg.pnpm?.overrides !== undefined;
				});

			// pnpm honours `pnpm.overrides` only in the workspace root manifest.
			// One left in a member looks like an active pin and does nothing —
			// which is exactly how the six old roots drifted apart.
			expect(offenders).toEqual([]);
		});
	});

	describe("when an internal package is depended on", () => {
		/** @scenario A shared internal package is reachable from every project */
		it("resolves to the working copy rather than a published version", () => {
			const mcp = readJson("mcp-server/package.json") as {
				dependencies?: Record<string, string>;
				devDependencies?: Record<string, string>;
			};
			const declared = {
				...mcp.dependencies,
				...mcp.devDependencies,
			};

			expect(declared["@langwatch/handled-error"]).toMatch(/^workspace:/);
		});
	});

	describe("when the published package manifest is read", () => {
		/** @scenario The published package carries a lockfile */
		it("ships the workspace definition and the lockfile", () => {
			const root = readJson("package.json") as { files?: string[] };

			expect(root.files).toContain("pnpm-workspace.yaml");
			expect(root.files).toContain("pnpm-lock.yaml");
		});

		/** @scenario Every project the lockfile mentions is resolvable */
		it("ships a manifest for every workspace member", () => {
			const root = readJson("package.json") as { files?: string[] };
			const shipped = root.files ?? [];

			// Workspace members only — `typescript-sdk/examples/*` carry a
			// package.json but are not members, so the lockfile never mentions
			// them and the tarball has no reason to.
			const memberManifests = trackedManifests().filter((manifest) => {
				const dir = manifest.replace(/\/?package\.json$/, "");
				if (dir === "") return false;
				return workspaceMembers().some((glob) =>
					glob.endsWith("/*")
						? dir.startsWith(`${glob.slice(0, -2)}/`) &&
							!dir.slice(glob.length - 1).includes("/")
						: dir === glob,
				);
			});

			expect(memberManifests.length).toBeGreaterThan(5);

			// A member whose directory is absent installs without complaint and
			// fails much later, inside a migration.
			for (const manifest of memberManifests) {
				const covered = shipped.some(
					(f) => manifest === f || manifest.startsWith(f.replace(/\/$/, "/")),
				);
				expect(covered, `no files[] entry ships ${manifest}`).toBe(true);
			}
		});
	});

	describe("when the packing script is inspected", () => {
		/** @scenario The published layout is not a mirror of the repository layout */
		it("assembles a staging tree instead of packing the repo in place", () => {
			const script = readFileSync(
				join(repoRoot, "scripts", "pack-npm.sh"),
				"utf8",
			);

			expect(existsSync(join(repoRoot, "scripts", "pack-npm.sh"))).toBe(true);
			// npm strips a lockfile at the package ROOT, so the artifact has to be
			// staged one directory down for it to ship at all.
			expect(script).toContain("STAGE=");
			expect(script).toMatch(/APP="\$STAGE\/app"/);
		});
	});
});
