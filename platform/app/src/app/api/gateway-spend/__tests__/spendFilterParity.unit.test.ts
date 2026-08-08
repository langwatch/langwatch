/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import openapi from "~/app/api/openapiLangWatch.json";
import { spendFilterQueryShape } from "~/server/gateway/spendFilters";

const EVENTS = "/api/gateway/v1/spend-events";
const SUMMARIES = "/api/gateway/v1/spend-summaries";

/** Controls that shape a rollup rather than narrowing it, so they belong to
 *  the summaries read alone and are not part of the shared vocabulary. */
const ROLLUP_ONLY = new Set([
  "group_by",
  "bucket",
  "timezone",
  "allow_unstable",
]);
/** Paging and windowing, shared by both but not filters. */
const NOT_A_FILTER = new Set(["from", "to", "cursor", "limit"]);

interface QueryParameter {
  name: string;
  in: string;
  schema?: unknown;
}

/**
 * The query parameters the published document gives this operation.
 *
 * Throws when the path is absent rather than answering with nothing: every
 * assertion below compares two of these, and two empty lists are equal, so a
 * renamed route would turn this whole file green while checking nothing.
 */
function queryParameters(path: string): QueryParameter[] {
  const paths = (openapi as { paths: Record<string, unknown> }).paths;
  const operation = (paths[path] as { get?: { parameters?: unknown[] } })?.get;
  if (operation === undefined) {
    throw new Error(
      `${path} has no documented GET. If the route moved, point this check at it; do not let it pass by finding nothing.`,
    );
  }
  return ((operation.parameters ?? []) as QueryParameter[]).filter(
    (p) => p.in === "query",
  );
}

function queryParameterNames(path: string): string[] {
  return queryParameters(path).map((p) => p.name);
}

function filterNames(path: string): Set<string> {
  return new Set(
    queryParameterNames(path).filter(
      (name) => !ROLLUP_ONLY.has(name) && !NOT_A_FILTER.has(name),
    ),
  );
}

/** Each shared filter's published schema, keyed by name. */
function filterSchemas(path: string): Record<string, string> {
  const wanted = filterNames(path);
  return Object.fromEntries(
    queryParameters(path)
      .filter((p) => wanted.has(p.name))
      .map((p) => [p.name, JSON.stringify(p.schema)]),
  );
}

describe("given the two gateway spend reads", () => {
  describe("when the published contract is compared", () => {
    /** @scenario "A filter offered on one read is offered on the other" */
    it("offers the same filters on both", () => {
      // A reconciliation checksums the rollups and then diffs the events. It
      // can only do that if it can ask both surfaces the same question, so a
      // filter that exists on one and not the other makes the pair unusable
      // for the job they exist to do.
      const events = filterNames(EVENTS);
      const summaries = filterNames(SUMMARIES);
      expect(events.size).toBeGreaterThan(0);
      expect([...events].sort()).toEqual([...summaries].sort());
    });

    /** @scenario "A filter offered on one read is offered on the other" */
    it("gives each shared filter the same schema on both", () => {
      // Matching names are not a matching question. `status` published with a
      // different enum on each read, or `metadata` as a string on one and an
      // array on the other, lets a caller write one narrowing that means two
      // different things, which is the divergence this pair exists to detect.
      expect(filterSchemas(EVENTS)).toEqual(filterSchemas(SUMMARIES));
    });

    it("publishes every filter the shared vocabulary declares", () => {
      // Guards the other direction: a filter added to the module but never
      // spread into a route would leave both surfaces equally, quietly wrong.
      const declared = Object.keys(spendFilterQueryShape).sort();
      expect([...filterNames(EVENTS)].sort()).toEqual(declared);
    });

    it("keeps the rollup controls off the events read", () => {
      // group_by and its companions describe a rollup. Publishing them on the
      // events walk would advertise a grouping that read cannot perform.
      const eventsParameters = new Set(queryParameterNames(EVENTS));
      for (const control of ROLLUP_ONLY) {
        expect(eventsParameters.has(control)).toBe(false);
      }
    });
  });
});
