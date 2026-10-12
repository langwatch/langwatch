/**
 * The agent-test turn runs the same adapters the scenario child runs, but
 * inside the control plane. It must reach nlpgo the way the control plane
 * always does and never post to the relay route, which exists only so a
 * child with no engine credential can borrow the control plane's.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { nlpgoFetchMock } = vi.hoisted(() => ({ nlpgoFetchMock: vi.fn() }));

vi.mock("../nlpgoFetch", () => ({ nlpgoFetch: nlpgoFetchMock }));

import { EXECUTE_SYNC_RELAY_PATH } from "~/server/scenarios/execution/serialized-adapters/execute-sync-transport";

import { inProcessExecuteSyncTransport } from "../inProcessExecuteSyncTransport";

beforeEach(() => {
  nlpgoFetchMock.mockReset();
});

describe("a turn sent from inside the control plane", () => {
  describe("given an agent test, which runs in the app process rather than a child", () => {
    /** @scenario "The agent-test turn reaches the engine directly" */
    it("goes through nlpgoFetch and never posts to the relay route", async () => {
      nlpgoFetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        enginePath: "go" as const,
        json: async () => ({}),
        text: async () => '{"status":"success"}',
      });

      const transport = inProcessExecuteSyncTransport({
        projectId: "project-1",
      });
      const response = await transport.post({
        event: { type: "execute_flow" },
        signal: new AbortController().signal,
        timeoutMs: 120_000,
      });

      expect(nlpgoFetchMock).toHaveBeenCalledTimes(1);
      const call = nlpgoFetchMock.mock.calls[0]![0] as {
        projectId: string;
        path: string;
        origin: string;
        causalityDepth?: number;
        parentTrace?: unknown;
      };
      expect(call.projectId).toBe("project-1");
      expect(call.path).toBe("/studio/execute_sync");
      expect(call.origin).toBe("scenario");
      // Same two omissions the child's own post makes: a depth would stop
      // ON_MESSAGE monitors firing on the traces the run produces, and these
      // runs set do_not_trace so the engine emits no spans to parent.
      expect(call.causalityDepth).toBeUndefined();
      expect(call.parentTrace).toBeUndefined();

      expect(transport.endpoint).not.toContain(EXECUTE_SYNC_RELAY_PATH);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('{"status":"success"}');
    });

    it("passes the caller's cancellation down and arms no second deadline", async () => {
      nlpgoFetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        enginePath: "go" as const,
        json: async () => ({}),
        text: async () => "{}",
      });

      const controller = new AbortController();
      await inProcessExecuteSyncTransport({ projectId: "project-1" }).post({
        event: {},
        signal: controller.signal,
        timeoutMs: 120_000,
      });

      const call = nlpgoFetchMock.mock.calls[0]![0] as {
        signal?: AbortSignal;
        timeoutMs?: number;
      };
      expect(call.signal).toBe(controller.signal);
      // The adapter owns the only timer; a second deadline here would raise a
      // failure it would classify as a transport error rather than a timeout.
      expect(call.timeoutMs).toBeUndefined();
    });
  });
});
