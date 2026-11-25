// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * What each owner's fact folds into a week: the real fold pipeline on memory twins, fed by
 * stand-ins for the owners' pipelines, so each fact travels the subscriber, the record command
 * and the projection the way it does in the worker.
 * @see enterprise/modules/digest/specs/digest.feature
 */
import { NormalizedSpanKind, NormalizedStatusCode } from "@langwatch/trace-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { userWeekTotals } from "../../rules/digest-week.rules.ts";
import {
  digestWorld,
  installDigest,
  type InstalledDigest,
  MEMBER,
  ORGANIZATION,
  OWNER_FACTS,
  PROJECT,
  SENT_WEEK,
} from "./digest.fixture.ts";

/** An instant inside the sent week (2026-W46). */
const IN_SENT_WEEK = Date.parse("2026-11-11T12:00:00Z");
const PERSONAL_EMAIL = "jane.doe@example.com";
const PERSONAL_NAME = "Jane Doe";

let digest: InstalledDigest;

beforeEach(() => {
  const world = digestWorld();
  world.personalOwners.set(PROJECT, MEMBER);
  digest = installDigest(world);
});

afterEach(async () => {
  await digest.close();
});

const enrol = () =>
  digest.repositories.audience.setEnrolled({
    organizationId: ORGANIZATION,
    enrolled: true,
    by: "operator-1",
  });

/** One span as trace records it; `personal` plants an address and a name in its free text. */
function spanRecorded({
  spanId,
  traceId,
  root,
  error = false,
  personal = false,
}: {
  spanId: string;
  traceId: string;
  root: boolean;
  error?: boolean;
  personal?: boolean;
}) {
  return digest.ownerFact({
    fact: OWNER_FACTS.span,
    tenantId: PROJECT,
    aggregateId: traceId,
    occurredAt: IN_SENT_WEEK,
    data: {
      ingressEventId: `ingress-${spanId}`,
      span: {
        id: `row-${spanId}`,
        traceId,
        spanId,
        tenantId: PROJECT,
        parentSpanId: root ? null : `${traceId}-root`,
        parentTraceId: null,
        parentIsRemote: null,
        sampled: true,
        startTimeUnixMs: IN_SENT_WEEK,
        endTimeUnixMs: IN_SENT_WEEK + 80,
        durationMs: 80,
        name: personal ? `${PERSONAL_NAME}'s chat` : "chat",
        kind: NormalizedSpanKind.INTERNAL,
        resourceAttributes: personal ? { "user.email": PERSONAL_EMAIL } : {},
        spanAttributes: {
          "gen_ai.usage.input_tokens": 10,
          "gen_ai.usage.output_tokens": 5,
          ...(personal ? { "enduser.name": PERSONAL_NAME, "user.email": PERSONAL_EMAIL } : {}),
        },
        events: [],
        links: [],
        statusMessage: personal ? `${PERSONAL_NAME} was refused` : null,
        statusCode: error ? NormalizedStatusCode.ERROR : NormalizedStatusCode.OK,
        instrumentationScope: { name: "sdk", version: null },
        droppedAttributesCount: 0,
        droppedEventsCount: 0,
        droppedLinksCount: 0,
        cost: 0.1,
        nonBilledCost: null,
      },
    },
  });
}

const personalFacts = { "user.email": PERSONAL_EMAIL, "user.name": PERSONAL_NAME };

const codingAgentBase = (sessionId: string) => ({
  tenantId: PROJECT,
  sessionId,
  sessionKeySource: "provider" as const,
  agent: "claude_code",
  occurredAt: IN_SENT_WEEK,
});

/** A coding-agent span of one session. */
const codingAgentSpan = (sessionId: string) =>
  digest.ownerFact({
    fact: OWNER_FACTS.codingAgentSpan,
    tenantId: PROJECT,
    aggregateId: sessionId,
    occurredAt: IN_SENT_WEEK,
    data: {
      ...codingAgentBase(sessionId),
      traceId: `trace-${sessionId}`,
      spanId: `span-${sessionId}`,
      name: "claude_code.tool",
      startTimeUnixMs: IN_SENT_WEEK,
      endTimeUnixMs: IN_SENT_WEEK + 50,
      statusCode: 1,
      facts: personalFacts,
      scopeName: null,
    },
  });

/** One metric series of a session at its converged total. */
const codingAgentMetric = ({
  sessionId,
  metricName,
  value,
}: {
  sessionId: string;
  metricName: string;
  value: number;
}) =>
  digest.ownerFact({
    fact: OWNER_FACTS.codingAgentMetric,
    tenantId: PROJECT,
    aggregateId: sessionId,
    occurredAt: IN_SENT_WEEK,
    data: {
      ...codingAgentBase(sessionId),
      seriesId: `${sessionId}:${metricName}`,
      metricName,
      unit: null,
      attributes: { type: "input", ...personalFacts },
      value,
      dataPointCount: 1,
      asOfUnixMs: IN_SENT_WEEK,
    },
  });

