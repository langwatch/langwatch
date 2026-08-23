import { describe, expect, it } from "vitest";
import {
  explainLangyError,
  isStaleLangyHistoryRead,
  KNOWN_LANGY_ERROR_KINDS,
  type LangyDomainError,
  readLangyStreamError,
  resolveLiveTurnError,
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
      // Sending faster than the per-user limit allows: without an entry here it
      // fell into the generic default, which tells a throttled user Langy is
      // broken and offers a retry into the same limit.
      "langy_rate_limited",
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
    describe("when the failure is explained", () => {
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
  });

  describe("given an agent failure whose reason chain carries the plan limit", () => {
    describe("when the failure is explained", () => {
      it("promotes to the plan-limit card suggesting another model", () => {
        const presentation = explainLangyError(
          domain({
            code: "langy_agent_errored",
            reasons: [{ kind: "usage_limit_reached" }],
          }),
        );
        expect(presentation.kind).toBe("langy_codex_plan_limit");
        // The registry's words, not a second authoring at the call site.
        expect(presentation.title).toBe(
          "You've reached your OpenAI plan's limit",
        );
        expect(presentation.action).toEqual({
          label: "Try again",
          kind: "retry",
        });
      });
    });
  });

  describe("given an agent failure the model provider rate-limited", () => {
    describe("when the failure is explained", () => {
      /** @scenario A rate-limited model reads as the provider being busy */
      it("says the provider is rate-limiting and to wait, not that Langy broke", () => {
        const presentation = explainLangyError(
          domain({
            code: "langy_agent_errored",
            reasons: [
              {
                kind: "provider_error",
                reasons: [{ kind: "upstream_rate_limited" }],
              },
            ],
          }),
        );

        expect(presentation.kind).toBe("llm_upstream_error");
        expect(presentation.description).toBe(
          "The model provider is rate-limiting these calls. Wait a moment and try again.",
        );
        expect(presentation.action).toEqual({
          label: "Try again",
          kind: "retry",
        });
      });

      /** @scenario A provider outage reads as the provider being down */
      it("names an outage as the provider's, and offers another model", () => {
        const presentation = explainLangyError(
          domain({
            code: "langy_agent_errored",
            reasons: [{ kind: "upstream_unavailable" }],
          }),
        );

        expect(presentation.kind).toBe("llm_upstream_error");
        expect(presentation.description).toBe(
          "The model provider is temporarily unavailable. Try again shortly, or pick a different model.",
        );
      });

      /** @scenario A dead codex session still wins over the upstream status */
      it("leaves the more specific codex card alone", () => {
        const presentation = explainLangyError(
          domain({
            code: "langy_agent_errored",
            reasons: [
              { kind: "upstream_unauthorized" },
              { kind: "codex_session_expired" },
            ],
          }),
        );

        expect(presentation.kind).toBe("langy_codex_session_expired");
      });
    });
  });

  describe("given an agent failure with unrelated reasons", () => {
    describe("when the failure is explained", () => {
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
  });

  describe("given a model outside the project's Langy allowlist", () => {
    describe("when the refusal is explained", () => {
      it("keeps the allowlist refusal on the settings action", () => {
        const presentation = explainLangyError(
          domain({
            code: "langy_model_not_allowed",
            meta: { model: "evil/model" },
          }),
        );

        expect(presentation.title).toBe("That model isn't available here");
        expect(presentation.action).toEqual({
          label: "Configure model",
          kind: "configure-model",
        });
      });
    });
  });

  describe("given an agent failure whose reason chain carries the provider's message", () => {
    describe("when the failure is explained", () => {
      /** @scenario A rejected model call never recites the provider's own message */
      it("keeps the provider's sentence off the card", () => {
        // This test asserted the OPPOSITE until the leak was found, on the
        // reasoning that a provider's error body is written for its caller and
        // is therefore safe to show. It is written for whoever holds the KEY,
        // and on a LangWatch-managed provider that is us: OpenAI answers a bad
        // key with `Incorrect API key provided: sk-proj-…`, so the card was one
        // 401 away from printing a platform credential. Masking it afterwards
        // only covers the credential shapes someone enumerated.
        //
        // The message here is the benign out-of-credits one, deliberately: the
        // rule is that NO upstream prose reaches the card, not that we filter
        // the dangerous-looking ones. A test using a key-shaped fixture would
        // still pass against a scrubber.
        const providerMessage =
          "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.";
        const presentation = explainLangyError(
          domain({
            code: "langy_agent_errored",
            reasons: [
              {
                kind: "llm_upstream_error",
                meta: { message: providerMessage, http_status: 400 },
              },
            ],
          }),
        );

        expect(presentation.kind).toBe("langy_agent_errored");
        expect(presentation.title).toBe("Langy's reply failed");
        expect(presentation.description).not.toContain("credit balance");
        expect(presentation.description).toBe(
          "Langy hit an error while writing this reply. Your message is safe — try again.",
        );
        expect(presentation.action).toEqual({
          label: "Try again",
          kind: "retry",
        });
      });

      it("keeps a NESTED reason's message off the card too", () => {
        const presentation = explainLangyError(
          domain({
            code: "langy_agent_errored",
            reasons: [
              {
                kind: "provider_error",
                reasons: [
                  {
                    kind: "llm_upstream_error",
                    meta: { message: "model overloaded" },
                  },
                ],
              },
            ],
          }),
        );
        expect(presentation.description).not.toContain("model overloaded");
      });
    });
  });

  describe("given an agent failure whose reason chain names an out-of-allowance provider", () => {
    describe("when the failure is explained", () => {
      /** @scenario An out-of-allowance model call is promoted by reason code, not by message */
      it.each([
        "insufficient_quota",
        "billing_hard_limit_reached",
      ])("promotes %s to the plan-limit card", (reasonCode) => {
        // The meaning the old relay carried — "you have nothing left to
        // spend" — survives as a discriminant rather than as the provider's
        // sentence. `usage_limit_reached` and `codex_plan_limit` were already
        // promoted; these two are the same situation reached through OpenAI's
        // own API codes, and they were only ever explained by the prose.
        //
        // `meta.message` is populated and must still not appear: the copy is
        // selected by the code and written in the registry.
        const presentation = explainLangyError(
          domain({
            code: "langy_agent_errored",
            reasons: [
              {
                kind: "llm_upstream_error",
                reasons: [{ kind: reasonCode }],
                meta: { message: "You exceeded your current quota." },
              },
            ],
          }),
        );

        expect(presentation.kind).toBe("langy_codex_plan_limit");
        expect(presentation.title).toBe(
          "You've reached your OpenAI plan's limit",
        );
        expect(presentation.description).not.toContain("current quota");
      });
    });
  });

  describe("given an agent failure with no captured cause", () => {
    describe("when the failure is explained", () => {
      it("keeps the stock reply-failed copy", () => {
        const presentation = explainLangyError(
          domain({ code: "langy_agent_errored" }),
        );
        expect(presentation.description).toBe(
          "Langy hit an error while writing this reply. Your message is safe — try again.",
        );
      });
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
    it("names the stop specifically and offers a manual retry", () => {
      const presentation = explainLangyError(
        domain({ code: "langy_worker_stopped", httpStatus: 503 }),
      );

      expect(presentation.title).toBe("Langy stopped mid-reply");
      expect(presentation.description).toContain("safe");
      expect(presentation.render).toBe("card");
      expect(presentation.action).toEqual({
        label: "Try again",
        kind: "retry",
      });
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
      // composer that keeps the user's draft — not a red history card (ADR-078).
      expect(presentation.render).toBe("composer-notice");
    });
  });

  describe("given the sender tripped the per-user message limit", () => {
    describe("when the refusal is explained", () => {
      it("asks for patience without a retry, and never claims Langy is broken", () => {
        const generic = explainLangyError(domain({ code: "some_new_kind" }));
        const presentation = explainLangyError(
          domain({
            code: "langy_rate_limited",
            httpStatus: 429,
            // The server puts its sentence here because `serialize()` drops the
            // HandledError message; before this kind had copy, that sentence
            // was the ONLY correct thing on an otherwise wrong card.
            meta: { message: "Too many messages. Please slow down." },
          }),
        );

        // The copy has to name THROTTLING, not just differ from the generic
        // card: "Something went wrong" is exactly the wrong story for a
        // message that was refused because it arrived too fast.
        expect(presentation.title).toBe("You're sending messages too quickly");
        expect(presentation.description).toContain("in a few seconds");
        // ...and it has to say the draft survived, because it does — the notice
        // rides above the composer with the message still in the box.
        expect(presentation.description).toContain("still in the box");
        expect(presentation.title).not.toBe(generic.title);
        // A retry is the one action that makes throttling worse — it spends
        // another request against the limit that just refused this one.
        expect(presentation.action).toBeUndefined();
        // A wait, not a turn failure: it rides above the composer and keeps the
        // user's draft, rather than a red card in the transcript.
        expect(presentation.render).toBe("composer-notice");
      });
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
      expect(presentation.description).toContain("share the id below");
    });

    it("never prints `unknown` as if it were a domain code", () => {
      // The card renders `code` ungated, so setting it here put the literal
      // word "unknown" under the message — a mono line that names nothing,
      // offered to the reader as the thing to quote to support.
      const presentation = explainLangyError(domain({ code: "unknown" }));

      expect(presentation.code).toBeUndefined();
    });

    describe("when the failure carries no trace id", () => {
      it("stops at 'Try again' instead of promising details it has none of", () => {
        // An untyped browser failure (`Error("Failed to fetch")`) resolves to
        // `unknown` with no trace id, so there is nothing below the message at
        // all — and the card was still telling the reader to share it.
        const presentation = explainLangyError(domain({ code: "unknown" }));

        expect(presentation.description).not.toContain("below");
        expect(presentation.description).toContain("Try again.");
      });
    });
  });
});

describe("isStaleLangyHistoryRead", () => {
  /**
   * The panel demotes a failed history read to a one-line footnote whenever
   * there is content on screen, so a 3s poll blip mid-turn cannot wipe an
   * answer that is still streaming. That rule asked only whether anything was
   * visible, never which failure had arrived.
   */
  const readFailedWith = (code: string) =>
    explainLangyError(domain({ code, httpStatus: 404 }));

  describe("given the transcript is still on screen", () => {
    describe("when the failure is one the next poll might clear", () => {
      it("demotes it to the quiet line", () => {
        expect(
          isStaleLangyHistoryRead({
            presentation: readFailedWith("clickhouse_unavailable"),
            hasContentOnScreen: true,
          }),
        ).toBe(true);
      });
    });

    describe("when the conversation is gone", () => {
      it("refuses to demote it", () => {
        // Deleted from another tab: every poll from here on answers the same
        // thing, and the engine still holds the messages. Demoted, the reader
        // goes on reading a conversation that no longer exists, with no retry
        // and no next step, forever.
        expect(
          isStaleLangyHistoryRead({
            presentation: readFailedWith("langy_conversation_not_found"),
            hasContentOnScreen: true,
          }),
        ).toBe(false);
      });
    });

    describe("when the conversation is someone else's", () => {
      it("refuses to demote it", () => {
        expect(
          isStaleLangyHistoryRead({
            presentation: readFailedWith("langy_conversation_not_owned"),
            hasContentOnScreen: true,
          }),
        ).toBe(false);
      });
    });
  });

  describe("given nothing is on screen to protect", () => {
    describe("when even a transient failure arrives", () => {
      it("lets it own the column", () => {
        expect(
          isStaleLangyHistoryRead({
            presentation: readFailedWith("clickhouse_unavailable"),
            hasContentOnScreen: false,
          }),
        ).toBe(false);
      });
    });
  });

  describe("given the read succeeded", () => {
    describe("when there is no failure to explain at all", () => {
      it("has nothing to say", () => {
        expect(
          isStaleLangyHistoryRead({
            presentation: null,
            hasContentOnScreen: true,
          }),
        ).toBe(false);
      });
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

describe("resolveLiveTurnError", () => {
  const typedStreamError = JSON.stringify({
    code: "langy_agent_errored",
    httpStatus: 502,
    meta: {},
    reasons: [
      {
        kind: "llm_upstream_error",
        meta: { http_status: 429, message: "The usage limit has been reached" },
        reasons: [{ kind: "usage_limit_reached" }],
      },
    ],
  });

  describe("given the failure rode the stream's terminal entry", () => {
    describe("when the live message carries the typed payload", () => {
      it("resolves the typed domain error from it", () => {
        const domain = resolveLiveTurnError({
          error: new Error(typedStreamError),
          durableLastError: null,
        });

        expect(domain.code).toBe("langy_agent_errored");
      });
    });
  });

  describe("given the live stream died with no typed payload", () => {
    describe("when the turn's failure is already on the durable record", () => {
      /** @scenario "A genuinely dead stream still names the durable failure" */
      it("reads the durable record instead of settling for unknown", () => {
        const domain = resolveLiveTurnError({
          error: new Error("SSE Error"),
          durableLastError: typedStreamError,
        });

        expect(domain.code).toBe("langy_agent_errored");
        expect(explainLangyError(domain).kind).toBe("langy_codex_plan_limit");
      });
    });

    describe("when the durable record is empty too", () => {
      it("falls back to unknown", () => {
        const domain = resolveLiveTurnError({
          error: new Error("SSE Error"),
          durableLastError: null,
        });

        expect(domain.code).toBe("unknown");
        // `meta` is the contract for what the card renders, not a scratchpad:
        // the raw transport message is logged by the caller instead.
        expect(domain.meta).toEqual({});
      });
    });
  });
});
