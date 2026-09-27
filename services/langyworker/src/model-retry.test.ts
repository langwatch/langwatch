import { AgentSession } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TurnEventMapper } from "./events.js";
import {
  MODEL_RETRY_MAX_ATTEMPTS,
  abortableSleep,
  installModelRetry,
  isTransientModelFailure,
  namedWaitMs,
  retryDelayMs,
} from "./model-retry.js";

const failed = (errorMessage: string) => ({ stopReason: "error", errorMessage });

type FakeSession = {
  _retryAttempt: number;
  _retryAbortController: AbortController | undefined;
  _emit: ReturnType<typeof vi.fn>;
  _isRetryableError: (message: unknown) => boolean;
  _prepareRetry: (message: unknown) => Promise<boolean>;
  agent: { state: { messages: { role: string }[] } };
};

function fakeSession(): FakeSession {
  return {
    _retryAttempt: 0,
    _retryAbortController: undefined,
    _emit: vi.fn(),
    _isRetryableError: () => false,
    _prepareRetry: async () => false,
    agent: { state: { messages: [{ role: "user" }, { role: "assistant" }] } },
  };
}

function install(session: FakeSession, random = () => 0.5): void {
  installModelRetry({ session: session as never, random });
}

describe("isTransientModelFailure", () => {
  describe("when the failure is transient", () => {
    /** @scenario "Network failures, timeouts, dropped streams and server errors are transient" */
    it.each([
      "Our servers are currently overloaded. Please try again later.",
      "overloaded_error",
      "fetch failed",
      "Connection error.",
      "socket hang up",
      "read ECONNRESET",
      "Request timed out.",
      "terminated",
      "stream ended before message_stop",
      "500 Internal server error",
      "502 Bad Gateway",
      "503 Service Unavailable",
      "529 {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\"}}",
      "429 Rate limit reached for gpt-5-mini. Please try again in 2s.",
      "408 Request Timeout",
    ])("retries %s", (message) => {
      expect(isTransientModelFailure(failed(message))).toBe(true);
    });

    it("retries a 503 whose help text links to the billing page", () => {
      const message = "503 Service unavailable. See Plans & Billing for your usage.";
      expect(isTransientModelFailure(failed(message))).toBe(true);
    });
  });

  describe("when the failure is a refusal", () => {
    /** @scenario "A refusal is not retried" */
    it.each([
      "400 {\"error\":{\"message\":\"Invalid schema for function\"}}",
      "401 Incorrect API key provided",
      "403 Permission denied",
      "404 The model does not exist",
      "422 Unprocessable Entity",
      "400 {\"error\":{\"type\":\"rate_limit_error\"}}",
      "429 You exceeded your current quota: insufficient_quota",
      "usage_limit_reached",
      "Your credit balance is too low to access the API. Please go to Plans & Billing",
    ])("does not retry %s", (message) => {
      expect(isTransientModelFailure(failed(message))).toBe(false);
    });

    it("does not retry an answer that did not fail", () => {
      expect(isTransientModelFailure({ stopReason: "stop", errorMessage: "overloaded" })).toBe(
        false,
      );
      expect(isTransientModelFailure({ stopReason: "aborted", errorMessage: "terminated" })).toBe(
        false,
      );
      expect(isTransientModelFailure({ stopReason: "error" })).toBe(false);
    });
  });
});

describe("retryDelayMs", () => {
  describe("when the provider names no wait", () => {
    /** @scenario "An overloaded provider is retried until it answers" */
    it("doubles from one second: 1, 2, 4, 8 and 16 seconds at the centre of the jitter", () => {
      const waits = [1, 2, 3, 4, 5].map((attempt) =>
        retryDelayMs({ attempt, errorMessage: "overloaded", random: () => 0.5 }),
      );
      expect(waits).toEqual([1_000, 2_000, 4_000, 8_000, 16_000]);
    });

    it("shifts each wait by at most a fifth either way", () => {
      expect(retryDelayMs({ attempt: 3, errorMessage: "overloaded", random: () => 0 })).toBe(3_200);
      expect(retryDelayMs({ attempt: 3, errorMessage: "overloaded", random: () => 1 })).toBe(4_800);
    });
  });

  describe("when the provider names a wait", () => {
    /** @scenario "A wait the provider names is the wait Langy takes" */
    it("waits the named time instead of the backoff", () => {
      expect(
        retryDelayMs({
          attempt: 1,
          errorMessage: "429 Rate limit reached. Please try again in 7s.",
          random: () => 0.5,
        }),
      ).toBe(7_000);
      expect(
        retryDelayMs({ attempt: 4, errorMessage: "Please try again in 820ms", random: () => 0.5 }),
      ).toBe(820);
      expect(
        retryDelayMs({ attempt: 2, errorMessage: "503 retry-after: 3", random: () => 0.5 }),
      ).toBe(3_000);
    });

    it("gives up on a named wait longer than a minute", () => {
      expect(
        retryDelayMs({ attempt: 1, errorMessage: "Please try again in 90s", random: () => 0.5 }),
      ).toBeNull();
    });

    it("reads no wait from a message that names none", () => {
      expect(namedWaitMs("Our servers are currently overloaded")).toBeUndefined();
    });
  });
});

