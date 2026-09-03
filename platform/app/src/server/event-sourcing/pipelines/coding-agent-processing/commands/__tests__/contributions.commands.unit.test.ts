/**
 * @vitest-environment node
 *
 * Unit tests for the three contribution commands (ADR-056 §2).
 *
 * Covers schema parsing, the session-keyed aggregate id, and the
 * idempotency keys that keep re-delivered telemetry from inflating a
 * session.
 *
 * @see specs/coding-agent/session-aggregate.feature
 */

import { describe, expect, it } from "vitest";
import type { TenantId } from "../../../../domain/tenantId";
import {
  contributeLogFactsCommandDataSchema,
  contributeMetricFactsCommandDataSchema,
  contributeSpanFactsCommandDataSchema,
} from "../../schemas/commands";
import {
  CONTRIBUTE_LOG_FACTS_COMMAND_TYPE,
  CONTRIBUTE_METRIC_FACTS_COMMAND_TYPE,
  CONTRIBUTE_SPAN_FACTS_COMMAND_TYPE,
  LOG_FACTS_CONTRIBUTED_EVENT_TYPE,
  METRIC_FACTS_CONTRIBUTED_EVENT_TYPE,
  SPAN_FACTS_CONTRIBUTED_EVENT_TYPE,
} from "../../schemas/constants";
import {
  InMemorySessionContextMemo,
  type SessionContextMemo,
} from "../../services/session-context-memo";
import { ContributeLogFactsCommand } from "../contributeLogFactsCommand";
import { ContributeMetricFactsCommand } from "../contributeMetricFactsCommand";
import { ContributeSpanFactsCommand } from "../contributeSpanFactsCommand";

const TENANT = "tenant-1";
const SESSION = "8f2c9a1e-session";

function spanFactsData(overrides?: Record<string, unknown>) {
  return contributeSpanFactsCommandDataSchema.parse({
    tenantId: TENANT,
    sessionId: SESSION,
    sessionKeySource: "provider",
    agent: "claude_code",
    occurredAt: 1_760_000_000_000,
    traceId: "trace-1",
    spanId: "span-1",
    name: "claude_code.tool",
    startTimeUnixMs: 1_760_000_000_000,
    endTimeUnixMs: 1_760_000_000_500,
    statusCode: 2,
    facts: { tool_name: "Bash", duration_ms: 500 },
    scopeName: "com.anthropic.claude_code",
    ...overrides,
  });
}

function logFactsData(overrides?: Record<string, unknown>) {
  return contributeLogFactsCommandDataSchema.parse({
    tenantId: TENANT,
    sessionId: SESSION,
    sessionKeySource: "provider",
    agent: "claude_code",
    occurredAt: 1_760_000_000_000,
    recordId: "rec-abc",
    traceId: null,
    spanId: null,
    timeUnixMs: 1_760_000_000_000,
    severityNumber: 9,
    providerKind: "claude_code",
    scopeName: "com.anthropic.claude_code.events",
    facts: { "event.name": "claude_code.tool_decision", decision: "reject" },
    ...overrides,
  });
}

function metricFactsData(overrides?: Record<string, unknown>) {
  return contributeMetricFactsCommandDataSchema.parse({
    tenantId: TENANT,
    sessionId: SESSION,
    sessionKeySource: "provider",
    agent: "claude_code",
    occurredAt: 1_760_000_000_000,
    seriesId: "series-1",
    metricName: "claude_code.cost.usage",
    unit: "USD",
    attributes: { model: "claude-fable-5" },
    value: 1.25,
    dataPointCount: 4,
    asOfUnixMs: 1_760_000_000_000,
    ...overrides,
  });
}

function makeCommand<T>(type: string, data: T) {
  return {
    tenantId: TENANT as TenantId,
    aggregateId: SESSION,
    type: type as never,
    data,
  };
}

