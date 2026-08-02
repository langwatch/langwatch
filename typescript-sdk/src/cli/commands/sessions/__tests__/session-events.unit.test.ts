import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AGENT_MODE_ENV_VARS } from "../../../utils/output";

// Agent-mode detection reads the ambient environment (Claude Code sets
// CLAUDECODE unconditionally); neutralize it so the suite asserts the human
// default regardless of what launched vitest.
let savedAgentEnv: Record<string, string | undefined> = {};
beforeEach(() => {
	savedAgentEnv = Object.fromEntries(
		AGENT_MODE_ENV_VARS.map((name) => [name, process.env[name]]),
	);
	for (const name of AGENT_MODE_ENV_VARS) delete process.env[name];
});
afterEach(() => {
	for (const name of AGENT_MODE_ENV_VARS) {
		const value = savedAgentEnv[name];
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
});

vi.mock("../../../utils/apiKey", () => ({
	resolveCredentials: vi.fn(async () => ({
		apiKey: "test-key",
		source: "env",
		endpoint: "https://app.langwatch.ai",
	})),
}));

vi.mock("ora", () => ({
	default: () => ({
		start: vi.fn().mockReturnThis(),
		succeed: vi.fn(),
		fail: vi.fn(),
	}),
}));

vi.mock("@/cli/utils/governance/resolveEndpoint", () => ({
	resolveControlPlaneUrl: () => "https://langwatch.test",
}));

import { sessionEventsCommand } from "../events";

class ProcessExitError extends Error {
	constructor(public code: number) {
		super(`process.exit(${code})`);
	}
}

const noop = () => {
	// intentionally empty — suppresses output during tests
};

describe("sessionEventsCommand()", () => {
	let fetchMock: ReturnType<typeof vi.fn>;
	let logSpy: ReturnType<typeof vi.spyOn>;

	const modelCall = (timeUnixMs: number, recordId: string) => ({
		timeUnixMs,
		recordId,
		eventKind: "model_call",
		model: "claude-haiku-4-5-20251001",
		inputTokens: 4,
		outputTokens: 120,
		cacheReadTokens: 13000,
		cacheCreationTokens: 250,
		costUsd: 0.0421,
	});

	const page = (events: unknown[], nextCursor: string | null) =>
		new Response(JSON.stringify({ events, nextCursor }), { status: 200 });

	beforeEach(() => {
		vi.clearAllMocks();
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		logSpy = vi.spyOn(console, "log").mockImplementation(noop);
		vi.spyOn(console, "error").mockImplementation(noop);
		vi.spyOn(process, "exit").mockImplementation((code) => {
			throw new ProcessExitError(code as number);
		});
	});

	/** @scenario the CLI lists a session's events */
	it("walks the cursor until the limit and prints one line per event", async () => {
		fetchMock
			.mockResolvedValueOnce(
				page([modelCall(1720000000000, "r1"), modelCall(1720000001000, "r2")], "cursor-1"),
			)
			.mockResolvedValueOnce(
				page(
					[
						{
							timeUnixMs: 1720000002000,
							recordId: "r3",
							eventKind: "compaction",
							preTokens: 4301,
							postTokens: 1419,
							compactionTrigger: "manual",
						},
					],
					null,
				),
			);

		await sessionEventsCommand("session-abc", {});

		expect(fetchMock).toHaveBeenCalledTimes(2);
		const firstUrl = String(fetchMock.mock.calls[0]![0]);
		expect(firstUrl).toContain("/api/coding-agent/sessions/session-abc/events");
		const secondUrl = String(fetchMock.mock.calls[1]![0]);
		expect(secondUrl).toContain("cursor=cursor-1");

		const printed = logSpy.mock.calls
			.map((c: unknown[]) => c.join(" "))
			.join("\n");
		expect(printed).toContain("model call");
		expect(printed).toContain("context=13,254");
		expect(printed).toContain("4,301 tokens to 1,419 tokens");
	});

	it("passes kinds through and stops at the requested limit", async () => {
		fetchMock.mockResolvedValueOnce(
			page([modelCall(1720000000000, "r1")], "cursor-1"),
		);

		await sessionEventsCommand("session-abc", {
			kinds: "model_call,compaction",
			limit: "1",
		});

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(String(fetchMock.mock.calls[0]![0])).toContain(
			"kinds=model_call%2Ccompaction",
		);
	});

	it("exits with an error for a non-numeric --limit", async () => {
		await expect(
			sessionEventsCommand("session-abc", { limit: "abc" }),
		).rejects.toThrow(ProcessExitError);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
