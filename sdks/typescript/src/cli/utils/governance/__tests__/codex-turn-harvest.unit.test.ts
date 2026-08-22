/**
 * Recovering a codex session's conversation from its rollout transcript and
 * emitting it onto the trace codex already reported tokens on.
 *
 * These exercise the real transcript shape codex 0.146 writes, captured from a
 * live session rather than invented, because the whole mechanism rests on two
 * fields codex is under no obligation to keep: `task_started.trace_id` (the
 * join key) and `agent_message.phase == "final_answer"` (the reply). A drift in
 * either is silent — content simply stops arriving — so it is pinned here.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	findRolloutForThread,
	harvestAndEmitCodexIO,
	harvestCodexThread,
} from "../codex-rollout-otlp";
import { assertCodexTurnHarvest } from "../shell-rc";

const THREAD = "019fc156-02e3-76a1-b462-14c38b450cb6";
const TRACE = "add81f7dde443979dde88487bd7fb454";

let home: string;
let root: string;

beforeEach(() => {
	// The real layout: the sessions tree under a codex home, with
	// session_index.jsonl beside it.
	home = mkdtempSync(join(tmpdir(), "lw-codex-home-"));
	root = join(home, "sessions");
	mkdirSync(join(root, "2026", "08", "02"), { recursive: true });
});

afterEach(() => {
	rmSync(home, { recursive: true, force: true });
});

function writeRollout(threadId: string, lines: unknown[]): string {
	const file = join(
		root,
		"2026",
		"08",
		"02",
		`rollout-2026-08-02T09-15-46-${threadId}.jsonl`,
	);
	writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n"));
	return file;
}

const taskStarted = (traceId: string) => ({
	type: "event_msg",
	payload: {
		type: "task_started",
		turn_id: "019fc154-29dc-76d1-8e29-e807065670cd",
		trace_id: traceId,
		started_at: 1785654946,
	},
});

const userMessage = (text: string) => ({
	type: "response_item",
	payload: {
		type: "message",
		role: "user",
		content: [{ type: "input_text", text }],
	},
});

const agentFinal = (message: string) => ({
	type: "event_msg",
	payload: { type: "agent_message", message, phase: "final_answer" },
});

const sessionMeta = (git?: Record<string, unknown>) => ({
	type: "session_meta",
	payload: {
		id: THREAD,
		cwd: "/home/dev/acme-app",
		...(git ? { git } : {}),
	},
});

/**
 * URLs are kept beside the bodies because the harvest posts to two endpoints,
 * spans to `/v1/traces` and the session context to `/v1/logs`, and several
 * tests assert which signal a payload went to rather than only its content.
 */
function recordingFetch() {
	const bodies: any[] = [];
	const urls: string[] = [];
	const impl = vi.fn(async (url: string, init?: any) => {
		urls.push(String(url));
		bodies.push(JSON.parse(init.body));
		return { ok: true, status: 200 } as any;
	});
	return { bodies, urls, impl: impl as unknown as typeof fetch };
}

const spansOf = (bodies: any[]) =>
	bodies.flatMap((b) =>
		b.resourceSpans.flatMap((rs: any) =>
			rs.scopeSpans.flatMap((ss: any) => ss.spans),
		),
	);

const attrOf = (span: any, key: string) =>
	span.attributes.find((a: any) => a.key === key)?.value?.stringValue;

/** One attribute of the session-context record, from the logs POST. */
const contextAttr = (bodies: any[], urls: string[], key: string) =>
	attrOf(
		bodies[urls.indexOf("https://e/v1/logs")].resourceLogs[0].scopeLogs[0]
			.logRecords[0],
		key,
	);

/**
 * A working directory git answers for: the checkout the session is sitting in,
 * on the branch it is on right now, which is what the harvest reads instead of
 * trusting the transcript's record of the session's first minute.
 */
const checkoutOn =
	(branch: string) =>
	({ args }: { args: string[]; cwd: string }): string | null => {
		if (args[0] === "remote") return "https://github.com/acme/acme-app.git";
		if (args[0] === "branch") return branch;
		// Not a linked worktree, so readWorktreeName finds nothing to name.
		return null;
	};

