import { describe, expect, it } from "vitest";
import {
  KNOWN_LANGY_ERROR_KINDS,
  explainLangyError,
  readLangyStreamError,
  type LangyDomainError,
} from "../logic/langyErrorExplainer";

/**
 * The kind list is the contract between the worker's turn classifier
 * (`server/app-layer/langy/execution/langy-turn-errors.ts`) and the copy the
 * browser renders. Pinning it here means adding a backend kind without copy —
 * or renaming one — fails loudly instead of silently landing in the generic
 * default.
 */

function domain(overrides: Partial<LangyDomainError>): LangyDomainError {
  return { code: "unknown", httpStatus: 500, meta: {}, ...overrides };
}

describe("KNOWN_LANGY_ERROR_KINDS", () => {
  it("pins the exact set of handled Langy error kinds", () => {
    expect([...KNOWN_LANGY_ERROR_KINDS]).toEqual([
      "langy_conversation_not_found",
      "langy_conversation_not_owned",
      "langy_agent_unavailable",
      "langy_agent_at_capacity",
      "langy_agent_session_lost",
      "langy_turn_timeout",
      "langy_worker_restarting",
      // The manager tried to start a worker and it never came up. This was
      // landing in `unknown` — a failure we can name exactly, shown to the user
      // as "Something went wrong" plus a trace id.
      "langy_worker_spawn_failed",
      // The worker stopped mid-reply and the control plane exhausted its recovery
      // — a FINAL state, not a client auto-retry.
      "langy_worker_stopped",
      // The agent itself reported the turn failed (its LLM call was rejected)
      // — the worker is fine, the reply failed. Terminal with a manual retry.
      "langy_agent_errored",
      // Raised from the TOOL STREAM (the agent reached for `gh` with no token),
      // never from the model's prose. Produced by the manager's GitHub gate
      // (services/langyagent/app/githubgate.go); the command grammar lives in
      // server/app-layer/langy/execution/githubCommand.ts.
      "langy_github_not_connected",
      // Same gate, credentialed variant: the app installation doesn't cover the
      // repository the agent reached for (the clone/push 404'd).
      "langy_github_repo_not_accessible",
      // Turn-START rejections from the control plane (LangyTurnService), reaching
      // the browser as coded TRPCErrors from the create/continue mutations.
      "langy_model_not_configured",
      "langy_model_not_allowed",
      "langy_egress_misconfigured",
      "langy_insufficient_scope",
      "langy_turn_in_progress",
      // Codex (sign-in-with-OpenAI): dead OAuth session / ChatGPT plan limit,
      // promoted off the agent-errored reason chain by exact reason code.
      "langy_codex_session_expired",
      "langy_codex_plan_limit",
    ]);
  });

  it("has bespoke copy for every known kind — none falls through to the generic default", () => {
    const generic = explainLangyError(domain({ code: "some_new_kind" }));

    for (const kind of KNOWN_LANGY_ERROR_KINDS) {
      const presentation = explainLangyError(domain({ code: kind }));
      expect(presentation.kind).toBe(kind);
      expect(presentation.title).not.toBe(generic.title);
      expect(presentation.description.length).toBeGreaterThan(0);
    }
  });
});

