/**
 * The frame readers: what the SDK accepts from the platform, and what it
 * drops rather than throws.
 */
import { describe, expect, it } from "vitest";

import {
  parseServerFrame,
  serializeFrame,
  traceIdFromTraceparent,
  PROTOCOL_VERSION,
} from "../protocol";

describe("parseServerFrame()", () => {
  describe("when given a registered frame", () => {
    it("reads the agents, the heartbeat and the instance id", () => {
      const frame = parseServerFrame(
        JSON.stringify({
          type: "registered",
          protocol: 1,
          agents: [
            {
              name: "a",
              environment: "development",
              id: "agent_1",
              url: "https://x/y",
              parameterNotes: ["n"],
            },
          ],
          heartbeatIntervalMs: 5000,
          instanceId: "inst_1",
        }),
      );
      expect(frame).toEqual({
        type: "registered",
        protocol: 1,
        agents: [
          {
            name: "a",
            environment: "development",
            id: "agent_1",
            url: "https://x/y",
            parameterNotes: ["n"],
          },
        ],
        heartbeatIntervalMs: 5000,
        instanceId: "inst_1",
      });
    });
  });

  describe("when given a call frame", () => {
    it("reads every turn field and defaults the ones missing", () => {
      const frame = parseServerFrame(
        JSON.stringify({
          type: "call",
          protocol: 1,
          callId: "call_1",
          agentId: "agent_1",
          threadId: "thread_1",
          messages: [{ role: "user", content: "hi" }],
          params: { model: "gpt-5", n: 2, flag: true, dropped: { nested: 1 } },
          traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
          run: { scenarioRunId: "run_1", ignored: 1 },
        }),
      );
      expect(frame).toEqual({
        type: "call",
        protocol: 1,
        callId: "call_1",
        agentId: "agent_1",
        threadId: "thread_1",
        messages: [{ role: "user", content: "hi" }],
        newMessages: [{ role: "user", content: "hi" }],
        params: { model: "gpt-5", n: 2, flag: true },
        session: null,
        traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
        deadlineAt: null,
        run: { scenarioRunId: "run_1" },
      });
    });
  });

  describe("when given a registered frame that names agents by agentId", () => {
    it("reads agentId as the id", () => {
      const frame = parseServerFrame(
        JSON.stringify({
          type: "registered",
          protocol: 1,
          agents: [
            {
              name: "a",
              environment: "development",
              agentId: "agent_1",
              url: "",
              parameterNotes: [],
            },
          ],
          heartbeatIntervalMs: 5000,
          instanceId: "inst_1",
        }),
      );
      expect(frame).toMatchObject({ type: "registered", agents: [{ id: "agent_1" }] });
    });
  });

  describe("when a call carries a numeric deadline", () => {
    it("reads it as epoch milliseconds, and an ISO string too", () => {
      const at = 1_700_000_000_000;
      const base = { type: "call", protocol: 1, callId: "c", agentId: "a", messages: [] };
      expect(parseServerFrame(JSON.stringify({ ...base, deadlineAt: at }))).toMatchObject({
        deadlineAt: at,
      });
      expect(
        parseServerFrame(JSON.stringify({ ...base, deadlineAt: new Date(at).toISOString() })),
      ).toMatchObject({
        deadlineAt: at,
      });
    });
  });

  describe("when given a refused frame", () => {
    it("carries the code, the message and the meta", () => {
      expect(
        parseServerFrame(
          JSON.stringify({
            type: "refused",
            code: "project_required",
            message: "pick one",
            meta: { projects: [] },
          }),
        ),
      ).toEqual({
        type: "refused",
        protocol: PROTOCOL_VERSION,
        code: "project_required",
        message: "pick one",
        meta: { projects: [] },
      });
    });
  });

  describe("when given something that is not a frame", () => {
    it("returns null for bad JSON, unknown types and frames missing their ids", () => {
      expect(parseServerFrame("{nope")).toBeNull();
      expect(parseServerFrame(JSON.stringify({ type: "stream", protocol: 1 }))).toBeNull();
      expect(parseServerFrame(JSON.stringify({ type: "call", protocol: 1 }))).toBeNull();
      expect(parseServerFrame(JSON.stringify({ type: "cancel", protocol: 1 }))).toBeNull();
    });
  });
});

describe("serializeFrame()", () => {
  it("writes the frame as one JSON text", () => {
    expect(
      JSON.parse(serializeFrame({ type: "ack", protocol: PROTOCOL_VERSION, callId: "c" })),
    ).toEqual({
      type: "ack",
      protocol: 1,
      callId: "c",
    });
  });
});

describe("traceIdFromTraceparent()", () => {
  it("reads the trace id and refuses a malformed header", () => {
    expect(traceIdFromTraceparent("00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01")).toBe(
      "0af7651916cd43dd8448eb211c80319c",
    );
    expect(traceIdFromTraceparent("nope")).toBeNull();
    expect(traceIdFromTraceparent(null)).toBeNull();
  });
});