describe("harvestCodexThread", () => {
	describe("given a session that ran without the langwatch wrapper", () => {
		describe("when its completed turn is harvested", () => {
			/** @scenario "A session run without the wrapper still records the assistant reply" */
			it("records the assistant reply codex never put on the wire", async () => {
				writeRollout(THREAD, [
					taskStarted(TRACE),
					userMessage("reply with exactly: mango"),
					agentFinal("mango"),
				]);
				const { bodies, impl } = recordingFetch();

				const turns = await harvestCodexThread({
					threadId: THREAD,
					nowMs: 1785654950000,
					endpoint: "https://app.langwatch.ai/api/otel/v1/traces",
					logsEndpoint: null,
					token: "sk-lw-test",
					sessionsRoot: root,
					fetchImpl: impl,
				});

				expect(turns).toBe(1);
				expect(attrOf(spansOf(bodies)[0], "langwatch.output")).toBe("mango");
			});

			/** @scenario "The recovered conversation lands on the trace codex already reported tokens on" */
			it("puts it on the trace id the transcript recorded, not a fresh one", async () => {
				writeRollout(THREAD, [
					taskStarted(TRACE),
					userMessage("hi"),
					agentFinal("hello"),
				]);
				const { bodies, impl } = recordingFetch();

				await harvestCodexThread({
					threadId: THREAD,
					nowMs: 1785654950000,
					endpoint: "https://app.langwatch.ai/api/otel/v1/traces",
					logsEndpoint: null,
					token: "sk-lw-test",
					sessionsRoot: root,
					fetchImpl: impl,
				});

				expect(spansOf(bodies)[0].traceId).toBe(TRACE);
			});
		});
	});

	describe("given a turn that ran a tool before answering", () => {
		describe("when the turn is harvested", () => {
			/** @scenario "The recovered turn carries the prompt and the tool calls, not just the reply" */
			it("records the prompt, the tool call and its result alongside the reply", async () => {
				writeRollout(THREAD, [
					taskStarted(TRACE),
					userMessage("what is in the repo?"),
					{
						type: "response_item",
						payload: {
							type: "function_call",
							name: "exec_command",
							arguments: '{"cmd":"ls"}',
							call_id: "call_1",
						},
					},
					{
						type: "response_item",
						payload: {
							type: "function_call_output",
							call_id: "call_1",
							output: "README.md",
						},
					},
					agentFinal("Just a README."),
				]);
				const { bodies, impl } = recordingFetch();

				await harvestCodexThread({
					threadId: THREAD,
					nowMs: 1785654950000,
					endpoint: "https://e/v1/traces",
					logsEndpoint: null,
					token: "sk-lw-test",
					sessionsRoot: root,
					fetchImpl: impl,
				});

				const input = JSON.parse(
					attrOf(spansOf(bodies)[0], "langwatch.input") ?? "{}",
				);
				const roles = input.value.map((m: any) => m.role);
				expect(roles).toContain("user");
				expect(roles).toContain("tool");
				expect(JSON.stringify(input.value)).toContain("exec_command");
				expect(JSON.stringify(input.value)).toContain("README.md");
			});
		});
	});

	describe("given a turn that has started but has no reply yet", () => {
		describe("when the turn is harvested", () => {
			/** @scenario "A turn that has not been answered yet records nothing" */
			it("posts nothing rather than an empty span", async () => {
				writeRollout(THREAD, [taskStarted(TRACE), userMessage("thinking...")]);
				const { bodies, impl } = recordingFetch();

				const turns = await harvestCodexThread({
					threadId: THREAD,
					nowMs: 1785654950000,
					endpoint: "https://e/v1/traces",
					logsEndpoint: null,
					token: "sk-lw-test",
					sessionsRoot: root,
					fetchImpl: impl,
				});

				expect(turns).toBe(0);
				expect(bodies).toHaveLength(0);
			});
		});
	});

	describe("given a turn that was already harvested", () => {
		describe("when the same turn is harvested again", () => {
			// The hook fires after EVERY turn and re-reads the whole transcript, so
			// this is the normal case, not an edge one.
			/** @scenario "Harvesting the same turn twice does not duplicate the conversation" */
			it("re-emits the same span id, which the receiver drops as a duplicate", async () => {
				writeRollout(THREAD, [
					taskStarted(TRACE),
					userMessage("hi"),
					agentFinal("hello"),
				]);
				const { bodies, impl } = recordingFetch();
				const args = {
					threadId: THREAD,
					nowMs: 1785654950000,
					endpoint: "https://e/v1/traces",
					logsEndpoint: null,
					token: "sk-lw-test",
					sessionsRoot: root,
					fetchImpl: impl,
				};

				await harvestCodexThread(args);
				await harvestCodexThread(args);

				const spans = spansOf(bodies);
				expect(spans).toHaveLength(2);
				expect(spans[0].spanId).toBe(spans[1].spanId);
				expect(spans[0].traceId).toBe(spans[1].traceId);
			});
		});
	});

	describe("given several sessions on disk", () => {
		describe("when one thread is harvested", () => {
			/** @scenario "The finished turn identifies its own session" */
			it("reads only the named session's transcript", async () => {
				const other = "019fc999-dead-beef-0000-000000000000";
				writeRollout(THREAD, [
					taskStarted(TRACE),
					userMessage("mine"),
					agentFinal("mine reply"),
				]);
				writeRollout(other, [
					taskStarted("ffffffffffffffffffffffffffffffff"),
					userMessage("theirs"),
					agentFinal("theirs reply"),
				]);
				const { bodies, impl } = recordingFetch();

				await harvestCodexThread({
					threadId: THREAD,
					nowMs: 1785654950000,
					endpoint: "https://e/v1/traces",
					logsEndpoint: null,
					token: "sk-lw-test",
					sessionsRoot: root,
					fetchImpl: impl,
				});

				const spans = spansOf(bodies);
				expect(spans).toHaveLength(1);
				expect(attrOf(spans[0], "langwatch.output")).toBe("mine reply");
			});
		});
	});

	describe("given a session whose transcript records its repository", () => {
		const GIT = {
			branch: "feat/pricing",
			repository_url: "https://github.com/acme/acme-app.git",
			commit_hash: "f40dfb14fe962ff5c0e662de43424943ba44ae3e",
		};
		let stateDir: string;

		beforeEach(() => {
			stateDir = mkdtempSync(join(tmpdir(), "lw-codex-state-"));
		});

		afterEach(() => {
			rmSync(stateDir, { recursive: true, force: true });
		});

		describe("when the session is harvested", () => {
			/** @scenario "The harvest reports the repository the session worked on" */
			it("posts one session-context record beside the conversation", async () => {
				writeRollout(THREAD, [
					sessionMeta(GIT),
					taskStarted(TRACE),
					userMessage("hi"),
					agentFinal("hello"),
				]);
				const { bodies, urls, impl } = recordingFetch();

				await harvestCodexThread({
					threadId: THREAD,
					nowMs: 1785654950000,
					endpoint: "https://e/v1/traces",
					logsEndpoint: "https://e/v1/logs",
					token: "sk-lw-test",
					sessionsRoot: root,
					stateDir,
					fetchImpl: impl,
				});

				const log =
					bodies[urls.indexOf("https://e/v1/logs")].resourceLogs[0]
						.scopeLogs[0].logRecords[0];
				const attr = (key: string) =>
					log.attributes.find((a: any) => a.key === key)?.value?.stringValue;
				expect(attr("event.name")).toBe("langwatch.session_context");
				expect(attr("session.id")).toBe(THREAD);
				expect(attr("coding_agent.name")).toBe("codex");
				expect(attr("vcs.repository.host")).toBe("github.com");
				expect(attr("vcs.repository.owner")).toBe("acme");
				expect(attr("vcs.repository.name")).toBe("acme-app");
				expect(attr("vcs.ref.head.name")).toBe("feat/pricing");
				expect(urls).toContain("https://e/v1/traces");
			});

			/** @scenario "The reported branch follows the checkout, not the session's first minute" */
			it("reports the branch the checkout is on now", async () => {
				writeRollout(THREAD, [
					sessionMeta(GIT),
					taskStarted(TRACE),
					userMessage("hi"),
					agentFinal("hello"),
				]);
				const { bodies, urls, impl } = recordingFetch();

				await harvestCodexThread({
					threadId: THREAD,
					nowMs: 1785654950000,
					endpoint: "https://e/v1/traces",
					logsEndpoint: "https://e/v1/logs",
					token: "sk-lw-test",
					sessionsRoot: root,
					stateDir,
					fetchImpl: impl,
					runGit: checkoutOn("review/pr-7412"),
				});

				expect(contextAttr(bodies, urls, "vcs.ref.head.name")).toBe(
					"review/pr-7412",
				);
				expect(contextAttr(bodies, urls, "vcs.repository.name")).toBe(
					"acme-app",
				);
			});

			/** @scenario "A session whose transcript records no repository still reports one" */
			it("reports the working directory's repository when the transcript has none", async () => {
				writeRollout(THREAD, [
					sessionMeta(),
					taskStarted(TRACE),
					userMessage("hi"),
					agentFinal("hello"),
				]);
				const { bodies, urls, impl } = recordingFetch();

				await harvestCodexThread({
					threadId: THREAD,
					nowMs: 1785654950000,
					endpoint: "https://e/v1/traces",
					logsEndpoint: "https://e/v1/logs",
					token: "sk-lw-test",
					sessionsRoot: root,
					stateDir,
					fetchImpl: impl,
					runGit: checkoutOn("review/pr-7412"),
				});

				expect(contextAttr(bodies, urls, "vcs.repository.owner")).toBe("acme");
				expect(contextAttr(bodies, urls, "vcs.ref.head.name")).toBe(
					"review/pr-7412",
				);
			});

			/** @scenario "A transcript harvested away from its checkout keeps what codex recorded" */
			it("falls back to the transcript when git cannot read the directory", async () => {
				writeRollout(THREAD, [
					sessionMeta(GIT),
					taskStarted(TRACE),
					userMessage("hi"),
					agentFinal("hello"),
				]);
				const { bodies, urls, impl } = recordingFetch();

				await harvestCodexThread({
					threadId: THREAD,
					nowMs: 1785654950000,
					endpoint: "https://e/v1/traces",
					logsEndpoint: "https://e/v1/logs",
					token: "sk-lw-test",
					sessionsRoot: root,
					stateDir,
					fetchImpl: impl,
					runGit: () => null,
				});

				expect(contextAttr(bodies, urls, "vcs.ref.head.name")).toBe(
					"feat/pricing",
				);
				expect(contextAttr(bodies, urls, "vcs.repository.name")).toBe(
					"acme-app",
				);
			});

			/** @scenario "A notify that fires after every turn posts the repository once" */
			it("does not re-post an unchanged context on the next turn", async () => {
				writeRollout(THREAD, [
					sessionMeta(GIT),
					taskStarted(TRACE),
					userMessage("hi"),
					agentFinal("hello"),
				]);
				const { urls, impl } = recordingFetch();
				const args = {
					threadId: THREAD,
					nowMs: 1785654950000,
					endpoint: "https://e/v1/traces",
					logsEndpoint: "https://e/v1/logs",
					token: "sk-lw-test",
					sessionsRoot: root,
					stateDir,
					fetchImpl: impl,
				};

				await harvestCodexThread(args);
				await harvestCodexThread(args);

				expect(urls.filter((u) => u === "https://e/v1/logs")).toHaveLength(1);
				expect(urls.filter((u) => u === "https://e/v1/traces")).toHaveLength(2);
			});

			/** @scenario "A state directory that cannot be written still lets the conversation through" */
			it("still posts the turn spans when the fingerprint cannot be stored", async () => {
				writeRollout(THREAD, [
					sessionMeta(GIT),
					taskStarted(TRACE),
					userMessage("hi"),
					agentFinal("hello"),
				]);
				// A file where the state directory should be: every mkdir under it
				// fails with ENOTDIR, which is what makes writeFingerprint throw.
				const blocked = join(stateDir, "not-a-directory");
				writeFileSync(blocked, "");
				const { urls, impl } = recordingFetch();

				await harvestCodexThread({
					threadId: THREAD,
					nowMs: 1785654950000,
					endpoint: "https://e/v1/traces",
					logsEndpoint: "https://e/v1/logs",
					token: "sk-lw-test",
					sessionsRoot: root,
					stateDir: join(blocked, "state"),
					fetchImpl: impl,
				});

				// The context landed and the conversation went with it; only the
				// bookkeeping write was lost, which costs one re-POST next turn.
				expect(urls).toContain("https://e/v1/logs");
				expect(urls).toContain("https://e/v1/traces");
			});
		});
	});

	describe("given a session whose transcript records the typed prompt", () => {
		const GIT = {
			branch: "feat/pricing",
			repository_url: "https://github.com/acme/acme-app.git",
		};
		const typedPrompt = (message: string) => ({
			type: "event_msg",
			payload: { type: "user_message", message },
		});
		let stateDir: string;

		beforeEach(() => {
			stateDir = mkdtempSync(join(tmpdir(), "lw-codex-state-"));
		});

		afterEach(() => {
			rmSync(stateDir, { recursive: true, force: true });
		});

		const harvest = async (impl: typeof fetch) =>
			harvestCodexThread({
				threadId: THREAD,
				nowMs: 1785654950000,
				endpoint: "https://e/v1/traces",
				logsEndpoint: "https://e/v1/logs",
				token: "sk-lw-test",
				sessionsRoot: root,
				stateDir,
				fetchImpl: impl,
			});

		const contextAttr = ({
			bodies,
			urls,
			key,
		}: {
			bodies: any[];
			urls: string[];
			key: string;
		}) => {
			const at = urls.indexOf("https://e/v1/logs");
			// Without this the missing POST reads as `bodies[-1]` and the chain
			// throws a TypeError, which hides which expectation actually failed.
			expect(at, "no session-context record was posted").toBeGreaterThan(-1);
			return bodies[at].resourceLogs[0].scopeLogs[0].logRecords[0].attributes.find(
				(a: any) => a.key === key,
			)?.value?.stringValue;
		};

		describe("when the session is harvested", () => {
			/** @scenario "The harvest names the session by the first thing the user asked" */
			it("posts the prompt's first line as the session title", async () => {
				writeRollout(THREAD, [
					sessionMeta(GIT),
					typedPrompt("Fix the pricing rounding bug\nStart with the invoice tests."),
					taskStarted(TRACE),
					userMessage("Fix the pricing rounding bug"),
					agentFinal("done"),
				]);
				const { bodies, urls, impl } = recordingFetch();

				await harvest(impl);

				expect(contextAttr({ bodies, urls, key: "langwatch.session.title" })).toBe(
					"Fix the pricing rounding bug",
				);
			});

			/** @scenario "A machine-injected first prompt does not name the session" */
			it("posts no title when the first prompt is an injected tag", async () => {
				writeRollout(THREAD, [
					sessionMeta(GIT),
					typedPrompt("<environment_context>...</environment_context>"),
					taskStarted(TRACE),
					userMessage("hi"),
					agentFinal("hello"),
				]);
				const { bodies, urls, impl } = recordingFetch();

				await harvest(impl);

				expect(urls).toContain("https://e/v1/logs");
				expect(
					contextAttr({ bodies, urls, key: "langwatch.session.title" }),
				).toBeUndefined();
			});
		});
	});

	describe("given a session with no repository in its transcript", () => {
		const typedPrompt = (message: string) => ({
			type: "event_msg",
			payload: { type: "user_message", message },
		});
		const contextAttrsOf = (bodies: any[], urls: string[]) => {
			const log =
				bodies[urls.indexOf("https://e/v1/logs")].resourceLogs[0].scopeLogs[0]
					.logRecords[0];
			return Object.fromEntries(
				log.attributes.map((a: any) => [a.key, a.value?.stringValue]),
			);
		};

		describe("when the session is harvested with nothing to name it", () => {
			/** @scenario "A session with no remote, no prompt and no name posts no context" */
			it("posts the conversation and no context record", async () => {
				writeRollout(THREAD, [
					sessionMeta(),
					taskStarted(TRACE),
					userMessage("hi"),
					agentFinal("hello"),
				]);
				const { urls, impl } = recordingFetch();

				await harvestCodexThread({
					threadId: THREAD,
					nowMs: 1785654950000,
					endpoint: "https://e/v1/traces",
					logsEndpoint: "https://e/v1/logs",
					token: "sk-lw-test",
					sessionsRoot: root,
					fetchImpl: impl,
				});

				expect(urls).toEqual(["https://e/v1/traces"]);
			});
		});

		describe("when the transcript carries a typed prompt", () => {
			/** @scenario "A session outside any repository still posts a context that names it" */
			it("posts a context carrying the title and no repository attributes", async () => {
				writeRollout(THREAD, [
					sessionMeta(),
					taskStarted(TRACE),
					typedPrompt("Fix the flaky login test"),
					userMessage("Fix the flaky login test"),
					agentFinal("done"),
				]);
				const { bodies, urls, impl } = recordingFetch();

				await harvestCodexThread({
					threadId: THREAD,
					nowMs: 1785654950000,
					endpoint: "https://e/v1/traces",
					logsEndpoint: "https://e/v1/logs",
					token: "sk-lw-test",
					sessionsRoot: root,
					fetchImpl: impl,
				});

				expect(urls).toContain("https://e/v1/logs");
				const attributes = contextAttrsOf(bodies, urls);
				expect(attributes["session.id"]).toBe(THREAD);
				expect(attributes["langwatch.session.title"]).toBe(
					"Fix the flaky login test",
				);
				expect(attributes["vcs.repository.host"]).toBeUndefined();
				expect(attributes["vcs.repository.name"]).toBeUndefined();
			});
		});

		describe("when codex's session index names the thread", () => {
			/** @scenario "Codex's own thread name rides the context record" */
			it("carries the newest indexed name beside the derived title", async () => {
				// Appended lines are newer, so the second one is the rename that
				// must win.
				writeFileSync(
					join(home, "session_index.jsonl"),
					[
						JSON.stringify({
							id: THREAD,
							thread_name: "first name",
							updated_at: "2026-08-02T10:00:00Z",
						}),
						JSON.stringify({
							id: THREAD,
							thread_name: "pr-reviewer",
							updated_at: "2026-08-02T11:00:00Z",
						}),
					].join("\n"),
				);
				writeRollout(THREAD, [
					sessionMeta(),
					taskStarted(TRACE),
					typedPrompt("Fix the flaky login test"),
					userMessage("Fix the flaky login test"),
					agentFinal("done"),
				]);
				const { bodies, urls, impl } = recordingFetch();

				await harvestCodexThread({
					threadId: THREAD,
					nowMs: 1785654950000,
					endpoint: "https://e/v1/traces",
					logsEndpoint: "https://e/v1/logs",
					token: "sk-lw-test",
					sessionsRoot: root,
					fetchImpl: impl,
				});

				const attributes = contextAttrsOf(bodies, urls);
				expect(attributes["langwatch.session.name"]).toBe("pr-reviewer");
				expect(attributes["langwatch.session.title"]).toBe(
					"Fix the flaky login test",
				);
			});
		});
	});

	describe("given a thread with no transcript on disk", () => {
		describe("when it is harvested", () => {
			it("posts nothing instead of failing", async () => {
				const { bodies, impl } = recordingFetch();

				const turns = await harvestCodexThread({
					threadId: "019fc000-0000-0000-0000-000000000000",
					nowMs: 1785654950000,
					endpoint: "https://e/v1/traces",
					logsEndpoint: null,
					token: "sk-lw-test",
					sessionsRoot: root,
					fetchImpl: impl,
				});

				expect(turns).toBe(0);
				expect(bodies).toHaveLength(0);
			});
		});
	});
});

