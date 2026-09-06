import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { restoreShellScriptBits } from "../../src/services/app-dir.ts";

describe("shell script bits after relocation", () => {
	const roots: string[] = [];
	afterEach(() => {
		for (const root of roots.splice(0))
			rmSync(root, { recursive: true, force: true });
	});

	async function makeTree(): Promise<string> {
		const root = await mkdtemp(join(tmpdir(), "langwatch-appdir-"));
		roots.push(root);
		mkdirSync(join(root, "platform", "app", "scripts"), { recursive: true });
		mkdirSync(join(root, "node_modules", "dep"), { recursive: true });
		// pnpm pack normalizes modes: scripts arrive 0644.
		writeFileSync(
			join(root, "platform", "app", "scripts", "build-mcp-server.sh"),
			"#!/bin/sh\n",
			{
				mode: 0o644,
			},
		);
		writeFileSync(
			join(root, "platform", "app", "scripts", "helper.ts"),
			"export {};\n",
			{
				mode: 0o644,
			},
		);
		writeFileSync(join(root, "node_modules", "dep", "hook.sh"), "#!/bin/sh\n", {
			mode: 0o644,
		});
		return root;
	}

	describe("when the extracted artifact carries scripts without their bit", () => {
		it("makes every *.sh executable so the app's build chain can invoke them", async () => {
			// `pnpm run build` calls ./scripts/build-mcp-server.sh directly; a
			// 0644 script dies with exit 126 and the boot never reaches healthy.
			const root = await makeTree();
			const restored = restoreShellScriptBits(root);
			expect(restored).toBe(1);
			const mode = statSync(
				join(root, "platform", "app", "scripts", "build-mcp-server.sh"),
			).mode;
			expect(mode & 0o111).not.toBe(0);
		});

		it("leaves non-scripts and node_modules alone", async () => {
			const root = await makeTree();
			restoreShellScriptBits(root);
			expect(
				statSync(join(root, "platform", "app", "scripts", "helper.ts")).mode &
					0o111,
			).toBe(0);
			expect(
				statSync(join(root, "node_modules", "dep", "hook.sh")).mode & 0o111,
			).toBe(0);
		});
	});
});
