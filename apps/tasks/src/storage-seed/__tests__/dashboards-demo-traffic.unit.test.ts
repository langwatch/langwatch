/**
 * The traffic the dashboards demo makes, before any of it is sent: what a trace carries for the
 * widgets that read it, the working week it follows, and the story its history tells.
 * @see specs/setup/dashboards-demo-seed.feature
 */
import {
  collectorRESTParamsSchema,
  trackEventRESTParamsValidatorSchema,
} from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { codingSessionsOn } from "../dashboards-demo-coding.ts";
import { type DemoDay, demoDays, isWeekend } from "../dashboards-demo-days.ts";
import { DASHBOARDS_DEMO_PROJECTS } from "../dashboards-demo-ids.ts";
import { otlpResourceSpans } from "../dashboards-demo-otlp.ts";
import { DASHBOARDS_DEMO_PROJECT_SPECS } from "../dashboards-demo-projects.generated.ts";
import { DEMO_SUITES, suiteBatchOn } from "../dashboards-demo-scenarios.ts";
import { withStory } from "../dashboards-demo-story.ts";
import {
  conversationTurns,
  demoConversationsPerDay,
  demoTracesPerDay,
  type DemoTurn,
} from "../dashboards-demo-traffic.ts";

const DAY_MS = 86_400_000;
/** A Thursday afternoon; the story's days are counted back from it. */
const NOW = Date.UTC(2026, 9, 8, 15);
const DAYS = demoDays({ days: 60, todayStart: Math.floor(NOW / DAY_MS) * DAY_MS });
const OUTCOMES = ["resolved", "misunderstood", "capability_gap", "refusal", "handover"];

interface Made {
  turn: DemoTurn;
  day: DemoDay;
}

function agentNamed(agentName: string) {
  for (const project of DASHBOARDS_DEMO_PROJECTS) {
    const agent = project.agents.find(({ name }) => name === agentName);
    const base = DASHBOARDS_DEMO_PROJECT_SPECS.find(
      ({ archetype }) => archetype === agent?.archetype,
    );
    if (agent && base) return { project, agent, spec: withStory({ spec: base, agentName }) };
  }
  throw new Error(`no demo agent is named ${agentName}`);
}

const histories = new Map<string, Made[]>();

/** Every trace an agent makes over the 60 days, as the seed builds them, made once per suite. */
function history({ agentName, scale = 1 }: { agentName: string; scale?: number }): Made[] {
  const held = histories.get(`${agentName}:${scale}`);
  if (held) return held;
  const { project, agent, spec } = agentNamed(agentName);
  const made = DAYS.flatMap((day) =>
    Array.from({ length: demoConversationsPerDay({ spec, agent, day, scale }) }, (_, index) =>
      conversationTurns({ spec, agent, projectSlug: project.slug, demoDay: day, index }),
    )
      .flat()
      .map((turn) => ({ turn, day })),
  );
  histories.set(`${agentName}:${scale}`, made);
  return made;
}

const CONVERSING = DASHBOARDS_DEMO_PROJECTS.flatMap(({ agents }) => agents)
  .filter(({ shape }) => shape !== "coding")
  .map(({ name }) => name);

const share = <T>({ of, where }: { of: readonly T[]; where: (item: T) => boolean }): number =>
  of.filter(where).length / of.length;

const spansOf = ({ turn }: Made) => turn.body.spans;
const rootOf = (made: Made) => {
  const [root] = spansOf(made);
  if (!root) throw new Error("a demo trace has no span");
  return root;
};
const hourOf = (made: Made) =>
  Math.floor((rootOf(made).timestamps.started_at - made.day.dayStart) / 3_600_000);
const costOf = (made: Made) =>
  spansOf(made).reduce((sum, span) => sum + (span.metrics?.cost ?? 0), 0);
const failed = (made: Made) =>
  spansOf(made).some((span) => span.error && span.name !== "llm.retry");
const evaluationsBy = ({ of, evaluatorId }: { of: readonly Made[]; evaluatorId: string }) =>
  of.flatMap(({ turn }) =>
    (turn.body.evaluations ?? []).filter((evaluation) => evaluation.evaluator_id === evaluatorId),
  );
const on = (made: readonly Made[], days: (prototypeDay: number) => boolean) =>
  made.filter(({ day }) => days(day.prototypeDay));
