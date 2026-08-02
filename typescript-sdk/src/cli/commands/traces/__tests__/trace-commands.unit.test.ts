import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TracesApiError } from "@/client-sdk/services/traces/traces-api.service";
import { AGENT_MODE_ENV_VARS } from "../../../utils/output";

// Agent-mode detection reads the ambient environment (Claude Code sets
// CLAUDECODE unconditionally), and getTraceCommand picks the API response
// shape from the resolved output format. Neutralize the ambient env so the
// suite asserts the human default regardless of what launched vitest.
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

vi.mock(
	"@/client-sdk/services/traces/traces-api.service",
	async (importOriginal) => {
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
		const actual = (await importOriginal()) as Record<string, unknown>;
		return {
			...actual,
			TracesApiService: vi.fn(),
		};
	},
);

vi.mock("../../../utils/apiKey", () => ({
	resolveCredentials: vi.fn(async () => ({ apiKey: "test-key", source: "env", endpoint: "https://app.langwatch.ai" })),
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

import { TracesApiService } from "@/client-sdk/services/traces/traces-api.service";
import { exportTracesCommand } from "../export";
import { getTraceCommand } from "../get";
import { searchTracesCommand } from "../search";
import { transcriptTraceCommand } from "../transcript";

class ProcessExitError extends Error {
	constructor(public code: number) {
		super(`process.exit(${code})`);
	}
}

const noop = () => {
	// intentionally empty — suppresses output during tests
};

const mockProcessExit = () => {
	vi.spyOn(process, "exit").mockImplementation((code) => {
		throw new ProcessExitError(code as number);
	});
};

describe("searchTracesCommand()", () => {
	let mockSearch: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockSearch = vi.fn();
		// biome-ignore lint/complexity/useArrowFunction: the command news up TracesApiService, and an arrow function is not constructible.
		vi.mocked(TracesApiService).mockImplementation(function () {
			return {
				search: mockSearch,
				get: vi.fn(),
			} as unknown as TracesApiService;
		});
		vi.spyOn(console, "log").mockImplementation(noop);
		vi.spyOn(console, "error").mockImplementation(noop);
		mockProcessExit();
	});

	describe("when traces are found", () => {
		it("calls search and prints results", async () => {
			mockSearch.mockResolvedValue({
				traces: [{ traceId: "trace_1", input: "hello", output: "world" }],
				pagination: { totalHits: 1 },
			});

			await searchTracesCommand({});

			expect(mockSearch).toHaveBeenCalledOnce();
		});
	});

	describe("when no traces are found", () => {
		it("prints empty-state message", async () => {
			mockSearch.mockResolvedValue({
				traces: [],
				pagination: { totalHits: 0 },
			});

			await searchTracesCommand({});

			// eslint-disable-next-line @typescript-eslint/unbound-method
			expect(process.exit).not.toHaveBeenCalled();
		});
	});

	describe("when format is json", () => {
		it("outputs raw JSON", async () => {
			const result = {
				traces: [{ traceId: "t1" }],
				pagination: { totalHits: 1 },
			};
			mockSearch.mockResolvedValue(result);

			await searchTracesCommand({ format: "json" });

			expect(console.log).toHaveBeenCalledWith(JSON.stringify(result, null, 2));
		});
	});

	describe("when the API call fails", () => {
		it("exits with code 1", async () => {
			mockSearch.mockRejectedValue(
				new TracesApiError("Network error", "search traces"),
			);

			await expect(searchTracesCommand({})).rejects.toThrow(ProcessExitError);
		});
	});

	describe("when --origin is provided", () => {
		/** @scenario Search traces filtered by origin */
		it("passes the origin as a traces.origin filter to the search API", async () => {
			mockSearch.mockResolvedValue({
				traces: [],
				pagination: { totalHits: 0 },
			});

			await searchTracesCommand({ origin: "application" });

			expect(mockSearch).toHaveBeenCalledWith(
				expect.objectContaining({
					filters: { "traces.origin": ["application"] },
				}),
			);
		});

		/** @scenario Search traces filtered by multiple origins */
		it("splits comma-separated origins into one filter value each", async () => {
			mockSearch.mockResolvedValue({
				traces: [],
				pagination: { totalHits: 0 },
			});

			await searchTracesCommand({ origin: "application, evaluation" });

			expect(mockSearch).toHaveBeenCalledWith(
				expect.objectContaining({
					filters: { "traces.origin": ["application", "evaluation"] },
				}),
			);
		});
	});

	describe("when --origin is not provided", () => {
		it("sends no filters field so the search body stays unchanged", async () => {
			mockSearch.mockResolvedValue({
				traces: [],
				pagination: { totalHits: 0 },
			});

			await searchTracesCommand({});

			expect(mockSearch.mock.calls[0]![0]).not.toHaveProperty("filters");
		});
	});
});

describe("exportTracesCommand()", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		fetchMock = vi
			.fn()
			.mockResolvedValue(
				new Response(
					JSON.stringify({ traces: [], pagination: { totalHits: 0 } }),
					{ status: 200 },
				),
			);
		vi.stubGlobal("fetch", fetchMock);
		vi.spyOn(console, "log").mockImplementation(noop);
		vi.spyOn(console, "error").mockImplementation(noop);
		vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		mockProcessExit();
	});

	describe("when --origin is provided", () => {
		/** @scenario Export traces filtered by origin */
		it("passes the origin as a traces.origin filter to the search API", async () => {
			await exportTracesCommand({ origin: "application,evaluation" });

			const body = JSON.parse(
				(fetchMock.mock.calls[0]![1] as { body: string }).body,
			) as Record<string, unknown>;
			expect(body.filters).toEqual({
				"traces.origin": ["application", "evaluation"],
			});
		});
	});

	describe("when --origin is not provided", () => {
		it("sends no filters field so the export body stays unchanged", async () => {
			await exportTracesCommand({});

			const body = JSON.parse(
				(fetchMock.mock.calls[0]![1] as { body: string }).body,
			) as Record<string, unknown>;
			expect(body).not.toHaveProperty("filters");
		});
	});

	const pageResponse = (args: {
		count: number;
		from: number;
		scrollId?: string;
		totalHits: number;
		skipped?: number;
		trace?: (i: number) => Record<string, unknown>;
	}) =>
		new Response(
			JSON.stringify({
				traces: Array.from({ length: args.count }, (_, i) =>
					args.trace
						? args.trace(args.from + i)
						: { trace_id: `trace_${args.from + i}` },
				),
				pagination: {
					totalHits: args.totalHits,
					...(args.scrollId ? { scrollId: args.scrollId } : {}),
					...(args.skipped ? { skipped: args.skipped } : {}),
				},
			}),
			{ status: 200 },
		);

	const writtenOutput = () =>
		(process.stdout.write as unknown as ReturnType<typeof vi.fn>).mock.calls
			.map((c) => String(c[0]))
			.join("");

	const requestBodies = () =>
		fetchMock.mock.calls.map(
			(c) => JSON.parse((c[1] as { body: string }).body) as Record<string, unknown>,
		);

	describe("when the limit spans multiple pages", () => {
		/** @scenario export pages with the server cursor until the requested limit is reached */
		it("passes each response's scrollId into the next request until the limit is reached", async () => {
			fetchMock
				.mockResolvedValueOnce(
					pageResponse({ count: 1000, from: 0, scrollId: "s1", totalHits: 2500 }),
				)
				.mockResolvedValueOnce(
					pageResponse({ count: 1000, from: 1000, scrollId: "s2", totalHits: 2500 }),
				)
				.mockResolvedValueOnce(
					pageResponse({ count: 500, from: 2000, scrollId: "s3", totalHits: 2500 }),
				);

			await exportTracesCommand({ limit: "2500" });

			expect(fetchMock).toHaveBeenCalledTimes(3);
			const bodies = requestBodies();
			expect(bodies[0]).not.toHaveProperty("scrollId");
			expect(bodies[0]!.pageSize).toBe(1000);
			expect(bodies[1]!.scrollId).toBe("s1");
			expect(bodies[2]!.scrollId).toBe("s2");
			expect(bodies[2]!.pageSize).toBe(500);
			expect(writtenOutput().trim().split("\n")).toHaveLength(2500);
		});

		/** @scenario export stops paging when the server returns no further cursor */
		it("stops after the page that returns no scrollId", async () => {
			fetchMock.mockResolvedValueOnce(
				pageResponse({ count: 40, from: 0, totalHits: 40 }),
			);

			await exportTracesCommand({ limit: "1000" });

			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect(writtenOutput().trim().split("\n")).toHaveLength(40);
		});

		/** @scenario export keeps paging through a short page whose shortfall is skipped rows */
		it("continues past a short page whose shortfall is reported as skipped", async () => {
			fetchMock
				.mockResolvedValueOnce(
					pageResponse({
						count: 990,
						from: 0,
						scrollId: "s1",
						totalHits: 1100,
						skipped: 10,
					}),
				)
				.mockResolvedValueOnce(
					pageResponse({ count: 100, from: 990, scrollId: "s2", totalHits: 1100 }),
				);

			await exportTracesCommand({ limit: "1090" });

			expect(fetchMock).toHaveBeenCalledTimes(2);
			expect(writtenOutput().trim().split("\n")).toHaveLength(1090);
		});

		/** @scenario export requests one page when the limit fits in a single page */
		it("makes exactly one request with pageSize matching the limit", async () => {
			fetchMock.mockResolvedValueOnce(
				pageResponse({ count: 50, from: 0, scrollId: "s1", totalHits: 500 }),
			);

			await exportTracesCommand({ limit: "50" });

			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect(requestBodies()[0]!.pageSize).toBe(50);
		});
	});

	describe("when --include-spans is provided", () => {
		/** @scenario export with --include-spans requests span data and preserves it in the output */
		it("sends includeSpans and preserves each trace's spans in the JSONL output", async () => {
			fetchMock.mockResolvedValueOnce(
				pageResponse({
					count: 2,
					from: 0,
					totalHits: 2,
					trace: (i) => ({
						trace_id: `trace_${i}`,
						spans: [{ span_id: `span_${i}` }],
					}),
				}),
			);

			await exportTracesCommand({ includeSpans: true });

			expect(requestBodies()[0]!.includeSpans).toBe(true);
			const lines = writtenOutput().trim().split("\n");
			const first = JSON.parse(lines[0]!) as { spans?: unknown[] };
			expect(first.spans).toEqual([{ span_id: "span_0" }]);
		});

		/** @scenario export without --include-spans keeps the legacy request shape */
		it("sends no includeSpans field when the flag is absent", async () => {
			await exportTracesCommand({});

			expect(requestBodies()[0]).not.toHaveProperty("includeSpans");
		});
	});

	describe("when exporting as CSV", () => {
		/** @scenario CSV export appends token and context columns after the existing ones */
		it("keeps the legacy columns first and appends the token metric columns", async () => {
			fetchMock.mockResolvedValueOnce(
				pageResponse({
					count: 1,
					from: 0,
					totalHits: 1,
					trace: (i) => ({
						trace_id: `trace_${i}`,
						input: { value: "hi" },
						output: { value: "yo" },
						timestamps: { started_at: 1720000000000 },
						metrics: {
							prompt_tokens: 10,
							completion_tokens: 5,
							total_cost: 0.5,
							context_size_tokens: 123456,
							cache_read_input_tokens: 120000,
							cache_creation_input_tokens: 3456,
							reasoning_tokens: 7,
						},
					}),
				}),
			);

			await exportTracesCommand({ format: "csv" });

			const lines = writtenOutput().trim().split("\n");
			expect(lines[0]).toBe(
				"trace_id,input,output,started_at,error,prompt_tokens,completion_tokens,total_cost,context_size_tokens,cache_read_input_tokens,cache_creation_input_tokens,reasoning_tokens",
			);
			expect(lines[1]).toContain("trace_0,hi,yo,");
			expect(lines[1]).toContain(",10,5,0.5,123456,120000,3456,7");
		});
	});
});

