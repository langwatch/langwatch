/**
 * Shared fixtures for the three suites that read Claude Code's plugin state:
 * the plugin seam itself, the persist offer that installs it, and the logout
 * target scan that removes it. All three seed the same two files under
 * `~/.claude/plugins`, and a shape that drifts between them would let one suite
 * pass against a file the others prove nothing about.
 *
 * Not named `*.test.ts` on purpose — vitest's `include` is `src/**\/*.test.ts`,
 * so this module is imported by the suites rather than collected as one (same
 * convention as `telemetry-refresh-test-helpers.ts` beside it).
 */
import * as fs from "node:fs";
import * as path from "node:path";

/** The repository the marketplace we publish from lives in. */
export const OWNED_MARKETPLACE_REPO = "langwatch/agent-plugin";

/** Write a JSON file under the temp home's `.claude` directory. */
export const writeClaudeJson = ({
	home,
	segments,
	value,
}: {
	home: string;
	segments: string[];
	value: unknown;
}): void => {
	const file = path.join(home, ".claude", ...segments);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, JSON.stringify(value, null, 2));
};

/**
 * `installed_plugins.json` with the LangWatch plugin recorded at user scope,
 * carrying the bookkeeping fields Claude Code writes beside the scope.
 */
export const seedInstalledPlugin = ({ home }: { home: string }): void =>
	writeClaudeJson({
		home,
		segments: ["plugins", "installed_plugins.json"],
		value: {
			version: 2,
			plugins: {
				"langwatch@langwatch": [
					{ scope: "user", installPath: "/somewhere", version: "0.1.0" },
				],
			},
		},
	});

/**
 * `known_marketplaces.json` with a marketplace named `langwatch` sourced from
 * `repo`. The default is the one we publish; pass another to stand in for
 * somebody else's registration under the same name.
 */
export const seedMarketplace = ({
	home,
	repo = OWNED_MARKETPLACE_REPO,
}: {
	home: string;
	repo?: string;
}): void =>
	writeClaudeJson({
		home,
		segments: ["plugins", "known_marketplaces.json"],
		value: {
			langwatch: {
				source: { source: "github", repo },
				installLocation: "/somewhere",
			},
		},
	});
