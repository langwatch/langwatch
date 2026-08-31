import { type ChildProcess, execFileSync, spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const cliDistPath = path.resolve(
	__dirname,
	"../../../sdks/typescript/dist/cli/index.js",
);

/**
 * The fixture runs the Python SDK from this checkout, not the published
 * release, so the dogfood exercises the SDK the skill will ship with.
 */
const pythonSdkPath = path.resolve(__dirname, "../../../sdks/python");

interface AgentRow {
	id: string;
	name: string;
	status?: string;
	environment?: string;
}

function listAgents(workingDirectory: string): AgentRow[] {
	const output = execFileSync(
		"node",
		[cliDistPath, "agent", "list", "--format", "json"],
		{ cwd: workingDirectory, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
	);
	const parsed = JSON.parse(output) as { data?: AgentRow[] };
	return parsed.data ?? [];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface RunningConnectedAgent {
	/** The name the fixture registered under. */
	name: string;
	/** The agent id the platform assigned. */
	id: string;
	/** Stop the process and archive the agent on the platform. */
	stop: () => Promise<void>;
}

/**
 * Starts the `python-connected-agent` fixture from `workingDirectory` and waits
 * until the platform lists it Online. The fixture reads `LANGWATCH_API_KEY`,
 * `OPENAI_API_KEY` and `AGENT_NAME` from the environment, so the caller passes
 * the keys and a name unique to this run: two test runs in the same project
 * must never share an agent row.
 *
 * `uv run --with ...` installs the fixture's dependencies in an ephemeral
 * environment, with the `langwatch` package taken from `sdks/python` of this
 * checkout, so the test machine needs `uv` on PATH and nothing else.
 */
export async function startConnectedAgentFixture({
	workingDirectory,
	name,
	env,
	timeoutMs = 120_000,
}: {
	workingDirectory: string;
	name: string;
	env: Record<string, string | undefined>;
	timeoutMs?: number;
}): Promise<RunningConnectedAgent> {
	const child: ChildProcess = spawn(
		"uv",
		[
			"run",
			"--with",
			pythonSdkPath,
			"--with",
			"openai",
			"--with",
			"python-dotenv",
			"python",
			"support_agent.py",
		],
		{
			cwd: workingDirectory,
			env: { ...env, AGENT_NAME: name },
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	let output = "";
	child.stdout?.on("data", (data: Buffer) => {
		output += data.toString();
	});
	child.stderr?.on("data", (data: Buffer) => {
		output += data.toString();
	});
	let exited = false;
	child.on("exit", () => {
		exited = true;
	});

	const deadline = Date.now() + timeoutMs;
	let row: AgentRow | undefined;
	while (Date.now() < deadline) {
		if (exited) {
			throw new Error(`the connected agent fixture exited before it registered:\n${output}`);
		}
		try {
			row = listAgents(workingDirectory).find(
				(agent) => agent.name === name && agent.status === "online",
			);
		} catch {
			row = undefined;
		}
		if (row) break;
		await sleep(3_000);
	}
	if (!row) {
		child.kill("SIGTERM");
		throw new Error(
			`the connected agent "${name}" did not come online within ${timeoutMs}ms:\n${output}`,
		);
	}

	const id = row.id;
	return {
		name,
		id,
		stop: async () => {
			if (!exited) {
				child.kill("SIGTERM");
				await Promise.race([
					new Promise((resolve) => child.once("exit", resolve)),
					sleep(10_000),
				]);
				if (!exited) child.kill("SIGKILL");
			}
			try {
				execFileSync("node", [cliDistPath, "agent", "delete", id, "--format", "json"], {
					cwd: workingDirectory,
					encoding: "utf8",
					stdio: ["ignore", "ignore", "ignore"],
				});
			} catch {
				// The row stays Offline and the daily sweep archives it later.
			}
		},
	};
}