describe("transcriptTraceCommand()", () => {
	let fetchMock: ReturnType<typeof vi.fn>;
	let logSpy: ReturnType<typeof vi.spyOn>;

	const transcriptDoc = {
		agent: "claude_code",
		sessionId: "session-123",
		entries: [
			{ kind: "user_prompt", atMs: 1720000000000, text: "summarise the repo", chars: 18 },
			{ kind: "assistant_message", atMs: 1720000002000, text: "Here is the summary.", model: "claude-opus-5" },
		],
		totals: { modelCalls: 1, toolCalls: 0, tokens: 128, costUsd: 0.04 },
		subAgents: [],
	};

	beforeEach(() => {
		vi.clearAllMocks();
		fetchMock = vi
			.fn()
			.mockResolvedValue(
				new Response(JSON.stringify(transcriptDoc), { status: 200 }),
			);
		vi.stubGlobal("fetch", fetchMock);
		logSpy = vi.spyOn(console, "log").mockImplementation(noop);
		vi.spyOn(console, "error").mockImplementation(noop);
		mockProcessExit();
	});

	/** @scenario the CLI prints a trace transcript */
	it("fetches the transcript endpoint and prints the entries", async () => {
		await transcriptTraceCommand("trace_abc", {});

		expect(String(fetchMock.mock.calls[0]![0])).toContain(
			"/api/traces/trace_abc/transcript",
		);
		const printed = logSpy.mock.calls
			.map((c: unknown[]) => c.join(" "))
			.join("\n");
		expect(printed).toContain("summarise the repo");
		expect(printed).toContain("Here is the summary.");
		expect(printed).toContain("1 model calls");
	});

	it("exits with code 1 when the endpoint answers an error", async () => {
		fetchMock.mockResolvedValue(
			new Response(JSON.stringify({ message: "Trace not found." }), {
				status: 404,
			}),
		);

		await expect(transcriptTraceCommand("nope", {})).rejects.toThrow(
			ProcessExitError,
		);
	});
});

describe("getTraceCommand()", () => {
	let mockGet: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockGet = vi.fn();
		// biome-ignore lint/complexity/useArrowFunction: the command news up TracesApiService, and an arrow function is not constructible.
		vi.mocked(TracesApiService).mockImplementation(function () {
			return {
				search: vi.fn(),
				get: mockGet,
			} as unknown as TracesApiService;
		});
		vi.spyOn(console, "log").mockImplementation(noop);
		vi.spyOn(console, "error").mockImplementation(noop);
		mockProcessExit();
	});

	describe("when trace is found", () => {
		it("calls get with the provided trace ID", async () => {
			mockGet.mockResolvedValue({ traceId: "trace_abc", input: "test" });

			await getTraceCommand("trace_abc", {});

			expect(mockGet).toHaveBeenCalledWith("trace_abc", { format: "digest" });
		});
	});

	describe("when trace is not found", () => {
		it("exits with code 1", async () => {
			mockGet.mockRejectedValue(new TracesApiError("Not found", "get trace"));

			await expect(getTraceCommand("nonexistent", {})).rejects.toThrow(
				ProcessExitError,
			);
		});
	});
});