describe("assertCodexTurnHarvest", () => {
	let codexHome: string;
	let originalCodexHome: string | undefined;
	let logSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		codexHome = mkdtempSync(join(tmpdir(), "lw-codex-home-"));
		originalCodexHome = process.env.CODEX_HOME;
		process.env.CODEX_HOME = codexHome;
		logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
	});

	afterEach(() => {
		logSpy.mockRestore();
		if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
		else process.env.CODEX_HOME = originalCodexHome;
		rmSync(codexHome, { recursive: true, force: true });
	});

	describe("when the harvest is wired for the first time", () => {
		it("announces the install and how to recover earlier sessions", () => {
			assertCodexTurnHarvest();

			const printed = logSpy.mock.calls.flat().join("\n");
			expect(printed).toContain("record each turn's conversation");
			expect(printed).toContain("langwatch ingest codex");
		});
	});

	describe("when it is asserted again with nothing to change", () => {
		it("stays silent", () => {
			assertCodexTurnHarvest();
			logSpy.mockClear();

			assertCodexTurnHarvest();

			expect(logSpy).not.toHaveBeenCalled();
		});
	});

	describe("when the config cannot be written", () => {
		/** @scenario "A harvest that cannot be wired is reported, never silent" */
		it("says the harvest is not wired instead of returning silently", () => {
			rmSync(codexHome, { recursive: true, force: true });
			writeFileSync(codexHome, "a file where the directory should be");

			assertCodexTurnHarvest();

			const printed = logSpy.mock.calls.flat().join("\n");
			expect(printed).toContain("Could not wire the codex turn harvest");
		});
	});
});

