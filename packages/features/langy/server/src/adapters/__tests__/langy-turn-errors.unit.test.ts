import { handledErrorFromHerr } from "@langwatch/handled-error";
import { describe, expect, it } from "vitest";
import { LangyModelNotConfiguredError } from "@langwatch/langy-contract";

import {
  AGENT_CHAT_TIMEOUT_MS,
  LangyAgentAtCapacityError,
  LangyAgentErroredError,
  LangyAgentSessionLostError,
  LangyAgentUnavailableError,
  LangyGithubNotConnectedError,
  LangyGithubRepoNotAccessibleError,
  LangyTurnErrors,
  LangyWorkerRestartingError,
  LangyWorkerStoppedError,
} from "@langwatch/langy-server/execution/langy-turn.errors";

/**
 * A turn fails in a handful of KNOWN ways. Each must reach the browser as its
 * own `kind` — with only user-safe `meta` — and only a genuinely unexpected
 * exception may fall through to `unknown`.
 */

describe("LangyTurnErrors.fromFrame", () => {
  describe("given the manager's typed error frames", () => {
    it("maps at-capacity onto the at-capacity domain error", () => {
      expect(LangyTurnErrors.fromFrame("at-capacity")).toBeInstanceOf(LangyAgentAtCapacityError);
    });

    it("maps session-not-found onto the session-lost domain error", () => {
      expect(LangyTurnErrors.fromFrame("session-not-found")).toBeInstanceOf(
        LangyAgentSessionLostError,
      );
    });

    it("accepts the snake_case session_not_found the mono-binary emits", () => {
      // app.go's PostMessage session-vanished branch emits `session_not_found`;
      // the classifier historically matched only the hyphenated form.
      expect(LangyTurnErrors.fromFrame("session_not_found")).toBeInstanceOf(
        LangyAgentSessionLostError,
      );
    });

    it("maps worker_stopped — and its legacy alias — onto the worker-stopped final state", () => {
      // The worker died mid-turn. `worker_stopped` is the deliberate signal;
      // `post_error` is the older code for the same thing.
      for (const code of ["worker_stopped", "post_error"]) {
        expect(LangyTurnErrors.fromFrame(code), code).toBeInstanceOf(LangyWorkerStoppedError);
      }
    });

    it("maps the GitHub gate's not-connected code onto the connect-card domain error", () => {
      // The manager's GitHub gate (githubgate.go) stopped the turn: the agent
      // reached for gh/git-remote with no installation token. This is the wire
      // half of the connect-card flow — the explainer suppresses the red card
      // and the panel draws the install card instead.
      expect(LangyTurnErrors.fromFrame("langy_github_not_connected")).toBeInstanceOf(
        LangyGithubNotConnectedError,
      );
    });

    it("maps the GitHub gate's repo-not-accessible code onto its own domain error", () => {
      // Credentialed variant: the app installation doesn't cover the repo the
      // agent reached for (the clone 404'd). Terminal card pointing the user
      // at granting the app access.
      expect(LangyTurnErrors.fromFrame("langy_github_repo_not_accessible")).toBeInstanceOf(
        LangyGithubRepoNotAccessibleError,
      );
    });

    describe("given the frame carries a typed cause chain", () => {
      it("names a gateway no_provider_configured anywhere in the chain as model-not-configured, keeping the chain as reasons", () => {
        // The wire's herr envelope was already deserialized into a HandledError
        // at the boundary (the relay-frame schema): a `no_provider_configured`
        // from the gateway IS a `no_provider_configured` here.
        const cause = handledErrorFromHerr({
          type: "agent_error",
          message: "the agent hit an error before finishing",
          reasons: [
            {
              type: "no_provider_configured",
              message:
                "no model provider configured for this organization — add a provider API key in Settings → Model Providers",
              meta: { http_status: 400 },
              trace_id: "0af7651916cd43dd8448eb211c80319c",
            },
          ],
        });

        const error = LangyTurnErrors.fromErrorFrame({
          code: "agent_error",
          cause,
        });

        expect(error).toBeInstanceOf(LangyModelNotConfiguredError);
        const serialized = JSON.parse(LangyTurnErrors.serialize(error)) as Record<string, unknown>;
        expect(serialized.kind).toBe("langy_model_not_configured");
        // The chain persists losslessly: herr ⇄ HandledError, one model.
        expect(serialized.reasons).toEqual([
          {
            code: "no_provider_configured",
            // Deprecated back-compat alias of `code`.
            kind: "no_provider_configured",
            fault: "customer",
            retryable: false,
            traceId: "0af7651916cd43dd8448eb211c80319c",
            meta: {
              http_status: 400,
              message:
                "no model provider configured for this organization — add a provider API key in Settings → Model Providers",
            },
          },
        ]);
      });

      it("keeps an unrecognised agent_error chain on the agent-errored kind with the reasons attached", () => {
        const cause = handledErrorFromHerr({
          type: "agent_error",
          message: "the agent hit an error before finishing",
          reasons: [{ type: "rate_limited", message: "rate limited", meta: {} }],
        });

        const error = LangyTurnErrors.fromErrorFrame({
          code: "agent_error",
          cause,
        });

        expect(error).toBeInstanceOf(LangyAgentErroredError);
        const serialized = JSON.parse(LangyTurnErrors.serialize(error)) as Record<string, unknown>;
        expect(serialized.reasons).toEqual([
          {
            code: "rate_limited",
            kind: "rate_limited",
            fault: "customer",
            retryable: false,
            meta: { message: "rate limited" },
          },
        ]);
      });

      it("falls back to the bare-code mapping without a cause", () => {
        expect(LangyTurnErrors.fromErrorFrame({ code: "worker_stopped" })).toBeInstanceOf(
          LangyWorkerStoppedError,
        );
      });
    });

    it("maps agent_error onto its own agent-errored final state", () => {
      // The agent reported its own failure (e.g. the provider rejected its LLM
      // call). The worker did not stop — the copy must not claim it did.
      expect(LangyTurnErrors.fromFrame("agent_error")).toBeInstanceOf(LangyAgentErroredError);
    });
  });

  describe("given an arbitrary agent-side error string", () => {
    it("keeps it as an opaque Error so it is never pattern-matched into a kind", () => {
      const error = LangyTurnErrors.fromFrame(
        "worker spawn failed: /home/langy-7: permission denied",
      );

      expect(error).not.toBeInstanceOf(LangyAgentAtCapacityError);
      expect(error.message).toBe("worker spawn failed: /home/langy-7: permission denied");
      expect(LangyTurnErrors.classify(error).kind).toBe("unknown");
    });
  });
});

