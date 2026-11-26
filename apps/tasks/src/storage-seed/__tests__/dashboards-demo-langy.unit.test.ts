/**
 * Langy's turns as the dashboards demo makes them: one trace per turn of gateway chat spans with
 * origin "langy": the mirror's copy under a langy.turn root naming the source tenant, and the
 * calls alone, as an asking project receives them.
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
const SOURCE_PROJECTS = ["project-that-asked", "another-project-that-asked"];

const attributeSchema = z.object({
  key: z.string(),
  value: z.object({
    stringValue: z.string().optional(),
    intValue: z.string().optional(),
  }),
});
const exportSchema = z.object({
  resourceSpans: z.array(
    z.object({
      resource: z.object({ attributes: z.array(attributeSchema) }),
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
              attributes: z.array(attributeSchema),
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

const byKey = (attributes: readonly z.infer<typeof attributeSchema>[]) =>
  Object.fromEntries(
    attributes.map(({ key, value }) => [key, value.stringValue ?? value.intValue]),
  );

/** A turn's spans, each with its own and its resource's attributes by key. */
function spansOf(turn: LangyTurn) {
  return exportSchema.parse(turn.export).resourceSpans.flatMap(({ resource, scopeSpans }) =>
    scopeSpans.flatMap(({ spans }) =>
      spans.map((span) => ({
        ...span,
        attribute: byKey(span.attributes),
        resource: byKey(resource.attributes),
      })),
    ),
  );
}

/** A turn's gateway model calls. */
function callsOf(turn: LangyTurn) {
  return spansOf(turn).filter(({ name }) => name === "gen_ai.chat");
}

const mirrored = DAYS.flatMap((day) =>
  langyMirrorTurnsOn({
    projectId: MIRROR_PROJECT,
    organizationId: SOURCE_ORGANIZATION,
    sourceProjectIds: SOURCE_PROJECTS,
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
    it("finds the mirror's shape: a langy.turn root over the calls, naming the source tenant", () => {
      for (const turn of mirrored) {
        const spans = spansOf(turn);
        const roots = spans.filter(({ name }) => name === "langy.turn");
        const [root] = roots;

        expect(roots).toHaveLength(1);
        expect(root?.parentSpanId).toBe("");
        expect(root?.status.code).toBe(turn.failed ? 2 : 1);
        expect(callsOf(turn).every(({ parentSpanId }) => parentSpanId === root?.spanId)).toBe(true);
        expect(root?.attribute["langwatch.origin"]).toBeUndefined();
        for (const span of spans) {
          expect(span.resource["langwatch.organization_id"]).toBe(SOURCE_ORGANIZATION);
          expect(SOURCE_PROJECTS).toContain(span.resource["langwatch.project_id"]);
          expect(span.resource["langwatch.project_id"]).not.toBe(MIRROR_PROJECT);
          expect(span.attribute["langwatch.organization_id"]).toBeUndefined();
        }
      }
      expect(
        new Set(
          mirrored.flatMap(callsOf).map(({ attribute }) => attribute["langwatch.project_id"]),
        ),
      ).toEqual(new Set([MIRROR_PROJECT]));
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
          sourceProjectIds: SOURCE_PROJECTS,
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
      expect(new Set(askedIn.flatMap(spansOf).map(({ name }) => name))).toEqual(
        new Set(["gen_ai.chat"]),
      );
      expect(new Set(calls.map(({ attribute }) => attribute["langwatch.origin"]))).toEqual(
        new Set(["langy"]),
      );
      expect(new Set(calls.map(({ attribute }) => attribute["langwatch.project_id"]))).toEqual(
        new Set(["dashboards-demo-care"]),
      );
      expect(calls.filter(({ attribute }) => "langwatch.organization_id" in attribute)).toEqual([]);
      expect(calls.filter(({ resource }) => "langwatch.organization_id" in resource)).toEqual([]);
      expect(calls.filter(({ resource }) => "langwatch.project_id" in resource)).toEqual([]);
    });

    /** @scenario "Langy's own turns sit beside a normal project's traces" */
    it("finds no turn that had not finished when the seed ran", () => {
      expect(askedIn.filter(({ finishedAt }) => finishedAt > NOW)).toEqual([]);
    });
  });
});
