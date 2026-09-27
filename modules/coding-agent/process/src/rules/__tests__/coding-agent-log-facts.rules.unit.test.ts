/**
 * The log→session lift, driven with canonical log records — the shape
 * log-processing actually stores (attributes flattened as JSON).
 *
 * @see specs/coding-agent/session-aggregate.feature
 * @see modules/coding-agent/specs/session-git-context.feature
 */

import type { ContributeLogFactsCommandData } from "@langwatch/coding-agent-contract";
import {
  SESSION_TITLE_FACT_KEY,
  SESSION_TITLE_FALLBACK_FACT_KEY,
} from "@langwatch/coding-agent-contract";
import type { CanonicalLogRecord } from "@langwatch/log-contract";
import { TraceCanonicalisationService } from "@langwatch/trace-process/testing";
import { describe, expect, it } from "vitest";

import { liftLogContribution } from "../coding-agent-log-facts.rules.ts";

const WIRE_TRACE = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
const traceCanonicalisation = TraceCanonicalisationService.create();

const BASE_LOG_RECORD: CanonicalLogRecord = {
  tenantId: "tenant-1",
  organizationId: "org-1",
  recordId: "rec-1",
  resourceSchemaUrl: "",
  resourceAttributesJson: "[]",
  resourceAttributesFlatJson: "{}",
  resourceAttributeKeys: [],
  resourceDroppedAttributesCount: 0,
  scopeSchemaUrl: "",
  scopeName: "",
  scopeVersion: "",
  scopeAttributesJson: "[]",
  scopeAttributeKeys: [],
  scopeDroppedAttributesCount: 0,
  wireTraceId: "",
  wireSpanId: "",
  correlationTraceId: "",
  correlationSpanId: "",
  correlationSource: "none",
  timeUnixNano: "1500000000",
  observedTimeUnixNano: "1500000000",
  timeUnixMs: 1_500,
  severityNumber: 9,
  severityText: "INFO",
  bodyType: "empty",
  bodyJson: "null",
  bodyText: null,
  attributesJson: "[]",
  attributesFlatJson: "{}",
  attributeKeys: [],
  droppedAttributesCount: 0,
  flags: 0,
  eventName: "",
  providerKind: "claude_code",
  providerEventKind: "",
  providerEventSequence: "",
  providerSessionId: "",
  providerConversationId: "",
  providerPromptId: "",
  piiRedactionLevel: "DISABLED",
  canonicalPayload: "",
  canonicalSizeBytes: 0,
  occurredAt: 1_500,
  acceptedAt: 1_500,
};

function canonicalLogRecord({
  attributes,
  scopeName = "com.anthropic.claude_code.events",
  eventName = "",
  correlationTraceId = "",
  correlationSource = "none",
  providerSessionId = "",
  recordId = "rec-1",
  resourceAttributes = { "service.version": "2.0.1" },
}: {
  attributes: Record<string, unknown>;
  scopeName?: string;
  eventName?: string;
  correlationTraceId?: string;
  correlationSource?: CanonicalLogRecord["correlationSource"];
  providerSessionId?: string;
  recordId?: string;
  resourceAttributes?: Record<string, unknown>;
}): CanonicalLogRecord {
  return {
    ...BASE_LOG_RECORD,
    recordId,
    scopeName,
    eventName,
    attributesFlatJson: JSON.stringify(attributes),
    resourceAttributesFlatJson: JSON.stringify(resourceAttributes),
    correlationTraceId,
    correlationSpanId: "",
    correlationSource,
    providerKind: "claude_code",
    providerSessionId,
    timeUnixMs: 1_500,
    severityNumber: 9,
    occurredAt: 1_500,
  };
}

function makeLift() {
  const dispatched: ContributeLogFactsCommandData[] = [];
  const lift = (record: CanonicalLogRecord): void => {
    const lifted = liftLogContribution({ record, traces: traceCanonicalisation });
    if (lifted.outcome === "contributes") dispatched.push(lifted.contribution);
  };
  return { lift, dispatched };
}

