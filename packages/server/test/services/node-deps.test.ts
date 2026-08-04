import {
	existsSync,
	mkdirSync,
	readlinkSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	assertWorkspaceLinksResolve,
	linkExternalMemberPeers,
	shouldPruneToProd,
} from "../../src/services/node-deps.ts";

describe("pruning to production dependencies", () => {
	const paths = { app: "/home/u/.langwatch/app" };

	describe("when the app tree is the relocated copy", () => {
		it("prunes", () => {
			expect(shouldPruneToProd("/home/u/.langwatch/app/langwatch", paths)).toBe(
				true,
			);
		});
	});

	describe("when the app tree is a developer checkout", () => {
		it("leaves it alone", () => {
			// Pruning a working tree would strip the developer's own test and
			// build tooling out from under them.
			expect(
				shouldPruneToProd("/home/u/Projects/langwatch/langwatch", paths),
			).toBe(false);
		});

		it("is not fooled by a sibling directory sharing the prefix", () => {
			expect(
				shouldPruneToProd("/home/u/.langwatch/apple/langwatch", paths),
			).toBe(false);
		});
	});
});

describe("workspace link integrity", () => {
	async function makeTree(): Promise<{
		nodeModules: string;
		scope: string;
		root: string;
	}> {
		const root = await mkdtemp(join(tmpdir(), "langwatch-links-"));
		const nodeModules = join(root, "node_modules");
		const scope = join(nodeModules, "@langwatch");
		mkdirSync(scope, { recursive: true });
		return { nodeModules, scope, root };
	}

	function addPackage(root: string, scope: string, name: string): void {
		const target = join(root, "packages", name);
		mkdirSync(target, { recursive: true });
		writeFileSync(
			join(target, "package.json"),
			`{"name":"@langwatch/${name}"}`,
		);
		symlinkSync(target, join(scope, name));
	}

	describe("when every @langwatch link resolves", () => {
		it("passes silently", async () => {
			const { nodeModules, scope, root } = await makeTree();
			addPackage(root, scope, "observability");
			addPackage(root, scope, "langy");
			expect(() => assertWorkspaceLinksResolve(nodeModules)).not.toThrow();
		});
	});

	describe("when a link points at a package that does not exist", () => {
		it("fails naming the missing packages and calling it a packaging bug", async () => {
			// pnpm exits 0 in exactly this state (workspace member in the lockfile,
			// directory absent from the shipped artifact) and the app then dies
			// minutes later inside a migration with a bare MODULE_NOT_FOUND.
			const { nodeModules, scope, root } = await makeTree();
			addPackage(root, scope, "langy");
			symlinkSync(
				join(root, "packages", "observability"),
				join(scope, "observability"),
			);
			expect(() => assertWorkspaceLinksResolve(nodeModules)).toThrow(
				/@langwatch\/observability.*packaging bug/s,
			);
		});
	});

	describe("when the tree has no @langwatch scope at all", () => {
		it("passes (nothing to verify)", async () => {
			const root = await mkdtemp(join(tmpdir(), "langwatch-links-"));
			const nodeModules = join(root, "node_modules");
			mkdirSync(nodeModules, { recursive: true });
			expect(() => assertWorkspaceLinksResolve(nodeModules)).not.toThrow();
		});
	});
});

describe("external member peer links", () => {
	async function makeAppTree(): Promise<string> {
		const appRoot = await mkdtemp(join(tmpdir(), "langwatch-peers-"));
		// The app sits at platform/app in the shipped tree, not at the repo
		// root: a fixture carrying the pre-restructure layout is what let the
		// packed artifact look for node_modules where nothing ships.
		mkdirSync(join(appRoot, "platform", "app", "node_modules", "zod"), {
			recursive: true,
		});
		writeFileSync(
			join(appRoot, "platform", "app", "node_modules", "zod", "package.json"),
			"{}",
		);
		mkdirSync(join(appRoot, "packages", "langy"), { recursive: true });
		writeFileSync(
			join(appRoot, "packages", "langy", "package.json"),
			JSON.stringify({
				name: "@langwatch/langy",
				peerDependencies: { zod: ">=3.25.0 <5", "left-pad": "*" },
			}),
		);
		return appRoot;
	}

	describe("when a member declares a peer the app carries", () => {
		it("links the member to the app's instance so both share one copy", async () => {
			// Two zod instances cannot merge each other's schemas; two otel
			// apis lose the global registrations. The link IS the peer contract.
			const appRoot = await makeAppTree();
			const linked = linkExternalMemberPeers(appRoot);
			expect(linked).toContain("langy:zod");
			const linkPath = join(
				appRoot,
				"packages",
				"langy",
				"node_modules",
				"zod",
				"package.json",
			);
			expect(existsSync(linkPath)).toBe(true);
		});

		it("is idempotent", async () => {
			const appRoot = await makeAppTree();
			linkExternalMemberPeers(appRoot);
			expect(linkExternalMemberPeers(appRoot)).toEqual([]);
		});

		it("links relatively so the tree survives relocation", async () => {
			// An absolute target would break the moment ~/.langwatch/app moves
			// (a fresh install, a version bump); relative is what makes the
			// symlink keep resolving after the whole tree is relocated.
			const appRoot = await makeAppTree();
			linkExternalMemberPeers(appRoot);
			const target = readlinkSync(
				join(appRoot, "packages", "langy", "node_modules", "zod"),
			);
			expect(isAbsolute(target)).toBe(false);
		});
	});

	describe("when a previous link at the peer path dangles", () => {
		it("replaces it instead of dying with EEXIST", async () => {
			// existsSync follows symlinks and reports false for a dangling one,
			// but the directory entry still blocks symlinkSync. An app-tree wipe
			// leaves exactly this state behind.
			const root = await makeAppTree();
			const memberNm = join(root, "packages", "langy", "node_modules");
			mkdirSync(memberNm, { recursive: true });
			symlinkSync(join(root, "not-there"), join(memberNm, "zod"));
			const linked = linkExternalMemberPeers(root);
			expect(linked).toContain("langy:zod");
			expect(existsSync(join(memberNm, "zod", "package.json"))).toBe(true);
		});
	});

	describe("when a member declares a peer the app does not carry", () => {
		it("skips it", async () => {
			const appRoot = await makeAppTree();
			const linked = linkExternalMemberPeers(appRoot);
			expect(linked.some((l) => l.includes("left-pad"))).toBe(false);
		});
	});
});