const mean = (values: readonly number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;
const quantile = ({ of, at }: { of: readonly number[]; at: number }) =>
  of.toSorted((a, b) => a - b)[Math.floor(of.length * at)] ?? Number.NaN;

const otlpSpanSchema = z.looseObject({
  attributes: z.array(
    z.object({ key: z.string(), value: z.looseObject({ stringValue: z.string().optional() }) }),
  ),
});
const otlpSchema = z.looseObject({
  resourceSpans: z
    .array(
      z.looseObject({ scopeSpans: z.array(z.looseObject({ spans: z.array(otlpSpanSchema) })) }),
    )
    .optional(),
  resourceLogs: z
    .array(
      z.looseObject({ scopeLogs: z.array(z.looseObject({ logRecords: z.array(otlpSpanSchema) })) }),
    )
    .optional(),
});

/** The agent each span or log record of an OTLP body names, one entry per record. */
function agentsNamedIn(body: unknown): (string | undefined)[] {
  const { resourceSpans = [], resourceLogs = [] } = otlpSchema.parse(body);
  const records = [
    ...resourceSpans.flatMap(({ scopeSpans }) => scopeSpans.flatMap(({ spans }) => spans)),
    ...resourceLogs.flatMap(({ scopeLogs }) => scopeLogs.flatMap(({ logRecords }) => logRecords)),
  ];
  return records.map(
    ({ attributes }) =>
      attributes.find(({ key }) => key === "gen_ai.agent.name")?.value.stringValue,
  );
}

describe("given the traffic the demo makes for its agents", () => {
  describe("when a trace is built", () => {
    /** @scenario "Traffic goes through the stack's own doors with each project's key" */
    it("is a body the collector accepts, and so are its thumbs events", () => {
      const made = CONVERSING.flatMap((agentName) => history({ agentName }).slice(-300));
      const refused = made.filter(
        ({ turn }) =>
          !collectorRESTParamsSchema.validate(turn.body) ||
          turn.events.some((event) => !trackEventRESTParamsValidatorSchema.validate(event)),
      );

      expect(made).toHaveLength(300 * CONVERSING.length);
      expect(refused).toEqual([]);
    });

    /** @scenario "Three projects run named agents, and one project is empty" */
    it("names its agent in gen_ai.agent.name on the span that starts it", () => {
      for (const agentName of CONVERSING) {
        const exported = history({ agentName })
          .slice(-50)
          .map(({ turn }) =>
            agentsNamedIn({
              resourceSpans: [otlpResourceSpans({ serviceName: agentName, body: turn.body })],
            }),
          );

        expect(exported.every(([first]) => first === agentName)).toBe(true);
      }
    });

    /** @scenario "Three projects run named agents, and one project is empty" */
    it("names the coding agent on every span and log record of a session", () => {
      const [, , engineering] = DASHBOARDS_DEMO_PROJECTS;
      for (const agent of engineering?.agents ?? []) {
        const sessions = DAYS.slice(-10).flatMap((day) =>
          codingSessionsOn({
            agent,
            projectSlug: engineering?.slug ?? "",
            day,
            scale: 1,
            now: NOW,
          }),
        );
        const named = sessions.flatMap(({ traces, logs }) =>
          [...traces, ...logs].flatMap(agentsNamedIn),
        );

        expect(sessions.length).toBeGreaterThan(10);
        expect(new Set(named)).toEqual(new Set([agent.name]));
      }
    });

    /** @scenario "Re-running the seed sends only what a project does not hold yet" */
    it("is the same trace, ids and all, whenever it is built again", () => {
      const { project, agent, spec } = agentNamed("shop-assistant");
      const [demoDay] = DAYS;
      if (!demoDay) throw new Error("the run has no days");
      const build = () =>
        conversationTurns({ spec, agent, projectSlug: project.slug, demoDay, index: 3 });

      expect(build()).toEqual(build());
    });
  });

  describe("when the widgets read what the traces carry", () => {
    /** @scenario "The traffic carries what the dashboard widgets read" */
    it("finds thread, user and customer ids, labels, models, tokens and cost", () => {
      const made = history({ agentName: "shop-assistant" });
      const metadata = (field: "thread_id" | "user_id" | "customer_id") =>
        share({ of: made, where: ({ turn }) => Boolean(turn.body.metadata?.[field]) });
      // The last model call is the one that answered; one before it may be a failed try.
      const models = made.map((trace) => spansOf(trace).findLast((span) => span.type === "llm"));

      expect(metadata("thread_id")).toBeGreaterThan(0.9);
      expect(metadata("user_id")).toBeGreaterThan(0.6);
      expect(metadata("customer_id")).toBeGreaterThan(0.6);
      expect(
        share({ of: made, where: ({ turn }) => (turn.body.metadata?.labels?.length ?? 0) > 0 }),
      ).toBeGreaterThan(0.1);
      expect(models.every((span) => span && "model" in span && Boolean(span.model))).toBe(true);
      expect(models.every((span) => (span?.metrics?.prompt_tokens ?? 0) > 0)).toBe(true);
      expect(models.every((span) => (span?.metrics?.completion_tokens ?? 0) > 0)).toBe(true);
      expect(made.every((trace) => costOf(trace) > 0)).toBe(true);
    });

    /** @scenario "The traffic carries what the dashboard widgets read" */
    it("finds tool spans, sub-agent spans, retrieval contexts, errors and retries", () => {
      const has = ({ agentName, where }: { agentName: string; where: (made: Made) => boolean }) =>
        share({ of: history({ agentName }), where });
      const subAgents = history({ agentName: "checkout-planner" }).map((made) =>
        spansOf(made)
          .slice(1)
          .filter((span) => span.type === "agent")
          .map((span) => span.name),
      );

      expect(
        has({
          agentName: "shop-assistant",
          where: (made) => spansOf(made).some((span) => span.type === "tool"),
        }),
      ).toBe(1);
      expect(subAgents.every((names) => names.length > 0)).toBe(true);
      expect(new Set(subAgents.flat())).toEqual(new Set(["cart-agent", "payment-agent"]));
      expect(
        has({
          agentName: "help-center-answerer",
          where: (made) =>
            spansOf(made).some((span) => "contexts" in span && (span.contexts?.length ?? 0) > 0),
        }),
      ).toBeGreaterThan(0.9);
      for (const agentName of CONVERSING) {
        expect(has({ agentName, where: failed })).toBeGreaterThan(0);
        expect(
          has({
            agentName,
            where: (made) => spansOf(made).some((span) => span.name === "llm.retry"),
          }),
        ).toBeGreaterThan(0.01);
      }
    });

    /** @scenario "The traffic carries what the dashboard widgets read" */
    it("finds a working day and week, with long-tailed latency and tokens", () => {
      const made = history({ agentName: "shop-assistant" });
      const perDay = (weekend: boolean) =>
        made.filter(({ day }) => isWeekend(day) === weekend).length /
        DAYS.filter((day) => isWeekend(day) === weekend).length;
      const latency = made.map((trace) => {
        const { started_at: startedAt, finished_at: finishedAt } = rootOf(trace).timestamps;
        return finishedAt - startedAt;
      });
      const tokens = made.flatMap((trace) =>
        spansOf(trace).flatMap((span) => span.metrics?.completion_tokens ?? []),
      );
      const nightlyHours = new Set(history({ agentName: "invoice-classifier" }).map(hourOf));

      expect(perDay(false)).toBeGreaterThan(perDay(true) * 1.3);
      expect(
        share({ of: made, where: (trace) => hourOf(trace) >= 8 && hourOf(trace) <= 18 }),
      ).toBeGreaterThan(0.7);
      expect([...nightlyHours].toSorted((a, b) => a - b)).toEqual([1, 2, 3]);
      expect(Math.min(...latency)).toBeGreaterThan(0);
      expect(quantile({ of: latency, at: 0.95 })).toBeGreaterThan(
        quantile({ of: latency, at: 0.5 }) * 1.5,
      );
      expect(quantile({ of: tokens, at: 0.95 })).toBeGreaterThan(
        quantile({ of: tokens, at: 0.5 }) * 2,
      );
    });

    /** @scenario "The traffic carries what the dashboard widgets read" */
    it("finds the support bot's outcome as a category label of its outcome judge", () => {
      const judged = evaluationsBy({
        of: history({ agentName: "shop-assistant" }),
        evaluatorId: "outcome-judge",
      });

      expect(judged.length).toBeGreaterThan(50);
      expect(new Set(judged.map(({ name }) => name))).toEqual(
        new Set(["Conversation Outcome Judge"]),
      );
      expect(new Set(judged.map(({ label }) => label))).toEqual(new Set(OUTCOMES));
    });

    /** @scenario "The traffic carries what the dashboard widgets read" */
    it("finds thumbs_up_down events on the agents whose users give feedback", () => {
      const events = ["shop-assistant", "catalogue-copywriter"].map((agentName) =>
        history({ agentName }).flatMap(({ turn }) => turn.events),
      );

      for (const thumbs of events) {
        expect(thumbs.length).toBeGreaterThan(50);
        expect(new Set(thumbs.map((event) => event.event_type))).toEqual(
          new Set(["thumbs_up_down"]),
        );
        expect(new Set(thumbs.map((event) => event.metrics.vote))).toEqual(new Set([1, -1]));
      }
    });
  });

  describe("when the size flag scales the volume", () => {
    /** @scenario "The size flag sets the volume" */
    it("makes about 0.3, 1 or 6 times an agent's usual traces", () => {
      const { agent, spec } = agentNamed("shop-assistant");
      const traces = (scale: number) =>
        DAYS.reduce((sum, day) => sum + demoTracesPerDay({ spec, agent, day, scale }), 0);

      expect(traces(0.3) / traces(1)).toBeCloseTo(0.3, 1);
      expect(traces(6) / traces(1)).toBeCloseTo(6, 1);
    });
  });
});

describe("given the story the demo's history tells", () => {
  describe("when a widget compares before and after each change", () => {
    /** @scenario "The history tells a story widgets can find" */
    it("finds the shop assistant on gpt-5-nano from 14 days ago, with lower answer quality", () => {
      const made = history({ agentName: "shop-assistant" });
      const quality = (rows: readonly Made[]) =>
        share({
          of: evaluationsBy({ of: rows, evaluatorId: "answer-quality" }),
          where: ({ passed }) => passed === true,
        });
      const onNano = (rows: readonly Made[]) =>
        share({
          of: rows,
          where: (trace) =>
            spansOf(trace).some((span) => "model" in span && span.model === "gpt-5-nano"),
        });
      const before = made.filter(({ day }) => day.daysAgo > 14);
      const since = made.filter(({ day }) => day.daysAgo <= 14);

      expect(onNano(before)).toBe(0);
      expect(onNano(since)).toBeGreaterThan(0.85);
      expect(quality(before) - quality(since)).toBeGreaterThan(0.1);
    });

    /** @scenario "The history tells a story widgets can find" */
    it("finds the checkout planner's cost raised for four days, and back down after", () => {
      const made = history({ agentName: "checkout-planner" });
      const cost = (days: (prototypeDay: number) => boolean) => mean(on(made, days).map(costOf));
      const usual = cost((day) => day < 81);
      const looping = [81, 82, 83, 84].map((looped) => cost((day) => day === looped));

      expect(Math.min(...looping)).toBeGreaterThan(usual * 1.5);
      expect(cost((day) => day === 80)).toBeLessThan(usual * 1.3);
      expect(cost((day) => day >= 85)).toBeLessThan(usual * 1.3);
    });

    /** @scenario "The history tells a story widgets can find" */
    it("finds Customer care failing in the hour from 14:00 UTC, 5 days ago", () => {
      const [care] = DASHBOARDS_DEMO_PROJECTS;
      const thatDay = (care?.agents ?? [])
        .flatMap(({ name }) => history({ agentName: name }))
        .filter(({ day }) => day.daysAgo === 5);
      const inTheHour = thatDay.filter((trace) => hourOf(trace) === 14);
      const restOfDay = thatDay.filter((trace) => hourOf(trace) !== 14);

      expect(inTheHour.length).toBeGreaterThan(5);
      expect(share({ of: inTheHour, where: failed })).toBeGreaterThan(0.2);
      expect(share({ of: restOfDay, where: failed })).toBeLessThan(0.05);
    });

    /** @scenario "The history tells a story widgets can find" */
    it("finds the scenario that returns a damaged parcel passing about half the time", () => {
      const [suite] = DEMO_SUITES;
      if (!suite) throw new Error("the demo has no scenario suite");
      const flaky = suite.scenarios.findIndex(({ name }) => name === "Return a damaged parcel");
      const statusOf = z.looseObject({
        type: z.literal("SCENARIO_RUN_FINISHED"),
        status: z.string(),
      });
      const runs = DAYS.flatMap((day) =>
        suiteBatchOn({ suite, projectSlug: "dashboards-demo-care", day, now: NOW }),
      );
      const passRate = (scenario: number) =>
        share({
          of: runs.filter(({ scenarioRunId }) => scenarioRunId.endsWith(`_${scenario}`)),
          where: ({ events }) => statusOf.parse(events.at(-1)).status === "SUCCESS",
        });

      expect(passRate(flaky)).toBeGreaterThan(0.3);
      expect(passRate(flaky)).toBeLessThan(0.7);
      expect(passRate(0)).toBeGreaterThan(0.9);
    });

    /** @scenario "The history tells a story widgets can find" */
    it("finds the customer harbor-pine resolving fewer conversations from 11 days ago", () => {
      const made = history({ agentName: "shop-assistant", scale: 6 });
      const resolved = ({ rows, theirs }: { rows: readonly Made[]; theirs: boolean }) =>
        share({
          of: evaluationsBy({
            of: rows.filter(
              ({ turn }) => (turn.body.metadata?.customer_id === "harbor-pine") === theirs,
            ),
            evaluatorId: "outcome-judge",
          }),
          where: ({ label }) => label === "resolved",
        });
      const before = made.filter(({ day }) => day.daysAgo > 11);
      const since = made.filter(({ day }) => day.daysAgo <= 11);
      const theirDrop =
        resolved({ rows: before, theirs: true }) - resolved({ rows: since, theirs: true });
      const othersDrop =
        resolved({ rows: before, theirs: false }) - resolved({ rows: since, theirs: false });

      expect(theirDrop).toBeGreaterThan(0.3);
      expect(theirDrop).toBeGreaterThan(othersDrop + 0.15);
    });
  });
});
