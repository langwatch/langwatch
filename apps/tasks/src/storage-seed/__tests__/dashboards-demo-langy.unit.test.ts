/**
 * Langy's turns as the dashboards demo makes them: one trace per turn of gateway chat spans with
 * origin "langy", in the shape the mirror sends and the shape an asking project receives.
 * @see specs/setup/dashboards-demo-seed.feature
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { demoDays } from "../dashboards-demo-days.ts";
import { type LangyTurn, langyMirrorTurnsOn, langyTurnsAskedIn } from "../dashboards-demo-langy.ts";

const DAY_MS = 86_400_000;
const NOW = Date.UTC(2026, 9, 8, 15);
const DAYS = demoDays({ days: 30, todayStart: Math.floor(NOW / DAY_MS) * DAY_MS });
const MIRROR_PROJECT = "langy-mirror-project";
const SOURCE_ORGANIZATION = "organization-that-asked";

const exportSchema = z.object({
  resourceSpans: z.array(
    z.object({
      resource: z.object({ attributes: z.array(z.looseObject({ key: z.string() })) }),
      scopeSpans: z.array(
        z.object({
          scope: z.object({ name: z.string() }),
          spans: z.array(
            z.looseObject({
              traceId: z.string(),
              spanId: z.string(),
              parentSpanId: z.string(),
              name: z.string(),
              status: z.object({ code: z.number() }),
              attributes: z.array(
                z.object({
                  key: z.string(),
                  value: z.object({
                    stringValue: z.string().optional(),
                    intValue: z.string().optional(),
                  }),
                }),
              ),
            }),
          ),
        }),
      ),
    }),
  ),
});
const messagesSchema = z.array(
  z.looseObject({
    role: z.string(),
    tool_calls: z
      .array(z.object({ function: z.object({ name: z.string(), arguments: z.string() }) }))
      .optional(),
  }),
);

/** A turn's spans, each with its attributes by key. */
function callsOf(turn: LangyTurn) {
  return exportSchema
    .parse(turn.export)
    .resourceSpans.flatMap(({ scopeSpans }) => scopeSpans.flatMap(({ spans }) => spans))
    .map((span) => ({
      ...span,
      attribute: Object.fromEntries(
        span.attributes.map(({ key, value }) => [key, value.stringValue ?? value.intValue]),
      ),
    }));
}

const mirrored = DAYS.flatMap((day) =>
  langyMirrorTurnsOn({
    projectId: MIRROR_PROJECT,
    organizationId: SOURCE_ORGANIZATION,
    day,
    scale: 1,
    now: NOW,
  }),
);
const askedIn = DAYS.flatMap((day) =>
  langyTurnsAskedIn({ projectId: "dashboards-demo-care", day, count: 6, now: NOW }),
);

