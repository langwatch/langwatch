// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The two listing-outcome rules whose violation is a privacy incident rather
 * than a bug, made falsifiable.
 *
 * Everything else in this feature is held up by a test. These two were held up
 * by comments, which is backwards -- they are the only two where being wrong
 * discloses something about a real person.
 *
 * RULE 1. `LastPeopleWithheldCount` may be read as a CURRENT figure and never
 * as a series. Not a trend line, not a history drawer, not a per-run export,
 * never beside a per-person list. A step from N to N+1 at a known moment says
 * an erasure happened at that moment, and on a small tenant that names the
 * person as surely as printing their name would.
 *
 * RULE 2. `LastAgentsListingStatus` and `LastPeopleListingStatus` hold an HTTP
 * status for an operator reading a support ticket. They are never rendered to
 * a customer.
 *
 * WHAT THIS FILE CAN AND CANNOT PROVE, stated plainly so nobody retires the
 * question by pointing at a green run:
 *
 * It proves the field NAMES do not appear in the customer-facing trees, that
 * the VALUES do not survive the one function where they are in scope beside a
 * customer-bound output, and that no storage exists from which a trend could be
 * drawn. It cannot prove a rename: someone who copies the value into a field
 * called `httpStatus` defeats the name scan, and only review catches that. It
 * is a guard against the likely mistake, not a proof of the rule.
 *
 * The trend rule is guarded at its PRECONDITION rather than at the chart,
 * because there is no chart to point at and there may never be one. You cannot
 * draw a series without stored history, so this asserts the history does not
 * exist. The day someone adds a per-run withheld row, this fails -- which is
 * the moment the conversation needs to happen, not the day a chart appears.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildIngestionSourceMirror } from "@ee/governance/services/pullers/repositories/ingestionSourceMirror";
import { describe, expect, it } from "vitest";
import type { IngestionPullRunStatusData } from "@ee/event-sourcing/pipelines/ingestion-pull-processing/projections/ingestionPullRunStatus.foldProjection";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** `platform/app/` -- parent of both `src/` and `ee/`. */
const APP_ROOT = path.resolve(HERE, "../../..");

/**
 * Never customer-visible under any circumstance, so the scan can be absolute.
 *
 * The withheld count is deliberately NOT in this list. It has a legitimate
 * customer rendering -- one current figure -- and banning the name outright
 * would forbid the allowed use, which is how a guard in the wrong place
 * retires the question it was meant to keep open. Its rule is guarded below
 * by shape and storage instead.
 */
const OPERATOR_ONLY_FIELDS = [
  "LastAgentsListingStatus",
  "LastPeopleListingStatus",
] as const;

/**
 * Everything a customer can reach for the agents and sources screens: the
 * rendered components, the pages, the routers that feed them, and the
 * server-side row builders whose shapes become the response.
 *
 * `ee/governance/services/pullers/` is deliberately absent. That tree is where
 * these fields legitimately live -- the projection writes them, the repository
 * stores them, an operator reads them. The boundary this guard draws is
 * between there and here.
 */
const CUSTOMER_TREES = [
  "src/components/governance",
  "src/pages/governance",
  "ee/governance/routers",
  "ee/governance/dashboard",
  "ee/governance/services/logic",
];

/** This file names the banned fields in order to ban them. */
const EXEMPT = [path.relative(APP_ROOT, fileURLToPath(import.meta.url))];

const isSource = (f: string) => /\.(?:mts|cts|tsx?)$/.test(f);

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (isSource(full)) out.push(full);
  }
  return out;
};

/** Every `file:line` in the customer trees that names `field`. */
function occurrencesOf(field: string): string[] {
  const hits: string[] = [];
  for (const tree of CUSTOMER_TREES) {
    const root = path.join(APP_ROOT, tree);
    if (!fs.existsSync(root)) continue;
    for (const file of walk(root)) {
      const relative = path.relative(APP_ROOT, file);
      if (EXEMPT.includes(relative)) continue;
      const lines = fs.readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (line.includes(field)) hits.push(`${relative}:${i + 1}`);
      });
    }
  }
  return hits;
}

/** Every scalar reachable in `value`, flattened, for a value-leak scan. */
function scalarsOf(value: unknown, out: unknown[] = []): unknown[] {
  if (value === null || value === undefined) return out;
  if (Array.isArray(value)) {
    for (const item of value) scalarsOf(item, out);
    return out;
  }
  if (value instanceof Date) {
    out.push(value.getTime());
    return out;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value)) scalarsOf(item, out);
    return out;
  }
  out.push(value);
  return out;
}

/**
 * A state carrying sentinels in the three sensitive columns.
 *
 * The sentinels are values nothing else in the pipeline produces, so a match
 * downstream is a leak and not a coincidence: 418 and 451 are statuses this
 * product never returns, and 90_210 is not a plausible headcount.
 */
const AGENTS_STATUS_SENTINEL = 418;
const PEOPLE_STATUS_SENTINEL = 451;
const WITHHELD_SENTINEL = 90_210;