describe("ContributeSpanFactsCommand", () => {
  describe("when a coding-agent span's facts are contributed", () => {
    it("emits one session-keyed span_facts_contributed event", async () => {
      const handler = new ContributeSpanFactsCommand();
      const events = await handler.handle(
        makeCommand(CONTRIBUTE_SPAN_FACTS_COMMAND_TYPE, spanFactsData()),
      );

      expect(events).toHaveLength(1);
      const [event] = events;
      expect(event!.type).toBe(SPAN_FACTS_CONTRIBUTED_EVENT_TYPE);
      expect(event!.aggregateType).toBe("coding_agent_session");
      expect(event!.aggregateId).toBe(SESSION);
      expect(event!.data.statusCode).toBe(2);
      expect(event!.data.facts.tool_name).toBe("Bash");
    });
  });

  describe("when the same span is delivered twice", () => {
    /** @scenario re-delivered telemetry does not inflate a session */
    it("collapses both deliveries to one idempotency key", async () => {
      const handler = new ContributeSpanFactsCommand();
      const [a] = await handler.handle(
        makeCommand(CONTRIBUTE_SPAN_FACTS_COMMAND_TYPE, spanFactsData()),
      );
      const [b] = await handler.handle(
        makeCommand(
          CONTRIBUTE_SPAN_FACTS_COMMAND_TYPE,
          spanFactsData({ occurredAt: 1_760_000_009_000 }),
        ),
      );
      expect(a!.idempotencyKey).toBe(b!.idempotencyKey);
      expect(a!.idempotencyKey).toBe(`${TENANT}:trace-1:span-1`);
    });
  });

  describe("when the payload spells status as a string", () => {
    // PR #5708's silent bug: OTLP statusCode is a numeric enum; a string
    // "error" can never match it. The schema refuses the shape outright.
    it("rejects it", () => {
      const result = contributeSpanFactsCommandDataSchema.safeParse({
        ...spanFactsData(),
        statusCode: "error",
      });
      expect(result.success).toBe(false);
    });
  });

  it("routes the command by session, not by trace", () => {
    expect(ContributeSpanFactsCommand.getAggregateId(spanFactsData())).toBe(
      SESSION,
    );
  });

  describe("given a nested interactive session launched from inside another", () => {
    describe("when both sessions' spans arrive on the same trace", () => {
      /** @scenario an interactive child session stands alone */
      it("routes each to its own aggregate, so the child's work never joins the parent's totals", async () => {
        const handler = new ContributeSpanFactsCommand();
        const CHILD = "b7d1f0aa-child-session";

        const [parent] = await handler.handle(
          makeCommand(CONTRIBUTE_SPAN_FACTS_COMMAND_TYPE, spanFactsData()),
        );
        // Same trace, same tool span shape — only the session id differs, which
        // is the whole of what makes the child a session in its own right.
        const [child] = await handler.handle(
          makeCommand(
            CONTRIBUTE_SPAN_FACTS_COMMAND_TYPE,
            spanFactsData({ sessionId: CHILD, spanId: "span-2" }),
          ),
        );

        expect(parent!.aggregateId).toBe(SESSION);
        expect(child!.aggregateId).toBe(CHILD);
        expect(child!.idempotencyKey).not.toBe(parent!.idempotencyKey);
      });
    });
  });
});

function logFactsHandler(memo?: SessionContextMemo) {
  return new ContributeLogFactsCommand({
    contextMemo: memo ?? new InMemorySessionContextMemo(),
  });
}

/** A `session_context` declaration's contribution, as the dispatcher sends it. */
function declarationData(overrides?: Record<string, string>) {
  return logFactsData({
    recordId: "rec-context",
    facts: {
      "event.name": "langwatch.session_context",
      "vcs.repository.host": "github.com",
      "vcs.repository.owner": "acme",
      "vcs.repository.name": "widgets",
      "vcs.ref.head.name": "main",
      "vcs.worktree.name": "widgets",
      ...overrides,
    },
  });
}

/** An `api_request` contribution: the row-bearing kind the stamp exists for. */
function modelCallData(overrides?: Record<string, unknown>) {
  return logFactsData({
    recordId: "rec-call",
    facts: {
      "event.name": "claude_code.api_request",
      model: "claude-fable-5",
      input_tokens: 100,
      output_tokens: 50,
    },
    ...overrides,
  });
}

