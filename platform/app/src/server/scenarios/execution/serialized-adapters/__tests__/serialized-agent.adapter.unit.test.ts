/**
 * @vitest-environment node
 *
 * The per thread session store every serialized adapter shares.
 *
 * @see specs/agents/agent-session-echo.feature
 */

import { AgentRole } from "@langwatch/scenario";
import { describe, expect, it } from "vitest";
import { SESSION_MAX_BYTES } from "~/server/connected-agents/constants";
import {
  AgentSessionTooLargeError,
  SESSION_TOO_LARGE_PREFIX,
  SerializedAgentAdapter,
} from "../serialized-agent.adapter";

/** The smallest adapter that exposes the store: no transport, no call. */
class StoreOnlyAdapter extends SerializedAgentAdapter {
  role = AgentRole.AGENT;

  async call(): Promise<string> {
    return "";
  }

  read(threadId: string): unknown {
    return this.sessionOf(threadId);
  }

  write(threadId: string, session: unknown): void {
    this.storeSession({ threadId, session });
  }
}

describe("SerializedAgentAdapter", () => {
  describe("when no turn has answered yet", () => {
    /** @scenario "A thread has no session before its first turn answers" */
    it("reads nothing for a thread", () => {
      const adapter = new StoreOnlyAdapter();

      expect(adapter.read("thread_a")).toBeUndefined();
    });
  });

  describe("when a session was stored for one thread", () => {
    /** @scenario "A stored session is read back for the same thread only" */
    it("reads it back for that thread and nothing for another", () => {
      const adapter = new StoreOnlyAdapter();

      adapter.write("thread_a", { cursor: 7 });

      expect(adapter.read("thread_a")).toEqual({ cursor: 7 });
      expect(adapter.read("thread_b")).toBeUndefined();
    });

    /** @scenario "A turn that returns no session leaves the held value unchanged" */
    it("keeps the value when a later turn returns no session", () => {
      const adapter = new StoreOnlyAdapter();
      adapter.write("thread_a", "conv_1");

      adapter.write("thread_a", undefined);

      expect(adapter.read("thread_a")).toBe("conv_1");
    });

    it("keeps null as a value the agent chose", () => {
      const adapter = new StoreOnlyAdapter();
      adapter.write("thread_a", "conv_1");

      adapter.write("thread_a", null);

      expect(adapter.read("thread_a")).toBeNull();
    });
  });

  describe("when the session is above the cap", () => {
    /** @scenario "A session above the cap is refused with a typed error" */
    it("refuses it with the payload code and keeps the held value", () => {
      const adapter = new StoreOnlyAdapter();
      adapter.write("thread_a", "before");
      const oversized = "x".repeat(SESSION_MAX_BYTES + 1);

      let thrown: unknown;
      try {
        adapter.write("thread_a", oversized);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(AgentSessionTooLargeError);
      const error = thrown as AgentSessionTooLargeError;
      expect(error.code).toBe("agent_payload_too_large");
      expect(error.limitBytes).toBe(SESSION_MAX_BYTES);
      expect(error.sizeBytes).toBeGreaterThan(SESSION_MAX_BYTES);
      expect(error.message).toContain(SESSION_TOO_LARGE_PREFIX);
      expect(error.message).toContain(`${error.sizeBytes} bytes`);
      expect(error.message).toContain(`${SESSION_MAX_BYTES} bytes`);
      expect(adapter.read("thread_a")).toBe("before");
    });

    it("measures the value as JSON, so a value exactly at the cap is kept", () => {
      const adapter = new StoreOnlyAdapter();
      // A string of n characters is n + 2 bytes as JSON, for the quotes.
      const atCap = "x".repeat(SESSION_MAX_BYTES - 2);

      adapter.write("thread_a", atCap);

      expect(adapter.read("thread_a")).toBe(atCap);
    });
  });
});
