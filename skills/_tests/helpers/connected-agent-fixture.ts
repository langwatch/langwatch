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

/** The process of the fixture, with the output it has written so far. */
interface AgentProcess {
	child: ChildProcess;
	/** Everything the fixture wrote on stdout and stderr, for a failure message. */
	output: () => string;
	hasExited: () => boolean;
}

/**
 * Runs `support_agent.py` from `workingDirectory`.
 *
 * `uv run --with ...` installs the fixture's dependencies in an ephemeral
 * environment, with the `langwatch` package taken from `sdks/python` of this
 * checkout, so the test machine needs `uv` on PATH and nothing else.
 */
function spawnAgentProcess({
	workingDirectory,
	name,
	env,
}: {
	workingDirectory: string;
	name: string;
	env: Record<string, string | undefined>;
}): AgentProcess {
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
			// Its own process group, so teardown can kill the whole tree:
			// `uv run` execs a python child, and a SIGTERM to `uv` alone can
			// leave that child serving for hours after the test file ends.
			detached: true,
		},
	);

	let output = "";
	const collect = (data: Buffer) => {
		output += data.toString();
	};
	child.stdout?.on("data", collect);
	child.stderr?.on("data", collect);

	let exited = false;
	child.on("exit", () => {
		exited = true;
	});
	child.unref();
	// A spawn that never starts, `uv` missing from PATH above all, emits
	// "error" and no "exit". Without this the error is unhandled and the wait
	// below runs its full timeout before saying anything useful.
	child.on("error", (error: Error) => {
		output += `failed to start the fixture: ${error.message}\n`;
		exited = true;
	});

	return { child, output: () => output, hasExited: () => exited };
}

/**
 * Polls the platform until it lists the agent Online, and fails with the
 * fixture's own output when it never does: a fixture that died on a missing
 * key would otherwise read as a plain timeout.
 */
async function waitForAgentOnline({
	workingDirectory,
	name,
	agent,
	timeoutMs,
}: {
	workingDirectory: string;
	name: string;
	agent: AgentProcess;
	timeoutMs: number;
}): Promise<AgentRow> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (agent.hasExited()) {
			throw new Error(
				`the connected agent fixture exited before it registered:\n${agent.output()}`,
			);
		}
		let row: AgentRow | undefined;
		try {
			row = listAgents(workingDirectory).find(
				(candidate) => candidate.name === name && candidate.status === "online",
			);
		} catch {
			// The CLI answers an error while the row is not on the platform yet.
			row = undefined;
		}
		if (row) return row;
		await sleep(3_000);
	}
	// The caller never receives the handle on this path, so it can never call
	// stop() itself. SIGTERM on its own would leave a fixture that ignores it
	// online and registered while the tests after this one run, so the stop
	// escalates to SIGKILL here the same way a normal teardown does.
	await stopAgentProcess(agent);
	throw new Error(
		`the connected agent "${name}" did not come online within ${timeoutMs}ms:\n${agent.output()}`,
	);
}

/** Signals the fixture's whole process group, falling back to the child. */
function killAgentTree(agent: AgentProcess, signal: NodeJS.Signals): void {
	const pid = agent.child.pid;
	try {
		if (pid) process.kill(-pid, signal);
		else agent.child.kill(signal);
	} catch {
		agent.child.kill(signal);
	}
}

/** Asks the process tree to stop, and kills it when it does not. */
async function stopAgentProcess(agent: AgentProcess): Promise<void> {
	liveAgents.delete(agent);
	if (agent.hasExited()) return;
	killAgentTree(agent, "SIGTERM");
	await Promise.race([
		new Promise((resolve) => agent.child.once("exit", resolve)),
		sleep(10_000),
	]);
	if (!agent.hasExited()) killAgentTree(agent, "SIGKILL");
}

/**
 * Every fixture the file started and did not stop yet. A test that fails
 * before its own teardown, or a killed run, must not leave the agent
 * serving: the exit hook sweeps whatever is left.
 */
const liveAgents = new Set<AgentProcess>();
process.once("exit", () => {
	for (const agent of liveAgents) {
		if (!agent.hasExited()) killAgentTree(agent, "SIGKILL");
	}
});

/** Removes the row the run created, so a project never collects fixtures. */
function deleteAgentRow({
	workingDirectory,
	id,
}: {
	workingDirectory: string;
	id: string;
}): void {
	try {
		execFileSync("node", [cliDistPath, "agent", "delete", id, "--format", "json"], {
			cwd: workingDirectory,
			encoding: "utf8",
			stdio: ["ignore", "ignore", "ignore"],
		});
	} catch {
		// The row stays Offline and the daily sweep archives it later.
	}
}

/**
 * Starts the `python-connected-agent` fixture from `workingDirectory` and waits
 * until the platform lists it Online. The fixture reads `LANGWATCH_API_KEY`,
 * `OPENAI_API_KEY` and `AGENT_NAME` from the environment, so the caller passes
 * the keys and a name unique to this run: two test runs in the same project
 * must never share an agent row.
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
	const agent = spawnAgentProcess({ workingDirectory, name, env });
	liveAgents.add(agent);
	const row = await waitForAgentOnline({
		workingDirectory,
		name,
		agent,
		timeoutMs,
	});

	return {
		name,
		id: row.id,
		stop: async () => {
			await stopAgentProcess(agent);
			deleteAgentRow({ workingDirectory, id: row.id });
		},
	};
}