describe("ContributeLogFactsCommand", () => {
  describe("when a log with no correlation contributes", () => {
    /** @scenario a denied tool is part of the session story */
    it("carries the facts with a null trace id", async () => {
      const handler = logFactsHandler();
      const events = await handler.handle(
        makeCommand(CONTRIBUTE_LOG_FACTS_COMMAND_TYPE, logFactsData()),
      );

      expect(events).toHaveLength(1);
      const [event] = events;
      expect(event!.type).toBe(LOG_FACTS_CONTRIBUTED_EVENT_TYPE);
      expect(event!.aggregateId).toBe(SESSION);
      expect(event!.data.traceId).toBeNull();
      expect(event!.data.facts.decision).toBe("reject");
    });
  });

  describe("when the same record is delivered twice", () => {
    it("collapses on the tenant-scoped record id", async () => {
      const handler = logFactsHandler();
      const [a] = await handler.handle(
        makeCommand(CONTRIBUTE_LOG_FACTS_COMMAND_TYPE, logFactsData()),
      );
      const [b] = await handler.handle(
        makeCommand(
          CONTRIBUTE_LOG_FACTS_COMMAND_TYPE,
          logFactsData({ occurredAt: 1_760_000_009_000 }),
        ),
      );
      expect(a!.idempotencyKey).toBe(b!.idempotencyKey);
      expect(a!.idempotencyKey).toBe(`${TENANT}:rec-abc`);
    });
  });

  describe("when the session declared its working context", () => {
    /** @scenario A model call after a declaration carries the declared context */
    it("stamps a later model call with the declared repository and branch", async () => {
      const handler = logFactsHandler();
      await handler.handle(
        makeCommand(CONTRIBUTE_LOG_FACTS_COMMAND_TYPE, declarationData()),
      );
      const [event] = await handler.handle(
        makeCommand(CONTRIBUTE_LOG_FACTS_COMMAND_TYPE, modelCallData()),
      );

      expect(event!.data.repositoryHost).toBe("github.com");
      expect(event!.data.repositoryOwner).toBe("acme");
      expect(event!.data.repositoryName).toBe("widgets");
      expect(event!.data.branch).toBe("main");
    });

    /** @scenario A new declaration moves the stamp for the rows that follow */
    it("moves the stamp when the session declares another branch", async () => {
      const handler = logFactsHandler();
      await handler.handle(
        makeCommand(CONTRIBUTE_LOG_FACTS_COMMAND_TYPE, declarationData()),
      );
      const [first] = await handler.handle(
        makeCommand(CONTRIBUTE_LOG_FACTS_COMMAND_TYPE, modelCallData()),
      );
      await handler.handle(
        makeCommand(
          CONTRIBUTE_LOG_FACTS_COMMAND_TYPE,
          declarationData({ "vcs.ref.head.name": "feat/next" }),
        ),
      );
      const [second] = await handler.handle(
        makeCommand(
          CONTRIBUTE_LOG_FACTS_COMMAND_TYPE,
          modelCallData({ recordId: "rec-call-2" }),
        ),
      );

      expect(first!.data.branch).toBe("main");
      expect(second!.data.branch).toBe("feat/next");
    });

    it("leaves a non-row event unstamped", async () => {
      const handler = logFactsHandler();
      await handler.handle(
        makeCommand(CONTRIBUTE_LOG_FACTS_COMMAND_TYPE, declarationData()),
      );
      const [event] = await handler.handle(
        makeCommand(
          CONTRIBUTE_LOG_FACTS_COMMAND_TYPE,
          logFactsData({
            facts: { "event.name": "claude_code.hook_executed" },
          }),
        ),
      );

      expect(event!.data.branch).toBeUndefined();
      expect(event!.data.repositoryOwner).toBeUndefined();
    });
  });

  describe("when the session has not declared a working context", () => {
    /** @scenario A model call before any declaration is stored unstamped */
    it("contributes the model call unstamped", async () => {
      const handler = logFactsHandler();
      const [event] = await handler.handle(
        makeCommand(CONTRIBUTE_LOG_FACTS_COMMAND_TYPE, modelCallData()),
      );

      expect(event!.data.repositoryHost).toBeUndefined();
      expect(event!.data.repositoryOwner).toBeUndefined();
      expect(event!.data.repositoryName).toBeUndefined();
      expect(event!.data.branch).toBeUndefined();
    });
  });

  describe("when the declaration names a repository but no branch", () => {
    /** @scenario A declaration with no branch stamps nothing */
    it("stamps nothing until a branch is declared", async () => {
      const handler = logFactsHandler();
      await handler.handle(
        makeCommand(
          CONTRIBUTE_LOG_FACTS_COMMAND_TYPE,
          declarationData({ "vcs.ref.head.name": "" }),
        ),
      );
      const [event] = await handler.handle(
        makeCommand(CONTRIBUTE_LOG_FACTS_COMMAND_TYPE, modelCallData()),
      );

      expect(event!.data.branch).toBeUndefined();
      expect(event!.data.repositoryOwner).toBeUndefined();
    });
  });

  describe("when the memo cannot be read", () => {
    /** @scenario "A record whose memo cannot be read is contributed unstamped" */
    it("contributes the record unstamped rather than failing it", async () => {
      const failing: SessionContextMemo = {
        get: async () => {
          throw new Error("redis away");
        },
        set: async () => {
          throw new Error("redis away");
        },
      };
      const handler = logFactsHandler(failing);
      const [event] = await handler.handle(
        makeCommand(CONTRIBUTE_LOG_FACTS_COMMAND_TYPE, modelCallData()),
      );

      expect(event!.type).toBe(LOG_FACTS_CONTRIBUTED_EVENT_TYPE);
      expect(event!.data.branch).toBeUndefined();
    });
  });

  describe("when the memo cannot be written", () => {
    /** @scenario "A declaration whose memo cannot be written is still contributed" */
    it("contributes the declaration itself rather than failing it", async () => {
      const failing: SessionContextMemo = {
        get: async () => null,
        set: async () => {
          throw new Error("redis away");
        },
      };
      const handler = logFactsHandler(failing);

      const [event] = await handler.handle(
        makeCommand(CONTRIBUTE_LOG_FACTS_COMMAND_TYPE, declarationData()),
      );

      expect(event!.type).toBe(LOG_FACTS_CONTRIBUTED_EVENT_TYPE);
      expect(event!.data.recordId).toBe("rec-context");
    });
  });
});

