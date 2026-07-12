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
  return { kind: "unknown", httpStatus: 500, meta: {}, ...overrides };
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
      // The liveness sweep found a turn whose worker is gone.
      "langy_turn_stalled",
      // Raised from the TOOL STREAM (the agent reached for `gh` with no token),
      // never from the model's prose. It replaced the `[langy:connect-github]`
      // sentinel — see server/app-layer/langy/execution/githubCommand.ts.
      "langy_github_not_connected",
      // Turn-START rejections from the control plane (LangyTurnService), reaching
      // the browser as coded TRPCErrors from the create/continue mutations.
      "langy_model_not_configured",
      "langy_model_not_allowed",
      "langy_egress_misconfigured",
      "langy_insufficient_scope",
      "langy_turn_in_progress",
    ]);
  });

  it("has bespoke copy for every known kind — none falls through to the generic default", () => {
    const generic = explainLangyError(domain({ kind: "some_new_kind" }));

    for (const kind of KNOWN_LANGY_ERROR_KINDS) {
      const presentation = explainLangyError(domain({ kind }));
      expect(presentation.kind).toBe(kind);
      expect(presentation.title).not.toBe(generic.title);
      expect(presentation.description.length).toBeGreaterThan(0);
    }
  });
});

describe("explainLangyError", () => {
  describe("given a turn that failed because every Langy slot was taken", () => {
    it("says Langy is busy and offers a retry", () => {
      const presentation = explainLangyError(
        domain({ kind: "langy_agent_at_capacity", httpStatus: 429 }),
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
          kind: "langy_turn_timeout",
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
          kind: "langy_agent_unavailable",
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
        domain({ kind: "langy_worker_restarting", httpStatus: 503 }),
      );

      expect(presentation.title).toBe("Langy restarted");
      expect(presentation.description).toContain("send your message again");
      expect(presentation.action?.kind).toBe("retry");
    });
  });

  describe("given the agent's session vanished", () => {
    it("explains the conversation dropped and asks the user to resend", () => {
      const presentation = explainLangyError(
        domain({ kind: "langy_agent_session_lost", httpStatus: 410 }),
      );

      expect(presentation.title).toBe("Langy lost its place");
      expect(presentation.action?.kind).toBe("retry");
    });
  });

  describe("given the project has no model configured for Langy", () => {
    it("offers the configure-model action instead of a dead retry", () => {
      const presentation = explainLangyError(
        domain({ kind: "langy_model_not_configured", httpStatus: 409 }),
      );

      expect(presentation.title).toBe("Choose a model for Langy");
      expect(presentation.action?.kind).toBe("configure-model");
      expect(presentation.render).toBe("card");
    });
  });

  describe("given a turn is already streaming for the conversation", () => {
    it("tells the user to wait and offers no retry (a retry would 409 again)", () => {
      const presentation = explainLangyError(
        domain({ kind: "langy_turn_in_progress", httpStatus: 409 }),
      );

      expect(presentation.title).toBe("Langy is still replying");
      expect(presentation.action).toBeUndefined();
      expect(presentation.render).toBe("card");
    });
  });

  describe("given a genuinely unexpected failure", () => {
    it("keeps the calm generic copy and the trace id", () => {
      const presentation = explainLangyError(
        domain({ kind: "unknown", traceId: "abc123" }),
      );

      expect(presentation.title).toBe("Something went wrong");
      expect(presentation.traceId).toBe("abc123");
      expect(presentation.action?.kind).toBe("retry");
    });

    it("carries the Grafana trace link through to the presentation", () => {
      const presentation = explainLangyError(
        domain({
          kind: "unknown",
          traceId: "abc123",
          traceUrl: "http://127.0.0.1:3000/explore?panes=x",
        }),
      );

      expect(presentation.traceUrl).toBe(
        "http://127.0.0.1:3000/explore?panes=x",
      );
    });
  });
});

describe("readLangyStreamError", () => {
  describe("given the classified error the worker writes onto the stream", () => {
    it("parses kind, meta, status and trace id", () => {
      const parsed = readLangyStreamError(
        JSON.stringify({
          kind: "langy_agent_at_capacity",
          meta: {},
          telemetry: { traceId: "t-1", spanId: "s-1" },
          httpStatus: 429,
          reasons: [],
        }),
      );

      expect(parsed).toEqual({
        kind: "langy_agent_at_capacity",
        httpStatus: 429,
        meta: {},
        traceId: "t-1",
        reasons: undefined,
      });
    });
  });

  describe("given telemetry that carries a Grafana trace link", () => {
    it("parses the trace link off telemetry", () => {
      const parsed = readLangyStreamError(
        JSON.stringify({
          kind: "unknown",
          meta: {},
          telemetry: {
            traceId: "t-1",
            spanId: "s-1",
            traceUrl: "http://127.0.0.1:3000/explore",
          },
          httpStatus: 500,
          reasons: [],
        }),
      );

      expect(parsed?.traceUrl).toBe("http://127.0.0.1:3000/explore");
    });
  });

  describe("given a legacy plain-string error", () => {
    it("returns null so the caller can fall back", () => {
      expect(readLangyStreamError("manager responded 503")).toBeNull();
    });
  });
});