describe("liftLogContribution", () => {
  describe("when the same canonical log is lifted twice", () => {
    it("resolves to one durable contribution identity", () => {
      const { lift, dispatched } = makeLift();
      const event = canonicalLogRecord({
        attributes: {
          "event.name": "claude_code.tool_decision",
          "session.id": "sess-redelivery",
          decision: "reject",
        },
        recordId: "record-redelivery",
      });

      lift(event);
      lift(event);

      const durable = new Map(
        dispatched.map((contribution) => [
          `${contribution.tenantId}:${contribution.recordId}`,
          contribution,
        ]),
      );
      expect(dispatched).toHaveLength(2);
      expect(durable.size).toBe(1);
    });
  });

  describe("when a denied tool's decision log arrives", () => {
    /** @scenario a denied tool is part of the session story */
    it("contributes the lifted facts keyed by the provider session", () => {
      const { lift, dispatched } = makeLift();

      lift(
        canonicalLogRecord({
          attributes: {
            "event.name": "claude_code.tool_decision",
            "session.id": "sess-1",
            decision: "reject",
            tool_name: "Bash",
          },
        }),
      );

      expect(dispatched).toHaveLength(1);
      const [contribution] = dispatched;
      expect(contribution!.sessionId).toBe("sess-1");
      expect(contribution!.sessionKeySource).toBe("provider");
      expect(contribution!.agent).toBe("claude_code");
      expect(contribution!.facts.decision).toBe("reject");
      // The resource's service.version rides the same facts map so identity
      // can be established from any signal.
      expect(contribution!.facts["service.version"]).toBe("2.0.1");
      // No correlation on the record: the contribution carries no trace.
      expect(contribution!.traceId).toBeNull();
    });
  });

  describe("when a Cowork session's events arrive", () => {
    /** @scenario a Cowork session is an agent session */
    /** @scenario Cowork telemetry that shares Claude Code's event vocabulary is still Cowork */
    it("labels the contribution claude_cowork and lifts its correlation facts", () => {
      const { lift, dispatched } = makeLift();

      // Real Cowork wire shape: Claude Code's runtime scope and event
      // vocabulary, service.name `cowork`, logs-only (no spans, no wire
      // correlation), per-prompt correlation via prompt.id + event.sequence.
      lift(
        canonicalLogRecord({
          attributes: {
            "event.name": "claude_code.user_prompt",
            "session.id": "cw-sess-1",
            "prompt.id": "0f6f44f5-2f4c-4a5e-9d3b-7f8f2f9a1b2c",
            "event.sequence": 7,
            "organization.id": "b3d7a45e-1189-4e0f-8b7a-2c3d4e5f6a7b",
            "terminal.type": "non-interactive",
            prompt_length: 42,
          },
          resourceAttributes: {
            "service.name": "cowork",
            "service.version": "1.1.4173",
          },
        }),
      );

      expect(dispatched).toHaveLength(1);
      const [contribution] = dispatched;
      expect(contribution!.agent).toBe("claude_cowork");
      expect(contribution!.sessionId).toBe("cw-sess-1");
      expect(contribution!.sessionKeySource).toBe("provider");
      expect(contribution!.traceId).toBeNull();
      expect(contribution!.facts["prompt.id"]).toBe("0f6f44f5-2f4c-4a5e-9d3b-7f8f2f9a1b2c");
      expect(contribution!.facts["event.sequence"]).toBe(7);
      expect(contribution!.facts["organization.id"]).toBe("b3d7a45e-1189-4e0f-8b7a-2c3d4e5f6a7b");
      expect(contribution!.facts["terminal.type"]).toBe("non-interactive");
      expect(contribution!.facts["service.version"]).toBe("1.1.4173");
    });
  });

  describe("when the record carries a wire correlation", () => {
    it("passes the correlation trace id through", () => {
      const { lift, dispatched } = makeLift();

      lift(
        canonicalLogRecord({
          attributes: {
            "event.name": "claude_code.api_request",
            "session.id": "sess-1",
            cost_usd: 0.25,
          },
          correlationTraceId: WIRE_TRACE,
          correlationSource: "wire",
        }),
      );

      expect(dispatched[0]!.traceId).toBe(WIRE_TRACE);
    });
  });

  describe("when the record spells the session only in its provider column", () => {
    it("falls back to providerSessionId", () => {
      const { lift, dispatched } = makeLift();

      lift(
        canonicalLogRecord({
          attributes: { "event.name": "claude_code.user_prompt" },
          providerSessionId: "sess-from-column",
        }),
      );

      expect(dispatched[0]!.sessionId).toBe("sess-from-column");
      expect(dispatched[0]!.sessionKeySource).toBe("provider");
    });
  });

  describe("when a codex record arrives without its session id", () => {
    /** @scenario "a codex record outside any session does not mint a session" */
    it("declines the contribution instead of keying it on the trace", () => {
      const { lift, dispatched } = makeLift();

      // The live shape: codex's `log_only` scope reports an auth-refresh
      // api_request outside any conversation — no `conversation.id`, only
      // a trace. Keying it on the trace minted an all-zero session row.
      lift(
        canonicalLogRecord({
          scopeName: "codex_otel.log_only",
          attributes: {
            "event.name": "codex.api_request",
            attempt: "1",
            duration_ms: "742",
            success: "true",
          },
          correlationTraceId: WIRE_TRACE,
          correlationSource: "wire",
        }),
      );

      expect(dispatched).toHaveLength(0);
    });

    it("still contributes when the codex record carries its conversation id", () => {
      const { lift, dispatched } = makeLift();

      lift(
        canonicalLogRecord({
          scopeName: "codex_exec",
          attributes: {
            "event.name": "codex.user_prompt",
            "conversation.id": "01a00987-1926-7d31-a000-000000000001",
            prompt_length: 153,
          },
        }),
      );

      expect(dispatched).toHaveLength(1);
      expect(dispatched[0]!.sessionId).toBe("01a00987-1926-7d31-a000-000000000001");
      expect(dispatched[0]!.sessionKeySource).toBe("provider");
    });

    it("keeps the trace fallback for an agent that does not stamp every event", () => {
      const { lift, dispatched } = makeLift();

      lift(
        canonicalLogRecord({
          attributes: { "event.name": "claude_code.api_request", cost_usd: 1 },
          correlationTraceId: WIRE_TRACE,
          correlationSource: "wire",
        }),
      );

      expect(dispatched).toHaveLength(1);
      expect(dispatched[0]!.sessionId).toBe(WIRE_TRACE);
      expect(dispatched[0]!.sessionKeySource).toBe("trace_fallback");
    });
  });

  describe("when an ordinary application log passes by", () => {
    it("is ignored without dispatching", () => {
      const { lift, dispatched } = makeLift();

      lift(
        canonicalLogRecord({
          attributes: { "event.name": "http.request", "session.id": "s" },
          scopeName: "express",
        }),
      );

      expect(dispatched).toHaveLength(0);
    });
  });

  describe("when a LangWatch session context event arrives", () => {
    const HOOK_SCOPE = "langwatch.coding_agent.hook";
    const contextAttributes = (
      overrides: Record<string, unknown> = {},
    ): Record<string, unknown> => ({
      "event.name": "langwatch.session_context",
      "session.id": "sess-ctx-1",
      "coding_agent.name": "claude_code",
      "vcs.repository.host": "github.com",
      "vcs.repository.owner": "acme",
      "vcs.repository.name": "widgets",
      "vcs.ref.head.name": "feat/session-git-context",
      "vcs.worktree.name": "widgets-feat",
      ...overrides,
    });

    /** @scenario A session context contribution is labeled with its declared agent */
    it("labels the contribution with the agent the event declares", () => {
      const { lift, dispatched } = makeLift();

      lift(
        canonicalLogRecord({
          attributes: contextAttributes(),
          scopeName: HOOK_SCOPE,
          resourceAttributes: { "service.name": "langwatch-hook" },
        }),
      );

      expect(dispatched).toHaveLength(1);
      const [contribution] = dispatched;
      expect(contribution!.agent).toBe("claude_code");
      expect(contribution!.sessionId).toBe("sess-ctx-1");
      expect(contribution!.facts["vcs.repository.owner"]).toBe("acme");
      expect(contribution!.facts["vcs.ref.head.name"]).toBe("feat/session-git-context");
      expect(contribution!.facts["vcs.worktree.name"]).toBe("widgets-feat");
    });

    it.each(["codex", "opencode"])(
      "labels a %s declaration the same way, with no vendor scope of its own",
      (agent) => {
        const { lift, dispatched } = makeLift();

        lift(
          canonicalLogRecord({
            attributes: contextAttributes({ "coding_agent.name": agent }),
            scopeName: HOOK_SCOPE,
            resourceAttributes: { "service.name": "langwatch-hook" },
          }),
        );

        expect(dispatched).toHaveLength(1);
        expect(dispatched[0]!.agent).toBe(agent);
        expect(dispatched[0]!.facts["vcs.repository.owner"]).toBe("acme");
      },
    );

    /** @scenario A declared agent outside the registry contributes nothing */
    it("drops a declaration naming an agent LangWatch does not know", () => {
      const { lift, dispatched } = makeLift();

      lift(
        canonicalLogRecord({
          attributes: contextAttributes({
            "coding_agent.name": "totally_new_agent",
          }),
          scopeName: HOOK_SCOPE,
          resourceAttributes: { "service.name": "langwatch-hook" },
        }),
      );

      expect(dispatched).toHaveLength(0);
    });

    /** @scenario A session context event with no declared agent contributes nothing */
    it("drops an event that declares no agent at all", () => {
      const { lift, dispatched } = makeLift();

      lift(
        canonicalLogRecord({
          attributes: contextAttributes({ "coding_agent.name": undefined }),
          scopeName: HOOK_SCOPE,
          resourceAttributes: { "service.name": "langwatch-hook" },
        }),
      );

      expect(dispatched).toHaveLength(0);
    });
  });

  describe("when a title-generator response body arrives", () => {
    const titleBody = (title: string): string =>
      JSON.stringify({
        content: [{ type: "text", text: JSON.stringify({ title }) }],
      });

    const responseBodyEvent = ({ querySource, body }: { querySource: string; body: string }) =>
      canonicalLogRecord({
        attributes: {
          "event.name": "api_response_body",
          "session.id": "sess-title",
          query_source: querySource,
          body,
        },
      });

    /** @scenario The title lifts from a generate_session_title response body, capped */
    it("stamps the generated title as a fact, capped in length", () => {
      const { lift, dispatched } = makeLift();

      lift(
        responseBodyEvent({
          querySource: "generate_session_title",
          body: titleBody("Fix the flaky session fold test"),
        }),
      );

      expect(dispatched).toHaveLength(1);
      expect(dispatched[0]!.facts[SESSION_TITLE_FACT_KEY]).toBe("Fix the flaky session fold test");

      const { lift: capped, dispatched: cappedOut } = makeLift();
      capped(
        responseBodyEvent({
          querySource: "generate_session_title",
          body: titleBody("a".repeat(2_000)),
        }),
      );

      expect(String(cappedOut[0]!.facts[SESSION_TITLE_FACT_KEY])).toHaveLength(512);
    });

    /** @scenario A conversational response body sets no title */
    it("stamps nothing for a turn of the conversation itself", () => {
      const { lift, dispatched } = makeLift();

      lift(
        responseBodyEvent({
          querySource: "repl_main_thread",
          body: JSON.stringify({
            content: [{ type: "text", text: "Done, the test passes now." }],
          }),
        }),
      );

      expect(dispatched).toHaveLength(1);
      expect(dispatched[0]!.facts[SESSION_TITLE_FACT_KEY]).toBeUndefined();
    });

    /** @scenario An unparseable title body sets no title */
    it("stamps nothing and still contributes when the body does not parse", () => {
      const { lift, dispatched } = makeLift();

      lift(
        responseBodyEvent({
          querySource: "generate_session_title",
          body: '{"content":[{"type":"text","text":"{\\"title\\": \\"Fix the fl',
        }),
      );

      // The contribution proceeds: one odd body must not cost the record.
      expect(dispatched).toHaveLength(1);
      expect(dispatched[0]!.facts[SESSION_TITLE_FACT_KEY]).toBeUndefined();
      expect(dispatched[0]!.facts.query_source).toBe("generate_session_title");
    });
  });

  describe("when a prompt event carries the user's words", () => {
    const promptEvent = (prompt: string) =>
      canonicalLogRecord({
        attributes: {
          "event.name": "user_prompt",
          "session.id": "sess-prompt",
          prompt,
          prompt_length: String(prompt.length),
        },
      });

    /** @scenario A session with no generated title is named by the first thing the user asked */
    it("stamps a name candidate derived from the prompt", () => {
      const { lift, dispatched } = makeLift();

      lift(promptEvent("Fix the retry loop in the outbox worker\nIt spins."));

      expect(dispatched).toHaveLength(1);
      expect(dispatched[0]!.facts[SESSION_TITLE_FALLBACK_FACT_KEY]).toBe(
        "Fix the retry loop in the outbox worker",
      );
    });

    /** @scenario A machine-injected first prompt does not name the session */
    it("stamps nothing for a machine-injected turn", () => {
      const { lift, dispatched } = makeLift();

      lift(promptEvent("<task-notification>\n<task-id>abc</task-id>"));

      expect(dispatched).toHaveLength(1);
      expect(dispatched[0]!.facts[SESSION_TITLE_FALLBACK_FACT_KEY]).toBeUndefined();
    });

    /** @scenario A machine-injected first prompt does not name the session */
    it("stamps nothing for a withheld prompt", () => {
      const { lift, dispatched } = makeLift();

      lift(promptEvent("[REDACTED]"));

      expect(dispatched).toHaveLength(1);
      expect(dispatched[0]!.facts[SESSION_TITLE_FALLBACK_FACT_KEY]).toBeUndefined();
    });
  });

  describe("when a coding-agent record has no session key and no correlation", () => {
    it("skips it — there is nothing to aggregate under", () => {
      const { lift, dispatched } = makeLift();

      lift(
        canonicalLogRecord({
          attributes: { "event.name": "claude_code.internal_error" },
        }),
      );

      expect(dispatched).toHaveLength(0);
    });
  });
});