describe("installModelRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when a transient failure reaches pi's retry loop", () => {
    it("takes over which failures pi retries", () => {
      const session = fakeSession();
      install(session);
      expect(session._isRetryableError(failed("overloaded"))).toBe(true);
      expect(session._isRetryableError(failed("401 Incorrect API key provided"))).toBe(false);
    });

    it("drops the failed answer, announces the attempt and resumes after the wait", async () => {
      const session = fakeSession();
      install(session);

      let resumed: boolean | undefined;
      void session._prepareRetry(failed("overloaded")).then((value) => {
        resumed = value;
      });
      await vi.advanceTimersByTimeAsync(0);

      expect(session.agent.state.messages).toEqual([{ role: "user" }]);
      expect(session._emit).toHaveBeenCalledWith({
        type: "auto_retry_start",
        attempt: 1,
        maxAttempts: MODEL_RETRY_MAX_ATTEMPTS,
        delayMs: 1_000,
        errorMessage: "overloaded",
      });
      await vi.advanceTimersByTimeAsync(999);
      expect(resumed).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      expect(resumed).toBe(true);
    });
  });

  describe("when every retry fails", () => {
    /** @scenario "The error shows only after the last attempt" */
    it("gives up after five retries so the turn fails with the last error", async () => {
      const session = fakeSession();
      install(session);
      const waits: number[] = [];
      for (let attempt = 1; attempt <= MODEL_RETRY_MAX_ATTEMPTS; attempt++) {
        session.agent.state.messages.push({ role: "assistant" });
        const pending = session._prepareRetry(failed("overloaded"));
        await vi.runAllTimersAsync();
        expect(await pending).toBe(true);
        waits.push(session._emit.mock.calls.at(-1)?.[0].delayMs as number);
      }
      expect(waits).toEqual([1_000, 2_000, 4_000, 8_000, 16_000]);

      session.agent.state.messages.push({ role: "assistant" });
      expect(await session._prepareRetry(failed("overloaded"))).toBe(false);
      expect(session._retryAttempt).toBe(MODEL_RETRY_MAX_ATTEMPTS);
      expect(session._emit).toHaveBeenCalledTimes(MODEL_RETRY_MAX_ATTEMPTS);
    });
  });

  describe("when the person stops the turn during a wait", () => {
    /** @scenario "Stopping the turn during a wait ends the retries" */
    it("ends the wait at once and makes no further call", async () => {
      const session = fakeSession();
      install(session);
      const pending = session._prepareRetry(failed("overloaded"));
      await vi.advanceTimersByTimeAsync(10);
      session._retryAbortController?.abort();

      expect(await pending).toBe(false);
      expect(session._retryAttempt).toBe(0);
      expect(session._emit).toHaveBeenLastCalledWith({
        type: "auto_retry_end",
        success: false,
        attempt: 1,
        finalError: "Retry cancelled",
      });
    });
  });

  describe("when the provider names a wait too long to take", () => {
    it("leaves the failure standing", async () => {
      const tooLong = fakeSession();
      install(tooLong);
      expect(await tooLong._prepareRetry(failed("429 Please try again in 120s"))).toBe(false);
      expect(tooLong._emit).not.toHaveBeenCalled();
    });
  });
});

describe("abortableSleep", () => {
  it("rejects at once when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(abortableSleep(1_000, controller.signal)).rejects.toThrow("aborted");
  });
});

describe("pi's AgentSession", () => {
  it("still has the two methods the retry takes over", () => {
    const prototype = AgentSession.prototype as unknown as Record<string, unknown>;
    expect(typeof prototype._isRetryableError).toBe("function");
    expect(typeof prototype._prepareRetry).toBe("function");
    expect(typeof prototype._emit).toBe("function");
    expect(typeof prototype.abortRetry).toBe("function");
  });
});

describe("TurnEventMapper", () => {
  describe("when pi starts a retry", () => {
    /** @scenario "The panel shows which attempt is running" */
    it("emits the attempt, the budget and the wait", () => {
      const mapper = new TurnEventMapper("t1");
      expect(
        mapper.map({
          type: "auto_retry_start",
          attempt: 2,
          maxAttempts: 5,
          delayMs: 2_140,
          errorMessage: "overloaded",
        }),
      ).toEqual([{ type: "retrying", turnId: "t1", attempt: 2, maxAttempts: 5, delayMs: 2_140 }]);
    });
  });

  describe("when a retried call answers", () => {
    /** @scenario "The retry line clears once the call succeeds" */
    it("settles the retry", () => {
      const mapper = new TurnEventMapper("t1");
      expect(mapper.map({ type: "auto_retry_end", success: true, attempt: 2 })).toEqual([
        { type: "retry_settled", turnId: "t1" },
      ]);
    });

  });

  describe("when the retries end without an answer", () => {
    it("settles the retry so the line does not stay beside the error", () => {
      const mapper = new TurnEventMapper("t1");
      expect(mapper.map({ type: "auto_retry_end", success: false, attempt: 5 })).toEqual([
        { type: "retry_settled", turnId: "t1" },
      ]);
    });
  });
});