describe("explainLangyError", () => {
  describe("given an agent failure whose reason chain carries a dead codex session", () => {
    it("promotes to the session-expired card with the sign-in action", () => {
      const presentation = explainLangyError(
        domain({
          code: "langy_agent_errored",
          reasons: [
            {
              kind: "provider_error",
              reasons: [{ kind: "codex_session_expired" }],
            },
          ],
        }),
      );
      expect(presentation.kind).toBe("langy_codex_session_expired");
      expect(presentation.title).toBe("Your OpenAI session expired");
      expect(presentation.action).toEqual({
        label: "Sign in to Codex",
        kind: "reconnect-codex",
      });
    });
  });

  describe("given an agent failure whose reason chain carries the plan limit", () => {
    it("promotes to the plan-limit card suggesting another model", () => {
      const presentation = explainLangyError(
        domain({
          code: "langy_agent_errored",
          reasons: [{ kind: "usage_limit_reached" }],
        }),
      );
      expect(presentation.kind).toBe("langy_codex_plan_limit");
      expect(presentation.description).toContain("another model");
      expect(presentation.action).toEqual({
        label: "Try again",
        kind: "retry",
      });
    });
  });

  describe("given an agent failure with unrelated reasons", () => {
    it("keeps the generic reply-failed card", () => {
      const presentation = explainLangyError(
        domain({
          code: "langy_agent_errored",
          reasons: [{ kind: "rate_limited" }],
        }),
      );
      expect(presentation.kind).toBe("langy_agent_errored");
    });
  });

  describe("given the turn stopped because GitHub is not connected", () => {
    it("suppresses the red card and offers the connect-github action", () => {
      // The panel keys on exactly this shape (render suppress + connect-github)
      // to draw the install card in the message flow and re-drive the turn once
      // the app is installed — see LangyPanel's needsGithubConnect.
      const presentation = explainLangyError(
        domain({ code: "langy_github_not_connected", httpStatus: 409 }),
      );

      expect(presentation.render).toBe("suppress");
      expect(presentation.action?.kind).toBe("connect-github");
    });
  });

  describe("given the app installation does not cover the repository", () => {
    it("renders a card pointing at granting the app access, with no retry", () => {
      // Deterministic 404 — retrying is useless until a human grants access, so
      // there is deliberately NO action; the description says where to fix it.
      const presentation = explainLangyError(
        domain({ code: "langy_github_repo_not_accessible", httpStatus: 409 }),
      );

      expect(presentation.render).toBe("card");
      expect(presentation.action).toBeUndefined();
      expect(presentation.description).toContain("Integrations");
    });
  });

  describe("given a turn that failed because every Langy slot was taken", () => {
    it("says Langy is busy and offers a retry", () => {
      const presentation = explainLangyError(
        domain({ code: "langy_agent_at_capacity", httpStatus: 429 }),
      );

      expect(presentation.title).toBe("Langy is busy right now");
      expect(presentation.description).toContain("try again");
      expect(presentation.render).toBe("card");
      expect(presentation.action).toEqual({
        label: "Try again",
        kind: "retry",
      });
    });
  });

  describe("given a turn that ran out of time", () => {
    it("says it took too long and surfaces the timeout budget as meta", () => {
      const presentation = explainLangyError(
        domain({
          code: "langy_turn_timeout",
          httpStatus: 504,
          meta: { timeoutMs: 120_000 },
        }),
      );

      expect(presentation.title).toBe("That took too long");
      expect(presentation.action?.kind).toBe("retry");
      expect(presentation.meta).toEqual({ timeoutMs: 120_000 });
    });
  });

  describe("given the agent could not be reached", () => {
    it("says Langy is unavailable and carries the status through as meta", () => {
      const presentation = explainLangyError(
        domain({
          code: "langy_agent_unavailable",
          httpStatus: 503,
          meta: { status: 503 },
        }),
      );

      expect(presentation.title).toBe("Langy is unavailable");
      expect(presentation.description).toContain("safe");
      expect(presentation.meta).toEqual({ status: 503 });
      expect(presentation.action?.kind).toBe("retry");
    });
  });

  describe("given the worker restarted mid-turn", () => {
    it("says Langy restarted and asks the user to send it again", () => {
      const presentation = explainLangyError(
        domain({ code: "langy_worker_restarting", httpStatus: 503 }),
      );

      expect(presentation.title).toBe("Langy restarted");
      expect(presentation.description).toContain("send your message again");
      expect(presentation.action?.kind).toBe("retry");
    });
  });

  describe("given the worker stopped mid-reply", () => {
    it("names the worker stopping specifically and offers a manual retry", () => {
      const presentation = explainLangyError(
        domain({ code: "langy_worker_stopped", httpStatus: 503 }),
      );

      expect(presentation.title).toBe("Langy's worker stopped");
      expect(presentation.description).toContain("safe");
      expect(presentation.render).toBe("card");
      expect(presentation.action).toEqual({ label: "Try again", kind: "retry" });
    });
  });

  describe("given the agent's session vanished", () => {
    it("explains the conversation dropped and asks the user to resend", () => {
      const presentation = explainLangyError(
        domain({ code: "langy_agent_session_lost", httpStatus: 410 }),
      );

      expect(presentation.title).toBe("Langy lost its place");
      expect(presentation.action?.kind).toBe("retry");
    });
  });

  describe("given the project has no model configured for Langy", () => {
    it("offers the configure-model action instead of a dead retry", () => {
      const presentation = explainLangyError(
        domain({ code: "langy_model_not_configured", httpStatus: 409 }),
      );

      expect(presentation.title).toBe("Choose a model for Langy");
      expect(presentation.action?.kind).toBe("configure-model");
      expect(presentation.render).toBe("card");
    });
  });

  describe("given a turn is already streaming for the conversation", () => {
    it("tells the user to wait, offers no retry, and rides above the composer", () => {
      const presentation = explainLangyError(
        domain({ code: "langy_turn_in_progress", httpStatus: 409 }),
      );

      expect(presentation.title).toBe("Langy is still replying");
      expect(presentation.action).toBeUndefined();
      // A wait, not a turn failure: a dismissable notice attached above the
      // composer that keeps the user's draft — not a red history card (ADR-058).
      expect(presentation.render).toBe("composer-notice");
    });
  });

  describe("given a genuinely unexpected failure", () => {
    it("keeps the calm generic copy and the trace id", () => {
      const presentation = explainLangyError(
        domain({ code: "unknown", traceId: "abc123" }),
      );

      expect(presentation.title).toBe("Something went wrong");
      expect(presentation.traceId).toBe("abc123");
      expect(presentation.action?.kind).toBe("retry");
    });
  });
});

describe("readLangyStreamError", () => {
  describe("given the classified error the worker writes onto the stream", () => {
    it("parses kind, meta, status and trace id", () => {
      const parsed = readLangyStreamError(
        JSON.stringify({
          code: "langy_agent_at_capacity",
          meta: {},
          traceId: "t-1",
          spanId: "s-1",
          httpStatus: 429,
          reasons: [],
        }),
      );

      expect(parsed).toEqual({
        code: "langy_agent_at_capacity",
        httpStatus: 429,
        meta: {},
        traceId: "t-1",
        reasons: undefined,
      });
    });
  });

  describe("given a legacy plain-string error", () => {
    it("returns null so the caller can fall back", () => {
      expect(readLangyStreamError("manager responded 503")).toBeNull();
    });
  });
});