function stateWithSentinels(): IngestionPullRunStatusData {
  return {
    SourceId: "source-1",
    Enabled: true,
    Cursor: "cursor-A",
    ConsecutiveErrors: 0,
    LastSuccessAt: 1_000,
    LastRunAt: 1_000,
    LastRunOutcome: "completed",
    LastRunEventCount: 3,
    LastRunError: null,
    LastRunErrorCode: null,
    LastRunScheduledFor: 900,
    LastAgentsListingAt: 1_100,
    LastAgentsListingOutcome: "refused",
    LastAgentsListingCount: null,
    LastAgentsListingReason: "listing_failed",
    LastAgentsListingStatus: AGENTS_STATUS_SENTINEL,
    LastPeopleListingAt: 1_200,
    LastPeopleListingOutcome: "refused",
    LastPeopleDirectoryCount: null,
    LastPeopleWithheldCount: WITHHELD_SENTINEL,
    LastPeopleListingReason: "listing_failed",
    LastPeopleListingStatus: PEOPLE_STATUS_SENTINEL,
  };
}

describe("given the listing outcome columns exist", () => {
  describe("when a customer-facing surface is built", () => {
    /** @scenario "An operator-only HTTP status never reaches a customer" */
    it.each(OPERATOR_ONLY_FIELDS)(
      "does not name %s anywhere a customer can reach",
      (field) => {
        const hits = occurrencesOf(field);

        expect(
          hits,
          [
            `${field} is named in a customer-facing file: ${hits.join(", ")}.`,
            "",
            "This column holds a raw HTTP status from a provider, kept so an",
            "operator reading a support ticket can tell a 403 from a 500. It is",
            "not a customer-facing fact: a tenant admin shown '403' learns that",
            "some credential somewhere was refused, which is not actionable by",
            "them and is a detail about our integration rather than about their",
            "data. Show them the OUTCOME (refused) and a sentence they can act",
            "on; leave the status in the operator's view.",
            "",
            "If you need to branch on it server-side to CHOOSE that sentence,",
            "do the branching in ee/governance/services/pullers/ and let only",
            "the resulting words cross into these trees.",
          ].join("\n"),
        ).toEqual([]);
      },
    );

    /** @scenario "The mirror carries no sensitive value onto a customer row" */
    it("keeps all three sensitive values out of the ingestion source mirror", () => {
      const mirror = buildIngestionSourceMirror({ state: stateWithSentinels() });
      const leaked = scalarsOf(mirror);

      // `IngestionSource` rows ARE customer-adjacent -- the sources screen
      // reads them. The mirror is the one function where the sensitive columns
      // sit in scope beside a customer-bound output, so it is the only place a
      // value could cross by accident rather than by decision.
      expect(
        leaked,
        [
          "A sentinel from a sensitive column reached the ingestion source",
          "mirror. The mirror writes onto IngestionSource, which the sources",
          "screen renders, so a value that arrives here is one schema change",
          "away from a customer's eyes.",
          `Mirror was: ${JSON.stringify(mirror)}`,
        ].join("\n"),
      ).not.toContain(AGENTS_STATUS_SENTINEL);
      expect(leaked).not.toContain(PEOPLE_STATUS_SENTINEL);
      expect(leaked).not.toContain(WITHHELD_SENTINEL);

      // And the names. `status` alone is a legitimate mirror key -- it holds
      // "active" -- so this looks for the compound names only.
      const keys = Object.keys(mirror).join(",").toLowerCase();
      expect(keys).not.toContain("listingstatus");
      expect(keys).not.toContain("withheld");
    });
  });

  describe("when the withheld count is stored", () => {
    /** @scenario "No history exists from which a trend could be drawn" */
    it("is stored once, as a single current figure with no per-run history", () => {
      const schema = fs.readFileSync(
        path.join(APP_ROOT, "prisma/schema.prisma"),
        "utf8",
      );

      // Column declarations only -- the `///` doc comments above the column
      // discuss the rule at length and must not count as storage.
      const declarations = schema
        .split("\n")
        .map((line, i) => ({ line: line.trim(), number: i + 1 }))
        .filter(
          ({ line }) =>
            !line.startsWith("///") &&
            !line.startsWith("//") &&
            /LastPeopleWithheldCount|withheldPersonCount|WithheldHistory/i.test(
              line,
            ),
        );

      expect(
        declarations.map((d) => `${d.number}: ${d.line}`),
        [
          "The withheld count is stored in more than one place, or in a shape",
          "that keeps more than the current value.",
          "",
          "It may be shown as a CURRENT figure and never as a series. A step",
          "from N to N+1 at a known moment says an erasure happened at that",
          "moment; on a tenant with four people that identifies the person as",
          "precisely as a name would. One overwritten column cannot express a",
          "series, which is the property being preserved here -- you cannot",
          "draw a trend line from a value that has no history.",
          "",
          "If a per-run withheld figure is genuinely needed, that is a privacy",
          "review, not a migration.",
        ].join("\n"),
      ).toHaveLength(1);

      // The single declaration must be nullable and scalar: `Int?`, not a
      // relation to a table of them.
      expect(declarations[0]?.line).toMatch(/^LastPeopleWithheldCount\s+Int\?/);
    });

    /**
     * The OTHER half of rule 1 -- that the withheld count is a subset, so a
     * visible-people figure SUBTRACTS it rather than adding it -- has no guard
     * here on purpose.
     *
     * Nothing computes that figure yet. A test asserting `30 - 4 === 26`
     * against inline constants would exercise arithmetic rather than this
     * codebase, pass forever, and read on the next audit as though the subset
     * rule were covered. That is worse than the gap it papers over.
     *
     * The fold's own tests already assert both counts survive a listing with
     * the subset relation intact. When something finally renders a
     * visible-people figure, the guard belongs beside it, asserting that
     * function returns the directory count MINUS the withheld one -- 34 for a
     * tenant of 30 people is a fabricated headcount that overstates our reach
     * into their directory, and it is the error a reader cannot detect.
     */
  });
});
