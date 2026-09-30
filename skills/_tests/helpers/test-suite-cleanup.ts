import { execFileSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const cliDistPath = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../../sdks/typescript/dist/cli/index.js",
);

/**
 * Archives the test suite a run asked the agent to create, and every scenario
 * filed in it, so the next run of the same test finds nothing to reuse. Runs
 * from `workingDirectory`, whose .env carries the project key.
 */
export function archiveTestSuite({
	workingDirectory,
	name,
}: {
	workingDirectory: string;
	name: string;
}): void {
	try {
		execFileSync(
			"node",
			[cliDistPath, "test-suite", "archive", name, "--format", "json"],
			{ cwd: workingDirectory, encoding: "utf8", stdio: ["ignore", "ignore", "ignore"] },
		);
	} catch {
		// The suite was never created, or the archive failed; it stays in the
		// project and the next run gets a fresh name anyway.
	}
}