describe("harvestAndEmitCodexIO", () => {
	describe("given a backfill of many sessions and a logs endpoint that never answers", () => {
		let stateDir: string;

		beforeEach(() => {
			stateDir = mkdtempSync(join(tmpdir(), "lw-codex-state-"));
			// Only the timers the harvest itself schedules, so the file reads
			// below still run on the real event loop and the test does not
			// depend on when they finish.
			vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
		});

		afterEach(() => {
			vi.useRealTimers();
			rmSync(stateDir, { recursive: true, force: true });
		});

		/** @scenario "A backfill of many sessions does not wait for them one by one" */
		it("posts the conversations after a bounded wait, whatever the session count", async () => {
			const SESSIONS = 60;
			for (let i = 0; i < SESSIONS; i++) {
				const thread = `019fc156-02e3-76a1-b462-14c38b45${String(i).padStart(4, "0")}`;
				writeRollout(thread, [
					{
						type: "session_meta",
						payload: {
							id: thread,
							cwd: "/home/dev/acme-app",
							git: {
								branch: "feat/pricing",
								repository_url: "https://github.com/acme/acme-app.git",
							},
						},
					},
					taskStarted(TRACE),
					userMessage("hi"),
					agentFinal("hello"),
				]);
			}

			let contextPostsInFlight = 0;
			let peakInFlight = 0;
			let tracePostAtMs: number | null = null;
			const impl = vi.fn((url: string, init?: any) => {
				if (String(url).endsWith("/v1/logs")) {
					contextPostsInFlight += 1;
					peakInFlight = Math.max(peakInFlight, contextPostsInFlight);
					// Answers only when its own abort fires, which is what a
					// wedged endpoint looks like to the caller.
					return new Promise((_resolve, reject) => {
						init.signal.addEventListener("abort", () => {
							contextPostsInFlight -= 1;
							reject(new Error("aborted"));
						});
					});
				}
				tracePostAtMs = Date.now();
				return Promise.resolve({ ok: true, status: 200 });
			}) as unknown as typeof fetch;

			const startedAtMs = Date.now();
			const harvesting = harvestAndEmitCodexIO({
				sinceMs: 0,
				nowMs: 1785654950000,
				endpoint: "https://e/v1/traces",
				logsEndpoint: "https://e/v1/logs",
				token: "sk-lw-test",
				sessionsRoot: root,
				stateDir,
				fetchImpl: impl,
			});
			// The rollouts are read off disk, one at a time, before the first
			// post goes out, and a fake clock does not wait for that. Give the
			// real event loop its turn first, or the advance below would run
			// past an empty schedule and the timers those posts create would
			// never fire.
			for (let i = 0; i < 20_000 && contextPostsInFlight === 0; i++) {
				await new Promise((resolve) => setImmediate(resolve));
			}
			expect(contextPostsInFlight).toBeGreaterThan(0);
			// Long enough for the serial shape to finish too, so a regression
			// fails on the assertion below rather than by timing out.
			await vi.advanceTimersByTimeAsync(600_000);
			await harvesting;

			// Posted one at a time, 60 sessions against this endpoint would hold
			// the conversation back for 60 times the 5 s per-post timeout.
			expect(peakInFlight).toBeGreaterThan(1);
			expect((tracePostAtMs ?? Number.NaN) - startedAtMs).toBeLessThanOrEqual(
				20_000,
			);
		});
	});
});

describe("findRolloutForThread", () => {
	describe("given a thread id that is not a plain identifier", () => {
		describe("when the transcript is resolved", () => {
			it("refuses it rather than letting it walk out of the sessions directory", async () => {
				writeRollout(THREAD, [taskStarted(TRACE), agentFinal("hi")]);

				expect(await findRolloutForThread("../../etc/passwd", root)).toBeNull();
				expect(await findRolloutForThread("a/b", root)).toBeNull();
			});
		});
	});

	describe("given the session exists", () => {
		describe("when the transcript is resolved", () => {
			it("finds it under the year/month/day nesting codex writes", async () => {
				const expected = writeRollout(THREAD, [
					taskStarted(TRACE),
					agentFinal("hi"),
				]);

				expect(await findRolloutForThread(THREAD, root)).toBe(expected);
			});
		});
	});
});