describe("LangyTurnErrors.classify", () => {
  describe("given the manager responded non-2xx", () => {
    it("classifies unavailable and exposes only the status", () => {
      const shape = LangyTurnErrors.classify(
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

      const shape = LangyTurnErrors.classify(failure);

      expect(shape.kind).toBe("langy_agent_unavailable");
      expect(shape.meta).toEqual({});
    });
  });

  describe("given the turn hit the request timeout", () => {
    it("classifies a turn timeout carrying the budget it blew", () => {
      const timeout = Object.assign(new Error("The operation was aborted"), {
        name: "TimeoutError",
      });

      const shape = LangyTurnErrors.classify(timeout);

      expect(shape.kind).toBe("langy_turn_timeout");
      expect(shape.httpStatus).toBe(504);
      expect(shape.meta).toEqual({ timeoutMs: AGENT_CHAT_TIMEOUT_MS });
    });
  });

  describe("given the worker drained mid-turn", () => {
    it("classifies a worker restart", () => {
      const shape = LangyTurnErrors.classify(new LangyWorkerRestartingError());

      expect(shape.kind).toBe("langy_worker_restarting");
    });
  });

  describe("given a genuinely unexpected exception", () => {
    it("falls back to unknown with no meta", () => {
      const shape = LangyTurnErrors.classify(
        new Error("Cannot read properties of undefined (reading 'foo')"),
      );

      expect(shape.kind).toBe("unknown");
      expect(shape.meta).toEqual({});
      expect(shape.httpStatus).toBe(500);
    });
  });
});

describe("LangyTurnErrors.serialize", () => {
  describe("given any classified failure", () => {
    it("never leaks the raw message onto the wire", () => {
      const serialized = LangyTurnErrors.serialize(
        new LangyAgentUnavailableError("manager responded 401", {
          status: 401,
        }),
      );

      expect(serialized).not.toContain("manager responded");
      expect(JSON.parse(serialized)).toMatchObject({
        kind: "langy_agent_unavailable",
        meta: { status: 401 },
      });
    });

    it("never leaks an unexpected exception's message or stack", () => {
      const boom = new Error("secret-internal-detail at /srv/app/foo.ts:12");

      const serialized = LangyTurnErrors.serialize(boom);

      expect(serialized).not.toContain("secret-internal-detail");
      expect(serialized).not.toContain("/srv/app");
      expect(JSON.parse(serialized)).toMatchObject({ kind: "unknown" });
    });
  });
});