describe("ContributeMetricFactsCommand", () => {
  describe("when a series' converged totals are contributed", () => {
    /** @scenario a session that sent only metrics still appears */
    it("emits one session-keyed metric_facts_contributed event", async () => {
      const handler = new ContributeMetricFactsCommand();
      const events = await handler.handle(
        makeCommand(CONTRIBUTE_METRIC_FACTS_COMMAND_TYPE, metricFactsData()),
      );

      expect(events).toHaveLength(1);
      const [event] = events;
      expect(event!.type).toBe(METRIC_FACTS_CONTRIBUTED_EVENT_TYPE);
      expect(event!.aggregateId).toBe(SESSION);
      expect(event!.data.value).toBe(1.25);
    });
  });

  describe("when the same converged observation is re-delivered", () => {
    /** @scenario re-delivered telemetry does not inflate a session */
    it("collapses re-deliveries; a newer observation is a new fact", async () => {
      const handler = new ContributeMetricFactsCommand();
      const [same1] = await handler.handle(
        makeCommand(CONTRIBUTE_METRIC_FACTS_COMMAND_TYPE, metricFactsData()),
      );
      const [same2] = await handler.handle(
        makeCommand(CONTRIBUTE_METRIC_FACTS_COMMAND_TYPE, metricFactsData()),
      );
      const [newer] = await handler.handle(
        makeCommand(
          CONTRIBUTE_METRIC_FACTS_COMMAND_TYPE,
          metricFactsData({ value: 2.5, asOfUnixMs: 1_760_000_060_000 }),
        ),
      );

      expect(same1!.idempotencyKey).toBe(same2!.idempotencyKey);
      expect(newer!.idempotencyKey).not.toBe(same1!.idempotencyKey);
    });
  });

  describe("when the value is a delta rather than a total", () => {
    // The schema cannot see intent, but the contract is stated where the
    // value is defined; what it CAN refuse is a negative datapoint count.
    it("rejects a negative dataPointCount", () => {
      const result = contributeMetricFactsCommandDataSchema.safeParse({
        ...metricFactsData(),
        dataPointCount: -1,
      });
      expect(result.success).toBe(false);
    });
  });
});
