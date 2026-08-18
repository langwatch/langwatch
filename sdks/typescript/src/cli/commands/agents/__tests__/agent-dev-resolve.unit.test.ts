import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentsApiService } from "@/client-sdk/services/agents/agents-api.service";
import { resolveTargetAgent } from "../dev/resolve";

/**
 * Agent selection for `langwatch agent dev` when `--agent` is omitted.
 *
 * The selection order (flag, remembered agent, lone agent, picker) mostly
 * needs no test double beyond a fake service, but the edges do: with no HTTP
 * agents a terminal session offers to create one on the spot, and a session
 * without a terminal must fail with the exact command that skips the
 * interactivity.
 *
 * @see specs/agents/agent-dev-tunnel.feature
 */

const { mockPrompts } = vi.hoisted(() => ({ mockPrompts: vi.fn() }));
vi.mock("prompts", () => ({ default: mockPrompts }));

// Keep the per-directory memory inert: these tests drive the picker, not the
// remembered-agent shortcut.
vi.mock("../../../utils/governance/config", () => ({
	loadConfig: vi.fn(() => ({})),
	saveConfig: vi.fn(),
}));

class ProcessExitError extends Error {
	constructor(public code: number) {
		super(`process.exit(${code})`);
	}
}

const noop = () => {
	// intentionally empty, suppresses output during tests
};

const makeAgent = (overrides: Record<string, unknown> = {}) => ({
	id: "agent_abc123",
	name: "Bid Companion",
	type: "http",
	config: { url: "https://staging.example.com/agent" },
	createdAt: "2026-01-01T00:00:00Z",
	updatedAt: "2026-01-01T00:00:00Z",
	platformUrl: "https://app.langwatch.test/proj/agents",
	...overrides,
});

function makeService({
	agents,
}: {
	agents: ReturnType<typeof makeAgent>[];
}): { service: AgentsApiService; create: ReturnType<typeof vi.fn> } {
	const create = vi
		.fn()
		.mockImplementation((params: { name: string; config: unknown }) =>
			Promise.resolve(
				makeAgent({ id: "agent_new", name: params.name, config: params.config }),
			),
		);
	const service = {
		list: vi.fn().mockResolvedValue({ data: agents }),
		create,
	} as unknown as AgentsApiService;
	return { service, create };
}

function setTTY(isTTY: boolean) {
	Object.defineProperty(process.stdin, "isTTY", {
		value: isTTY,
		configurable: true,
	});
	Object.defineProperty(process.stdout, "isTTY", {
		value: isTTY,
		configurable: true,
	});
}

describe("agent dev target resolution", () => {
	let consoleError: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		mockPrompts.mockReset();
		vi.spyOn(console, "log").mockImplementation(noop);
		consoleError = vi.spyOn(console, "error").mockImplementation(noop);
		vi.spyOn(process, "exit").mockImplementation((code) => {
			throw new ProcessExitError(code as number);
		});
	});

	afterEach(() => {
		setTTY(false);
		vi.restoreAllMocks();
	});

	describe("given the project has no HTTP agents", () => {
		describe("when the session runs in a terminal", () => {
			/** @scenario "With no HTTP agents, an interactive session creates one on the spot" */
			it("creates the agent it offered and returns it as the target", async () => {
				setTTY(true);
				mockPrompts.mockResolvedValue({ name: "My Local Agent" });
				const { service, create } = makeService({ agents: [] });

				const agent = await resolveTargetAgent({
					service,
					localUrl: "http://localhost:8010/agent/chat",
				});

				expect(create).toHaveBeenCalledWith({
					name: "My Local Agent",
					type: "http",
					config: { url: "http://localhost:8010/agent/chat", method: "POST" },
				});
				expect(agent.id).toBe("agent_new");
				expect(agent.name).toBe("My Local Agent");
			});

			/** @scenario "Declining the offered agent name ends the session with instructions" */
			it("fails with the create command when the name prompt is cancelled", async () => {
				setTTY(true);
				// prompts resolves with an empty object when the user hits Esc.
				mockPrompts.mockResolvedValue({});
				const { service, create } = makeService({ agents: [] });

				await expect(
					resolveTargetAgent({
						service,
						localUrl: "http://localhost:8010/agent/chat",
					}),
				).rejects.toThrow(ProcessExitError);

				expect(create).not.toHaveBeenCalled();
				expect(String(consoleError.mock.calls.flat())).toContain(
					"langwatch agent create",
				);
			});
		});

		describe("when the session runs without a terminal", () => {
			/** @scenario "With no HTTP agents and no terminal, the session names the create command" */
			it("fails with the create command instead of prompting", async () => {
				setTTY(false);
				const { service, create } = makeService({ agents: [] });

				await expect(
					resolveTargetAgent({
						service,
						localUrl: "http://localhost:8010/agent/chat",
					}),
				).rejects.toThrow(ProcessExitError);

				expect(mockPrompts).not.toHaveBeenCalled();
				expect(create).not.toHaveBeenCalled();
				expect(String(consoleError.mock.calls.flat())).toContain(
					"langwatch agent create",
				);
			});
		});
	});

	describe("given the project has several HTTP agents", () => {
		describe("when the session runs without a terminal and no --agent flag", () => {
			/** @scenario "With several HTTP agents and no terminal, the session names the agent flag" */
			it("fails and says to pass --agent", async () => {
				setTTY(false);
				const { service } = makeService({
					agents: [
						makeAgent({ id: "agent_a", name: "A" }),
						makeAgent({ id: "agent_b", name: "B" }),
					],
				});

				await expect(
					resolveTargetAgent({
						service,
						localUrl: "http://localhost:8010/agent/chat",
					}),
				).rejects.toThrow(ProcessExitError);

				expect(mockPrompts).not.toHaveBeenCalled();
				expect(String(consoleError.mock.calls.flat())).toContain(
					"--agent <id|name>",
				);
			});
		});
	});

	describe("given the project has exactly one HTTP agent", () => {
		it("picks it without prompting, even without a terminal", async () => {
			setTTY(false);
			const only = makeAgent({ id: "agent_only", name: "Only" });
			const { service } = makeService({ agents: [only] });

			const agent = await resolveTargetAgent({
				service,
				localUrl: "http://localhost:8010/agent/chat",
			});

			expect(agent.id).toBe("agent_only");
			expect(mockPrompts).not.toHaveBeenCalled();
		});
	});
});