describe("given the Langy turns the demo makes for the mirror project", () => {
  describe("when the turns are read as the stack receives them", () => {
    /** @scenario "Langy history lands in the Langy mirror project" */
    it("finds one trace per turn, made of gateway chat spans with origin langy", () => {
      const calls = mirrored.map(callsOf);

      expect(mirrored.length).toBeGreaterThan(300);
      expect(new Set(mirrored.map(({ traceId }) => traceId)).size).toBe(mirrored.length);
      for (const [index, turn] of calls.entries()) {
        expect(new Set(turn.map(({ traceId }) => traceId))).toEqual(
          new Set([mirrored[index]?.traceId]),
        );
      }
      expect(new Set(calls.flat().map(({ name }) => name))).toEqual(new Set(["gen_ai.chat"]));
      expect(new Set(calls.flat().map(({ attribute }) => attribute["langwatch.origin"]))).toEqual(
        new Set(["langy"]),
      );
    });

    /** @scenario "Langy history lands in the Langy mirror project" */
    it("finds the mirror's shape: no turn root span, and the organization the turn came from", () => {
      const calls = mirrored.flatMap(callsOf);
      const spanIds = new Set(calls.map(({ spanId }) => spanId));

      expect(calls.filter(({ parentSpanId }) => spanIds.has(parentSpanId))).toEqual([]);
      expect(new Set(calls.map(({ attribute }) => attribute["langwatch.project_id"]))).toEqual(
        new Set([MIRROR_PROJECT]),
      );
      expect(new Set(calls.map(({ attribute }) => attribute["langwatch.organization_id"]))).toEqual(
        new Set([SOURCE_ORGANIZATION]),
      );
    });

    /** @scenario "Langy history lands in the Langy mirror project" */
    it("finds each turn's user, its model calls with tokens and cost, and its CLI tool calls", () => {
      const calls = mirrored.flatMap(callsOf);
      const answered = calls.filter(({ status }) => status.code === 0);
      const commands = calls.flatMap(({ attribute }) =>
        messagesSchema
          .parse(JSON.parse(attribute["gen_ai.input.messages"] ?? "[]"))
          .flatMap(({ tool_calls: toolCalls = [] }) => toolCalls)
          .map((call) => `${call.function.name} ${call.function.arguments}`),
      );

      expect(
        calls.every(({ attribute }) =>
          /You are talking to [\w ]+ <\w+@example\.dev>/.test(
            attribute["gen_ai.input.messages"] ?? "",
          ),
        ),
      ).toBe(true);
      expect(calls.every(({ attribute }) => Boolean(attribute["gen_ai.request.model"]))).toBe(true);
      expect(
        answered.every(({ attribute }) => Number(attribute["gen_ai.usage.input_tokens"]) > 0),
      ).toBe(true);
      expect(
        answered.every(({ attribute }) => Number(attribute["gen_ai.usage.output_tokens"]) > 0),
      ).toBe(true);
      expect(calls.every(({ attribute }) => "gen_ai.usage.cost" in attribute)).toBe(true);
      expect(commands.length).toBeGreaterThan(100);
      expect(commands.every((command) => command.startsWith('bash {"command":"langwatch '))).toBe(
        true,
      );
    });

    /** @scenario "Langy history lands in the Langy mirror project" */
    it("finds some turns failed, each on a call that says why", () => {
      const failures = mirrored.filter(({ failed }) => failed);
      const reasons = failures.flatMap((turn) =>
        callsOf(turn).map(({ status, attribute }) => `${status.code} ${attribute["error.type"]}`),
      );

      expect(failures.length).toBeGreaterThan(0);
      expect(failures.length).toBeLessThan(mirrored.length / 2);
      expect(
        reasons.filter((reason) => !["2 bad_request", "2 upstream_timeout"].includes(reason)),
      ).toEqual([]);
    });

    /** @scenario "Re-running the seed sends only what a project does not hold yet" */
    it("finds the same turns, ids and all, whenever they are made again", () => {
      const [day] = DAYS;
      if (!day) throw new Error("the run has no days");
      const make = () =>
        langyMirrorTurnsOn({
          projectId: MIRROR_PROJECT,
          organizationId: SOURCE_ORGANIZATION,
          day,
          scale: 1,
          now: NOW,
        });

      expect(make()).toEqual(make());
    });
  });
});

describe("given the Langy turns the demo makes inside a normal project", () => {
  describe("when the turns are read as the stack receives them", () => {
    /** @scenario "Langy's own turns sit beside a normal project's traces" */
    it("finds gateway chat spans with origin langy that name no source organization", () => {
      const calls = askedIn.flatMap(callsOf);

      expect(askedIn.length).toBeGreaterThan(100);
      expect(new Set(calls.map(({ name }) => name))).toEqual(new Set(["gen_ai.chat"]));
      expect(new Set(calls.map(({ attribute }) => attribute["langwatch.origin"]))).toEqual(
        new Set(["langy"]),
      );
      expect(new Set(calls.map(({ attribute }) => attribute["langwatch.project_id"]))).toEqual(
        new Set(["dashboards-demo-care"]),
      );
      expect(calls.filter(({ attribute }) => "langwatch.organization_id" in attribute)).toEqual([]);
    });

    /** @scenario "Langy's own turns sit beside a normal project's traces" */
    it("finds no turn that had not finished when the seed ran", () => {
      expect(askedIn.filter(({ finishedAt }) => finishedAt > NOW)).toEqual([]);
    });
  });
});