/** Each of the three sessions' spans and series: 100/200/300 tokens, $0.5 and 10 lines apiece. */
async function threeCodingAgentSessions() {
  for (const [index, sessionId] of ["session-1", "session-2", "session-3"].entries()) {
    await codingAgentSpan(sessionId);
    await codingAgentMetric({
      sessionId,
      metricName: "claude_code.token.usage",
      value: (index + 1) * 100,
    });
    await codingAgentMetric({ sessionId, metricName: "claude_code.cost.usage", value: 0.5 });
    await codingAgentMetric({
      sessionId,
      metricName: "claude_code.lines_of_code.count",
      value: 10,
    });
  }
}

const scenarioFinished = ({
  scenarioRunId,
  verdict,
  reasoning,
}: {
  scenarioRunId: string;
  verdict: "success" | "failure";
  reasoning?: string;
}) =>
  digest.ownerFact({
    fact: OWNER_FACTS.scenario,
    tenantId: PROJECT,
    aggregateId: scenarioRunId,
    occurredAt: IN_SENT_WEEK,
    data: {
      scenarioRunId,
      scenarioId: "scenario-1",
      occurredAt: IN_SENT_WEEK,
      results: { verdict, reasoning, metCriteria: [], unmetCriteria: [] },
    },
  });

describe("the digest fold intake", () => {
  describe("when spans are received for an enrolled project across two traces, one with an error", () => {
    /** @scenario "Trace spans fold into the project's week as they arrive" */
    it("holds 2 traces, 1 error and the summed tokens and cost in the week the spans started", async () => {
      await enrol();

      await spanRecorded({ traceId: "trace-a", spanId: "a-root", root: true });
      await spanRecorded({ traceId: "trace-a", spanId: "a-child", root: false });
      await spanRecorded({ traceId: "trace-b", spanId: "b-root", root: true, error: true });

      await vi.waitFor(async () => {
        expect((await digest.projectWeek({ isoWeek: SENT_WEEK }))?.tokens).toBe(45);
      });
      const week = await digest.projectWeek({ isoWeek: SENT_WEEK });
      expect(week).toMatchObject({ traces: 2, errors: 1, tokens: 45 });
      expect(week?.costUsd).toBeCloseTo(0.3);
    });
  });

  describe("when coding-agent facts are contributed for a person's project across three sessions", () => {
    /** @scenario "Coding-agent facts fold into the person's week" */
    it("holds 3 sessions and the summed tokens, cost and lines", async () => {
      await enrol();

      await threeCodingAgentSessions();

      await vi.waitFor(async () => {
        const week = await digest.userWeek({ isoWeek: SENT_WEEK, userId: MEMBER });
        expect(week && userWeekTotals(week).sessions).toBe(3);
        expect(Object.keys(week?.series ?? {})).toHaveLength(9);
      });
      const week = await digest.userWeek({ isoWeek: SENT_WEEK, userId: MEMBER });
      expect(week && userWeekTotals(week)).toMatchObject({
        sessions: 3,
        tokens: 600,
        costUsd: 1.5,
        linesChanged: 30,
      });
    });
  });

  describe("when scenario runs finish, passing and failing, in an enrolled project", () => {
    /** @scenario "Scenario outcomes fold into the project's week" */
    it("holds the passed and failed counts", async () => {
      await enrol();

      await scenarioFinished({ scenarioRunId: "run-1", verdict: "success" });
      await scenarioFinished({ scenarioRunId: "run-2", verdict: "success" });
      await scenarioFinished({ scenarioRunId: "run-3", verdict: "failure" });

      await vi.waitFor(async () => {
        expect((await digest.projectWeek({ isoWeek: SENT_WEEK }))?.scenarios.runs).toBe(3);
      });
      expect((await digest.projectWeek({ isoWeek: SENT_WEEK }))?.scenarios).toEqual({
        runs: 3,
        passed: 2,
        failed: 1,
      });
    });
  });

  describe("when facts carrying an address and a name are folded", () => {
    /** @scenario "A fold holds numbers and ids, never personal data" */
    it("stores no email address and no name in any fold row", async () => {
      await enrol();

      await spanRecorded({ traceId: "trace-a", spanId: "a-root", root: true, personal: true });
      await scenarioFinished({
        scenarioRunId: "run-1",
        verdict: "failure",
        reasoning: `${PERSONAL_NAME} asked for a refund at ${PERSONAL_EMAIL}`,
      });
      await threeCodingAgentSessions();

      await vi.waitFor(async () => {
        const week = await digest.userWeek({ isoWeek: SENT_WEEK, userId: MEMBER });
        expect(week && userWeekTotals(week).sessions).toBe(3);
        expect((await digest.projectWeek({ isoWeek: SENT_WEEK }))?.scenarios.runs).toBe(1);
        expect((await digest.projectWeek({ isoWeek: SENT_WEEK }))?.traces).toBe(1);
      });
      const rows = JSON.stringify([
        await digest.projectWeek({ isoWeek: SENT_WEEK }),
        await digest.userWeek({ isoWeek: SENT_WEEK, userId: MEMBER }),
      ]);
      expect(rows).not.toContain(PERSONAL_NAME);
      expect(rows).not.toContain(PERSONAL_EMAIL);
      expect(rows).not.toMatch(/\S+@\S+/);
    });
  });
});
