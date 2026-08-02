/**
 * `langwatch ingest codex` end to end over a real codex home: a real
 * config.toml the command reads its endpoint and key back out of, real
 * transcripts on disk, and a real (failing) network call.
 *
 * The failure path is the one that matters most. Codex runs this after every
 * completed turn of every session, so a harvest that can throw, exit non-zero,
 * or print to the terminal is a harvest that damages the thing it is meant to
 * observe. That is asserted here against a genuinely unreachable endpoint
 * rather than a mocked rejection.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { writeCodexOtelBlock } from "@/cli/utils/codex-config-toml";

import { ingestCodexCommand } from "../codex";

/** Port 1 is reserved and never listening, so the POST really fails. */
const UNREACHABLE = "http://127.0.0.1:1/api/otel";

let codexHome: string;
let priorCodexHome: string | undefined;

function writeRollout(threadId: string, traceId: string, reply: string): void {
	const dir = join(codexHome, "sessions", "2026", "08", "02");
	mkdirSync(dir, { recursive: true });
	const lines = [
		{
			type: "event_msg",
			payload: {
				type: "task_started",
				turn_id: "turn-1",
				trace_id: traceId,
				started_at: 1785654946,
			},
		},
		{
			type: "response_item",
			payload: {
				type: "message",
				role: "user",
				content: [{ type: "input_text", text: "hi" }],
			},
		},
		{
			type: "event_msg",
			payload: { type: "agent_message", message: reply, phase: "final_answer" },
		},
	];
	writeFileSync(
		join(dir, `rollout-2026-08-02T09-15-46-${threadId}.jsonl`),
		lines.map((l) => JSON.stringify(l)).join("\n"),
	);
}

function enableCapture(endpoint: string): void {
	writeCodexOtelBlock(
		{
			endpoint: `${endpoint}/v1/traces`,
			ingestionToken: "sk-lw-test-key",
			environment: "test",
		},
		{ filePath: join(codexHome, "config.toml"), persistAuthHeader: true },
	);
}

beforeEach(() => {
	codexHome = mkdtempSync(join(tmpdir(), "lw-codex-home-"));
	priorCodexHome = process.env.CODEX_HOME;
	process.env.CODEX_HOME = codexHome;
});

afterEach(() => {
	if (priorCodexHome === undefined) delete process.env.CODEX_HOME;
	else process.env.CODEX_HOME = priorCodexHome;
	rmSync(codexHome, { recursive: true, force: true });
	vi.restoreAllMocks();
});

describe("ingest codex", () => {
	describe("given LangWatch cannot be reached", () => {
		describe("when codex runs the harvest after a completed turn", () => {
			/** @scenario "A harvest that fails does not disturb the coding session" */
			it("returns quietly, without throwing, exiting, or printing to the session", async () => {
				enableCapture(UNREACHABLE);
				writeRollout("thread-a", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "mango");

				const stdout = vi
					.spyOn(process.stdout, "write")
					.mockImplementation(() => true);
				const stderr = vi
					.spyOn(process.stderr, "write")
					.mockImplementation(() => true);
				const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
				const exit = vi
					.spyOn(process, "exit")
					.mockImplementation((() => undefined) as never);

				await expect(
					ingestCodexCommand({
						notify: JSON.stringify({
							type: "agent-turn-complete",
							"thread-id": "thread-a",
						}),
					}),
				).resolves.toBeUndefined();

				expect(exit).not.toHaveBeenCalled();
				expect(stdout).not.toHaveBeenCalled();
				expect(stderr).not.toHaveBeenCalled();
				expect(log).not.toHaveBeenCalled();
			});
		});
	});

	describe("given capture was never enabled", () => {
		describe("when codex runs the harvest", () => {
			it("stays quiet rather than complaining on every turn", async () => {
				writeRollout("thread-a", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "mango");
				const stderr = vi
					.spyOn(process.stderr, "write")
					.mockImplementation(() => true);
				const exit = vi
					.spyOn(process, "exit")
					.mockImplementation((() => undefined) as never);

				await ingestCodexCommand({ notify: '{"thread-id":"thread-a"}' });

				expect(stderr).not.toHaveBeenCalled();
				expect(exit).not.toHaveBeenCalled();
			});
		});
	});

	describe("given codex handed over a payload that cannot be read", () => {
		describe("when the harvest resolves which transcript to read", () => {
			/** @scenario "A turn-completion payload that cannot be read falls back to recent sessions" */
			it("sweeps the recently-written sessions so the finished turn is still captured", async () => {
				const posted: any[] = [];
				vi.spyOn(globalThis, "fetch").mockImplementation((async (
					_url: string,
					init: any,
				) => {
					posted.push(JSON.parse(init.body));
					return { ok: true, status: 200 } as any;
				}) as any);
				enableCapture("https://app.langwatch.test/api/otel");
				writeRollout("thread-a", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "mango");

				await ingestCodexCommand({ notify: "not-json-at-all" });

				const traceIds = posted
					.flatMap((b) =>
						b.resourceSpans.flatMap((rs: any) =>
							rs.scopeSpans.flatMap((ss: any) => ss.spans),
						),
					)
					.map((s: any) => s.traceId);
				expect(traceIds).toContain("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
			});
		});
	});

	describe("given sessions that completed before capture was enabled", () => {
		describe("when the user backfills them", () => {
			/** @scenario "Sessions already on disk can be captured after the fact" */
			it("recovers each session's turns onto the traces codex reported at the time", async () => {
				const posted: any[] = [];
				const server = vi.spyOn(globalThis, "fetch").mockImplementation((async (
					_url: string,
					init: any,
				) => {
					posted.push(JSON.parse(init.body));
					return { ok: true, status: 200 } as any;
				}) as any);
				enableCapture("https://app.langwatch.test/api/otel");
				writeRollout("thread-a", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "first");
				writeRollout("thread-b", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "second");
				const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

				await ingestCodexCommand({ all: true, json: true });

				expect(server).toHaveBeenCalled();
				const traceIds = posted
					.flatMap((b) =>
						b.resourceSpans.flatMap((rs: any) =>
							rs.scopeSpans.flatMap((ss: any) => ss.spans),
						),
					)
					.map((s: any) => s.traceId);
				expect(traceIds).toEqual(
					expect.arrayContaining([
						"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
						"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
					]),
				);
				expect(log).toHaveBeenCalledWith(expect.stringContaining('"turns":2'));
			});
		});
	});

	describe("given the config points somewhere the POST is refused", () => {
		describe("when the user backfills", () => {
			it("reports the failure, unlike the turn-completion path which must stay silent", async () => {
				enableCapture(UNREACHABLE);
				writeRollout("thread-a", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "mango");
				const stderr = vi
					.spyOn(process.stderr, "write")
					.mockImplementation(() => true);
				const exit = vi
					.spyOn(process, "exit")
					.mockImplementation((() => undefined) as never);

				await ingestCodexCommand({ all: true });

				expect(stderr).toHaveBeenCalled();
				expect(exit).toHaveBeenCalledWith(1);
			});
		});
	});
});
