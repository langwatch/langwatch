import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCodexIOStreamer } from "../codex-rollout-otlp";

const line = (obj: unknown) => JSON.stringify(obj);

const taskStarted = (traceId: string, turnId: string) => ({
  type: "event_msg",
  payload: {
    type: "task_started",
    turn_id: turnId,
    trace_id: traceId,
    started_at: 1_780_000_000,
  },
});
const turnContext = (turnId: string, model = "gpt-5.5") => ({
  type: "turn_context",
  payload: { turn_id: turnId, model },
});
const userMsg = (text: string) => ({
  type: "response_item",
  payload: { type: "message", role: "user", content: [{ type: "input_text", text }] },
});
const agentMessage = (message: string) => ({
  type: "event_msg",
  payload: { type: "agent_message", message, phase: "final_answer" },
});

const completedTurn = (traceId: string, turnId: string, user: string, reply: string) =>
  [taskStarted(traceId, turnId), turnContext(turnId), userMsg(user), agentMessage(reply)]
    .map(line)
    .join("\n");

/** A fake OTLP endpoint that records the trace_ids in each POST. */
function recordingFetch() {
  const posted: string[][] = [];
  const fetchImpl = (async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body);
    const spans = body.resourceSpans[0].scopeSpans[0].spans as { traceId: string }[];
    posted.push(spans.map((s) => s.traceId));
    return { ok: true } as Response;
  }) as unknown as typeof fetch;
  return { posted, fetchImpl };
}

describe("createCodexIOStreamer", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "codex-stream-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const rolloutFile = () => join(root, "rollout-2026-test.jsonl");

  const newStreamer = (fetchImpl: typeof fetch) =>
    createCodexIOStreamer({
      sinceMs: 0,
      endpoint: "http://collector.test/v1/traces",
      token: "sk-lw-test",
      sessionsRoot: root,
      fetchImpl,
    });

  describe("given a completed turn already in the rollout", () => {
    /** @scenario "A completed turn is streamed mid-session and only its content is posted" */
    it("posts one span for that turn's trace_id", async () => {
      await writeFile(rolloutFile(), completedTurn("t-one", "t1", "hi", "there"));
      const { posted, fetchImpl } = recordingFetch();

      const emitted = await newStreamer(fetchImpl).harvest(1);

      expect(emitted).toBe(1);
      expect(posted).toEqual([["t-one"]]);
    });
  });

  describe("given a turn whose assistant reply has not landed yet", () => {
    /** @scenario "A turn is not streamed until its assistant reply lands" */
    it("posts nothing, then streams the turn once the reply is appended", async () => {
      await writeFile(
        rolloutFile(),
        [line(taskStarted("t-one", "t1")), line(turnContext("t1")), line(userMsg("hi"))].join("\n"),
      );
      const { posted, fetchImpl } = recordingFetch();
      const streamer = newStreamer(fetchImpl);

      expect(await streamer.harvest(1)).toBe(0);
      expect(posted).toEqual([]);

      await appendFile(rolloutFile(), `\n${line(agentMessage("there"))}`);

      expect(await streamer.harvest(2)).toBe(1);
      expect(posted).toEqual([["t-one"]]);
    });
  });

  describe("given a turn that has already been streamed", () => {
    /** @scenario "Re-harvesting an already-streamed turn posts nothing" */
    it("posts only the newly-completed turn on a later harvest", async () => {
      await writeFile(rolloutFile(), completedTurn("t-one", "t1", "hi", "there"));
      const { posted, fetchImpl } = recordingFetch();
      const streamer = newStreamer(fetchImpl);

      await streamer.harvest(1);
      // A second turn completes and is appended to the same append-only rollout.
      await appendFile(rolloutFile(), `\n${completedTurn("t-two", "t2", "again", "ok")}`);

      const emitted = await streamer.harvest(2);

      expect(emitted).toBe(1);
      expect(posted).toEqual([["t-one"], ["t-two"]]);
    });
  });
});
