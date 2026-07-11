import { describe, expect, it } from "vitest";
import {
  AGENT_CHAT_TIMEOUT_MS,
  LangyAgentAtCapacityError,
  LangyAgentSessionLostError,
  LangyAgentUnavailableError,
  LangyWorkerRestartingError,
  classifyLangyTurnError,
  langyAgentErrorFromFrame,
  serializeLangyTurnError,
} from "../langy-turn-errors";

/**
 * A turn fails in a handful of KNOWN ways. Each must reach the browser as its
 * own `kind` — with only user-safe `meta` — and only a genuinely unexpected
 * exception may fall through to `unknown`.
 */

describe("langyAgentErrorFromFrame", () => {
  describe("given the manager's typed error frames", () => {
    it("maps at-capacity onto the at-capacity domain error", () => {
      expect(langyAgentErrorFromFrame("at-capacity")).toBeInstanceOf(
        LangyAgentAtCapacityError,
      );
    });

    it("maps session-not-found onto the session-lost domain error", () => {
      expect(langyAgentErrorFromFrame("session-not-found")).toBeInstanceOf(
        LangyAgentSessionLostError,
      );
    });
  });

  describe("given an arbitrary agent-side error string", () => {
    it("keeps it as an opaque Error so it is never pattern-matched into a kind", () => {
      const error = langyAgentErrorFromFrame(
        "worker spawn failed: /home/langy-7: permission denied",
      );

      expect(error).not.toBeInstanceOf(LangyAgentAtCapacityError);
      expect(error.message).toBe(
        "worker spawn failed: /home/langy-7: permission denied",
      );
      expect(classifyLangyTurnError(error).kind).toBe("unknown");
    });
  });
});

describe("classifyLangyTurnError", () => {
  describe("given the manager responded non-2xx", () => {
    it("classifies unavailable and exposes only the status", () => {
      const shape = classifyLangyTurnError(
        new LangyAgentUnavailableError("manager responded 503", {
          status: 503,
        }),
      );

      expect(shape.kind).toBe("langy_agent_unavailable");
      expect(shape.httpStatus).toBe(503);
      expect(shape.meta).toEqual({ status: 503 });
    });
  });

  describe("given the manager is unreachable", () => {
    it("classifies unavailable for a connect-level failure", () => {
      const failure = new TypeError("fetch failed");
      (failure as { cause?: unknown }).cause = Object.assign(
        new Error("connect ECONNREFUSED 10.0.0.4:8080"),
        { code: "ECONNREFUSED" },
      );

      const shape = classifyLangyTurnError(failure);

      expect(shape.kind).toBe("langy_agent_unavailable");
      expect(shape.meta).toEqual({});
    });
  });

  describe("given the turn hit the request timeout", () => {
    it("classifies a turn timeout carrying the budget it blew", () => {
      const timeout = Object.assign(new Error("The operation was aborted"), {
        name: "TimeoutError",
      });

      const shape = classifyLangyTurnError(timeout);

      expect(shape.kind).toBe("langy_turn_timeout");
      expect(shape.httpStatus).toBe(504);
      expect(shape.meta).toEqual({ timeoutMs: AGENT_CHAT_TIMEOUT_MS });
    });
  });

  describe("given the worker drained mid-turn", () => {
    it("classifies a worker restart", () => {
      const shape = classifyLangyTurnError(new LangyWorkerRestartingError());

      expect(shape.kind).toBe("langy_worker_restarting");
    });
  });

  describe("given a genuinely unexpected exception", () => {
    it("falls back to unknown with no meta", () => {
      const shape = classifyLangyTurnError(
        new Error("Cannot read properties of undefined (reading 'foo')"),
      );

      expect(shape.kind).toBe("unknown");
      expect(shape.meta).toEqual({});
      expect(shape.httpStatus).toBe(500);
    });
  });
});

describe("serializeLangyTurnError", () => {
  describe("given any classified failure", () => {
    it("never leaks the raw message onto the wire", () => {
      const serialized = serializeLangyTurnError(
        new LangyAgentUnavailableError("manager responded 401", { status: 401 }),
      );

      expect(serialized).not.toContain("manager responded");
      expect(JSON.parse(serialized)).toMatchObject({
        kind: "langy_agent_unavailable",
        meta: { status: 401 },
      });
    });

    it("never leaks an unexpected exception's message or stack", () => {
      const boom = new Error("secret-internal-detail at /srv/app/foo.ts:12");

      const serialized = serializeLangyTurnError(boom);

      expect(serialized).not.toContain("secret-internal-detail");
      expect(serialized).not.toContain("/srv/app");
      expect(JSON.parse(serialized)).toMatchObject({ kind: "unknown" });
    });
  });
});
